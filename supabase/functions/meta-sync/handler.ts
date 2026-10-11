// Sincroniza o gasto diário da Meta Ads (por campanha e país) para a tabela de tráfego.
//
// Quem chama:
//  * o app (usuário logado): { integrationId?, since?, until? } — padrão últimos 7 dias
//  * o agendador do banco (pg_cron, de hora em hora) com o cabeçalho x-cron-secret — últimos 3 dias
//    de todas as integrações ativas; também tenta de novo webhooks que falharam e atualiza o
//    extrato do Mercado Pago (bankCron).
import { insightsUrl, type InsightRow, type MetaConfig, metaError, normalizeAccount, toAdRow, type AdRow } from '../_shared/meta.ts';
import { bankCron } from '../_shared/bank.ts';
import { admin, type Admin, CORS, functionsUrl, FxCache, json, reprocessEvents, userFromRequest, userSettings } from '../_shared/server.ts';
import { dayIn, safeEqual } from '../_shared/util.ts';

interface MetaIntegration {
  id: string;
  user_id: string;
  enabled: boolean;
  default_product_id: string | null;
  config: MetaConfig;
}

const DAY = 86_400_000;
const shift = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

async function fetchAll(url: string): Promise<InsightRow[]> {
  const rows: InsightRow[] = [];
  let next: string | null = url;
  for (let page = 0; next && page < 200; page++) {
    const res: Response = await fetch(next, { signal: AbortSignal.timeout(30000) });
    const body = await res.json();
    if (body.error) throw new Error(metaError(body.error));
    rows.push(...(body.data ?? []));
    next = body.paging?.next ?? null;
  }
  return rows;
}

async function syncIntegration(sb: Admin, integ: MetaIntegration, since: string, until: string): Promise<string> {
  const { data: sec } = await sb.from('integration_secrets').select('access_token').eq('integration_id', integ.id).maybeSingle();
  const token = sec?.access_token;
  const accounts = (integ.config.accountIds ?? []).filter(Boolean);
  if (!token) throw new Error('Token de acesso da Meta não configurado.');
  if (!accounts.length) throw new Error('Nenhuma conta de anúncios configurada.');

  const settings = await userSettings(sb, integ.user_id);
  const fx = new FxCache(sb, settings.rates);
  let total = 0;
  let rowsCount = 0;
  for (const account of accounts) {
    const insights = await fetchAll(insightsUrl(account, token, since, until, integ.config, Deno.env.get('META_GRAPH_BASE') || undefined));
    const rows: AdRow[] = [];
    for (const r of insights) {
      const rate = await fx.rate(r.account_currency || 'BRL', r.date_start);
      const row = toAdRow(r, { userId: integ.user_id, account, rate, rules: integ.config.rules, defaultProduct: integ.default_product_id });
      if (row) rows.push(row);
    }
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from('ads').upsert(rows.slice(i, i + 500), { onConflict: 'user_id,external_id' });
      if (error) throw new Error(`Gravação: ${error.message}`);
    }
    // Remove gastos que a Meta não reporta mais no período (ex.: campanha zerada/corrigida)
    const keep = new Set(rows.map((r) => r.external_id));
    const { data: existing } = await sb
      .from('ads')
      .select('id, external_id')
      .eq('user_id', integ.user_id)
      .eq('origin', 'meta')
      .like('external_id', `meta:${normalizeAccount(account)}:%`)
      .gte('date', since)
      .lte('date', until);
    const stale = (existing ?? []).filter((e) => !keep.has(e.external_id)).map((e) => e.id);
    if (stale.length) await sb.from('ads').delete().in('id', stale);
    total += rows.reduce((a, r) => a + r.amount * r.rate, 0);
    rowsCount += rows.length;
  }
  return `${rowsCount} linha(s) de ${since} a ${until} · R$ ${total.toFixed(2)}`;
}

async function runFor(sb: Admin, integrations: MetaIntegration[], since: string, until: string) {
  const results: { id: string; ok: boolean; message: string }[] = [];
  for (const integ of integrations) {
    try {
      const message = await syncIntegration(sb, integ, since, until);
      await sb.from('integrations').update({ last_sync_at: new Date().toISOString(), last_sync_status: `ok: ${message}` }).eq('id', integ.id);
      results.push({ id: integ.id, ok: true, message });
    } catch (err) {
      const message = (err as Error).message;
      await sb.from('integrations').update({ last_sync_at: new Date().toISOString(), last_sync_status: `erro: ${message}` }).eq('id', integ.id);
      results.push({ id: integ.id, ok: false, message });
    }
  }
  return results;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  const sb = admin();
  const body = await req.json().catch(() => ({}));
  const today = dayIn(new Date().toISOString());

  // Garante o agendamento automático e obtém o segredo interno
  const { data: cronSecret } = await sb.rpc('gestor_internal_setup', { p_functions_url: functionsUrl() });
  const given = req.headers.get('x-cron-secret') ?? '';

  if (given && typeof cronSecret === 'string' && safeEqual(given, cronSecret)) {
    const { data } = await sb.from('integrations').select('id, user_id, enabled, default_product_id, config').eq('platform', 'meta').eq('enabled', true);
    const results = await runFor(sb, (data ?? []) as MetaIntegration[], shift(today, -2), today);
    const retried = await reprocessEvents(sb, { statuses: ['error'], maxAttempts: 5, sinceHours: 72 });
    // o mesmo agendador mantém o extrato do Mercado Pago em dia
    const bank = await bankCron(sb).catch((err) => [{ id: '', ok: false, message: (err as Error).message }]);
    return json({ ok: true, results, retried, bank });
  }

  const userId = await userFromRequest(sb, req);
  if (!userId) return json({ error: 'Faça login novamente' }, 401);
  let q = sb.from('integrations').select('id, user_id, enabled, default_product_id, config').eq('platform', 'meta').eq('user_id', userId);
  if (body.integrationId) q = q.eq('id', body.integrationId);
  const { data } = await q;
  const until = /^\d{4}-\d{2}-\d{2}$/.test(body.until ?? '') ? body.until : today;
  const since = /^\d{4}-\d{2}-\d{2}$/.test(body.since ?? '') ? body.since : shift(until, -6);
  if (since > until) return json({ error: 'Período inválido' }, 400);
  if ((Date.parse(until) - Date.parse(since)) / DAY > 400) return json({ error: 'Período máximo por sincronização: 400 dias' }, 400);
  const results = await runFor(sb, (data ?? []) as MetaIntegration[], since, until);
  return json({ ok: results.every((r) => r.ok), results });
}
