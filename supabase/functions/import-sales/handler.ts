// Importação de vendas por planilha (histórico da Hotmart, Cakto e outras).
// O app lê o arquivo e envia as vendas já reconhecidas em lotes; aqui elas são validadas e gravadas
// pelo mesmo caminho dos webhooks — o mesmo código de venda não duplica e reembolsos não "voltam".
import { ADAPTERS, type Adapter, type PlatformKey } from '../_shared/adapters.ts';
import { processPayload } from '../_shared/process.ts';
import { admin, CORS, FxCache, json, makeRepo, userFromRequest, userSettings } from '../_shared/server.ts';
import { sanitizeItem } from '../_shared/sheet.ts';

const MAX_ITEMS = 500;

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  const sb = admin();
  const userId = await userFromRequest(sb, req);
  if (!userId) return json({ error: 'Faça login novamente' }, 401);
  const body = await req.json().catch(() => null);
  const platform = body?.platform as PlatformKey;
  if (!platform || !ADAPTERS[platform]) return json({ error: 'Plataforma inválida' }, 400);
  if (!Array.isArray(body.items) || body.items.length > MAX_ITEMS) return json({ error: `Envie de 1 a ${MAX_ITEMS} vendas por vez` }, 400);

  // integração da plataforma (se existir): % de taxa, país padrão e vínculo das vendas
  let q = sb.from('integrations').select('id, name, config').eq('user_id', userId).eq('platform', platform).order('created_at').limit(1);
  if (body.integrationId) q = sb.from('integrations').select('id, name, config').eq('user_id', userId).eq('id', body.integrationId).limit(1);
  const { data: integs } = await q;
  const integ = integs?.[0] as { id: string; name: string; config: Record<string, unknown> } | undefined;
  // "Outra plataforma" sem conexão: identificada só pelo nome informado (Kiwify, Eduzz, Ticto…)
  const otherName = typeof body.platformName === 'string' ? body.platformName.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  const otherKey = otherName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (platform === 'generic' && !integ && !otherKey) return json({ error: 'Informe o nome da plataforma' }, 400);

  const settings = await userSettings(sb, userId);
  const repo = makeRepo(sb, userId, new FxCache(sb, settings.rates));
  const cfg = { ...(platform === 'generic' && otherKey ? {} : (integ?.config ?? {})), timezone: settings.timezone };
  const ctx = {
    userId,
    integrationId: platform === 'generic' && otherKey ? null : (integ?.id ?? null),
    platformKey: platform === 'generic' ? (otherKey ? `outra:${otherKey}` : `generic:${integ!.id}`) : platform,
    platformLabel: platform === 'generic' ? (otherKey ? otherName : integ!.name) : ADAPTERS[platform].label,
    eventId: null,
  };

  let imported = 0;
  const failed: { externalId: string; message: string }[] = [];
  for (const raw of body.items) {
    const item = sanitizeItem(raw);
    if (!item) {
      failed.push({ externalId: String((raw as { externalId?: unknown })?.externalId ?? '?').slice(0, 60), message: 'linha inválida' });
      continue;
    }
    const one: Adapter = { ...ADAPTERS[platform], parse: () => ({ event: 'planilha', items: [item] }) };
    try {
      await processPayload(one, null, cfg, ctx, repo);
      imported++;
    } catch (err) {
      failed.push({ externalId: item.externalId, message: (err as Error).message.slice(0, 200) });
    }
  }
  return json({ ok: failed.length === 0, imported, failed });
}
