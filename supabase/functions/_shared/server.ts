// Peças comuns das Edge Functions que falam com o banco (Deno).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import { ADAPTERS, type AdapterConfig, type PlatformKey } from './adapters.ts';
import { processPayload, type Repo, type TransactionRow } from './process.ts';
import { dayIn } from './util.ts';

// deno-lint-ignore no-explicit-any
export type Admin = SupabaseClient<any, 'public', any>;

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Variável de ambiente ausente: ${name}`);
  return v;
}

export function admin(): Admin {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Administrador dono do JWT enviado pelo app (ou null).
 * Exige: token válido + ser o administrador + ter passado pelo 2FA, se ativo (mesma regra do banco).
 */
export async function userFromRequest(sb: Admin, req: Request): Promise<string | null> {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const { data, error } = await sb.auth.getUser(jwt);
  if (error || !data.user) return null;
  const asUser = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: ok } = await asUser.rpc('gestor_access_ok');
  return ok === true ? data.user.id : null;
}

export function functionsUrl(): string {
  return `${env('SUPABASE_URL').replace(/\/$/, '')}/functions/v1`;
}

// ------------------------------------------------------------------ câmbio
const FX_API = Deno.env.get('FX_API_URL') || 'https://open.er-api.com/v6/latest/BRL';

export class FxCache {
  private cache = new Map<string, number>();
  private fetched: Record<string, number> | null = null;
  constructor(private sb: Admin, private fallback: Record<string, number> = {}) {}

  private async fetchLatest(today: string): Promise<Record<string, number> | null> {
    if (this.fetched) return this.fetched;
    try {
      const res = await fetch(FX_API, { signal: AbortSignal.timeout(8000) });
      const data = await res.json();
      if (data?.result !== 'success') return null;
      const out: Record<string, number> = {};
      for (const [cur, perBrl] of Object.entries(data.rates as Record<string, number>)) {
        if (perBrl > 0 && cur !== 'BRL') out[cur] = Number((1 / perBrl).toFixed(8));
      }
      const rows = Object.entries(out).map(([currency, rate]) => ({ day: today, currency, rate }));
      await this.sb.from('fx_rates').upsert(rows, { onConflict: 'day,currency' });
      this.fetched = out;
      return out;
    } catch {
      return null;
    }
  }

  /** BRL por 1 unidade da moeda no dia (cotação do dia; senão a mais próxima anterior). */
  async rate(currency: string, day: string): Promise<number> {
    const cur = currency.toUpperCase();
    if (cur === 'BRL') return 1;
    const key = `${cur}|${day}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const { data } = await this.sb
      .from('fx_rates')
      .select('day, rate')
      .eq('currency', cur)
      .lte('day', day)
      .order('day', { ascending: false })
      .limit(1);
    const stored = data?.[0] as { day: string; rate: number } | undefined;
    let rate: number | undefined = stored && stored.day === day ? Number(stored.rate) : undefined;
    const today = dayIn(new Date().toISOString());
    if (rate === undefined) {
      const ageDays = (Date.parse(today) - Date.parse(day)) / 86_400_000;
      // vendas/gastos recentes: cotação do dia pela API
      if (ageDays <= 3) rate = (await this.fetchLatest(today))?.[cur];
    }
    // datas antigas: cotação guardada mais próxima (antes ou, se não houver, depois da data)
    rate ??= stored ? Number(stored.rate) : undefined;
    if (rate === undefined) {
      const { data: after } = await this.sb
        .from('fx_rates')
        .select('rate')
        .eq('currency', cur)
        .gte('day', day)
        .order('day', { ascending: true })
        .limit(1);
      if (after?.[0]) rate = Number(after[0].rate);
    }
    rate ??= this.fallback[cur] ?? (await this.fetchLatest(today))?.[cur];
    if (!rate || !(rate > 0)) throw new Error(`Sem cotação para ${cur} em ${day}. Cadastre a cotação em Configurações.`);
    this.cache.set(key, rate);
    return rate;
  }
}

// ------------------------------------------------------------------ processamento de um evento salvo
export interface IntegrationRow {
  id: string;
  user_id: string;
  platform: PlatformKey | 'meta';
  name: string;
  enabled: boolean;
  config: AdapterConfig & Record<string, unknown>;
}

export interface EventRow {
  id: number;
  payload: unknown;
  raw_body: string | null;
  attempts: number;
}

export async function userSettings(sb: Admin, userId: string): Promise<{ timezone: string; rates: Record<string, number> }> {
  const { data } = await sb.from('settings').select('data').eq('user_id', userId).maybeSingle();
  const d = (data?.data ?? {}) as { timezone?: string; rates?: Record<string, number> };
  return { timezone: d.timezone || 'America/Sao_Paulo', rates: d.rates ?? {} };
}

export function makeRepo(sb: Admin, userId: string, fx: FxCache): Repo {
  return {
    async resolveProduct(platformKey, externalId, name) {
      const { data, error } = await sb.rpc('resolve_product', {
        p_user: userId,
        p_platform: platformKey,
        p_external_id: externalId,
        p_name: name,
      });
      if (error) throw new Error(`Produto: ${error.message}`);
      return data as string;
    },
    rate: (currency, day) => fx.rate(currency, day),
    async ingest(row: TransactionRow) {
      const { error } = await sb.rpc('ingest_transaction', { p: row });
      if (error) throw new Error(`Gravação: ${error.message}`);
    },
  };
}

/** Processa um evento já gravado e atualiza seu status. Não lança erro: registra no evento. */
export async function runEvent(sb: Admin, integ: IntegrationRow, ev: EventRow): Promise<'processed' | 'ignored' | 'error'> {
  const adapter = ADAPTERS[integ.platform as PlatformKey];
  try {
    if (!adapter) throw new Error(`Plataforma não suportada: ${integ.platform}`);
    if (ev.payload === null || ev.payload === undefined) throw new Error('Corpo do webhook não é JSON válido');
    const settings = await userSettings(sb, integ.user_id);
    const fx = new FxCache(sb, settings.rates);
    const result = await processPayload(
      adapter,
      ev.payload,
      { ...integ.config, timezone: settings.timezone },
      {
        userId: integ.user_id,
        integrationId: integ.id,
        platformKey: integ.platform === 'generic' ? `generic:${integ.id}` : integ.platform,
        platformLabel: integ.platform === 'generic' ? integ.name : adapter.label,
        eventId: ev.id,
      },
      makeRepo(sb, integ.user_id, fx),
    );
    await sb
      .from('webhook_events')
      .update({
        status: result.status,
        event_name: result.eventName || null,
        external_id: result.externalId,
        message: result.message.slice(0, 2000),
        processed_at: new Date().toISOString(),
        attempts: ev.attempts + 1,
      })
      .eq('id', ev.id);
    return result.status;
  } catch (err) {
    await sb
      .from('webhook_events')
      .update({
        status: 'error',
        message: `Erro ao processar: ${(err as Error).message}`.slice(0, 2000),
        processed_at: new Date().toISOString(),
        attempts: ev.attempts + 1,
      })
      .eq('id', ev.id);
    return 'error';
  }
}

/** Reprocessa eventos de um usuário (por ids, ou por status). */
export async function reprocessEvents(
  sb: Admin,
  filter: { userId?: string; ids?: number[]; statuses?: string[]; maxAttempts?: number; sinceHours?: number },
): Promise<Record<string, number>> {
  let q = sb
    .from('webhook_events')
    .select('id, user_id, integration_id, payload, raw_body, attempts')
    .not('integration_id', 'is', null)
    .order('id', { ascending: true })
    .limit(500);
  if (filter.userId) q = q.eq('user_id', filter.userId);
  if (filter.ids?.length) q = q.in('id', filter.ids);
  if (filter.statuses?.length) q = q.in('status', filter.statuses);
  if (filter.maxAttempts) q = q.lt('attempts', filter.maxAttempts);
  if (filter.sinceHours) q = q.gte('received_at', new Date(Date.now() - filter.sinceHours * 3_600_000).toISOString());
  const { data: events, error } = await q;
  if (error) throw new Error(error.message);
  const counts: Record<string, number> = { processed: 0, ignored: 0, error: 0 };
  const integCache = new Map<string, IntegrationRow | null>();
  for (const ev of events ?? []) {
    let integ = integCache.get(ev.integration_id);
    if (integ === undefined) {
      const { data } = await sb.from('integrations').select('id, user_id, platform, name, enabled, config').eq('id', ev.integration_id).maybeSingle();
      integ = (data as IntegrationRow) ?? null;
      integCache.set(ev.integration_id, integ);
    }
    if (!integ) continue;
    counts[await runEvent(sb, integ, ev as EventRow)]++;
  }
  return counts;
}
