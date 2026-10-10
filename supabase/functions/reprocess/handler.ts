// Reprocessa eventos de webhook salvos (ex.: depois de corrigir um segredo ou mapeamento).
// Corpo: { ids?: number[], statuses?: ("error"|"unauthorized"|"ignored"|"processed")[] }
import { admin, CORS, json, reprocessEvents, userFromRequest } from '../_shared/server.ts';

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  const sb = admin();
  const userId = await userFromRequest(sb, req);
  if (!userId) return json({ error: 'Faça login novamente' }, 401);
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isFinite) : undefined;
  const statuses = Array.isArray(body.statuses) ? body.statuses.map(String) : ids ? undefined : ['error', 'unauthorized'];
  try {
    const counts = await reprocessEvents(sb, { userId, ids, statuses });
    return json({ ok: true, counts });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
}
