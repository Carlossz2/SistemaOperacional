// Recebe webhooks das plataformas de venda.
// URL: https://<projeto>.supabase.co/functions/v1/webhook/<token-da-integração>
//
// Ordem garantida: 1) grava o evento bruto  2) confere o segredo  3) processa.
// Se a gravação bruta falhar, responde 500 para a plataforma reenviar — nenhum evento se perde.
import { ADAPTERS, type PlatformKey } from '../_shared/adapters.ts';
import { admin, CORS, type IntegrationRow, json, runEvent } from '../_shared/server.ts';

const SENSITIVE = /^(authorization|cookie|x-hotmart-hottok|x-secret|x-.*token|x-.*secret|x-api-key|apikey)$/i;
const MAX_BODY = 1_000_000;

function headerMap(req: Request): { all: Record<string, string>; stored: Record<string, string> } {
  const all: Record<string, string> = {};
  const stored: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    all[k] = value;
    stored[k] = SENSITIVE.test(k) ? '***' : value.slice(0, 500);
  });
  return { all, stored };
}

function parseBody(raw: string, contentType: string): unknown {
  const text = raw.trim();
  if (!text) return null;
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (contentType.includes('application/x-www-form-urlencoded') || /^[\w.%[\]-]+=/.test(text)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of new URLSearchParams(text)) {
      // "product[name]=X" vira { product: { name: "X" } }
      const parts = k.replace(/\]/g, '').split('[');
      let cur = out;
      parts.forEach((p, i) => {
        if (i === parts.length - 1) cur[p] = v;
        else cur = (cur[p] ??= {}) as Record<string, unknown>;
      });
    }
    return out;
  }
  return null;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? url.pathname.split('/').filter(Boolean).pop() ?? '';

  // Algumas plataformas testam a URL com GET antes de salvar
  if (req.method === 'GET' || req.method === 'HEAD') return json({ ok: true, service: 'Gestor DR webhook' });
  if (req.method !== 'POST' && req.method !== 'PUT') return json({ error: 'Método não suportado' }, 405);
  if (!/^[a-f0-9]{48}$/.test(token)) return json({ error: 'URL de webhook inválida' }, 404);

  const sb = admin();
  const { data: integ, error: integErr } = await sb
    .from('integrations')
    .select('id, user_id, platform, name, enabled, config')
    .eq('token', token)
    .maybeSingle();
  if (integErr) return json({ error: 'Falha temporária' }, 500);
  if (!integ || integ.platform === 'meta') return json({ error: 'Integração não encontrada' }, 404);
  const integration = integ as IntegrationRow;
  const adapter = ADAPTERS[integration.platform as PlatformKey];

  const raw = (await req.text()).slice(0, MAX_BODY);
  const payload = parseBody(raw, req.headers.get('content-type') ?? '');
  const { all, stored } = headerMap(req);

  // 1) Grava o bruto (sempre)
  const { data: ev, error: evErr } = await sb
    .from('webhook_events')
    .insert({
      user_id: integration.user_id,
      integration_id: integration.id,
      platform: integration.platform,
      headers: stored,
      payload,
      raw_body: payload === null ? raw : null,
    })
    .select('id, payload, raw_body, attempts')
    .single();
  if (evErr || !ev) return json({ error: 'Falha ao registrar evento' }, 500);
  await sb.from('integrations').update({ last_event_at: new Date().toISOString() }).eq('id', integration.id);

  if (!integration.enabled) {
    await sb.from('webhook_events').update({ status: 'ignored', message: 'Integração desativada no Gestor DR' }).eq('id', ev.id);
    return json({ ok: true, ignored: true });
  }

  // 2) Confere o segredo da plataforma (se configurado)
  const { data: sec } = await sb.from('integration_secrets').select('secret').eq('integration_id', integration.id).maybeSingle();
  if (!adapter.verify({ headers: all, body: payload, secret: sec?.secret ?? null })) {
    await sb
      .from('webhook_events')
      .update({
        status: 'unauthorized',
        message: `${adapter.help.secretLabel} não confere. Confira o valor salvo na integração e reprocesse este evento.`,
      })
      .eq('id', ev.id);
    return json({ error: 'Não autorizado' }, 401);
  }

  // 3) Processa (erros ficam registrados no evento para reprocessar depois)
  const status = await runEvent(sb, integration, ev);
  return json({ ok: true, status });
}
