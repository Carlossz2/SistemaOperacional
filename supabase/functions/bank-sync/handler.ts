// Extrato da conta Mercado Pago (entradas e saídas) → tabela bank_movements.
//
// Quem chama: o app (usuário logado) com { integrationId, since?, until?, action?: 'sync' | 'import' }.
//  * sync   (padrão): pede ao Mercado Pago o relatório do período e importa os relatórios já prontos
//  * import: só importa os relatórios prontos (o relatório pedido leva alguns minutos para ficar pronto)
// O agendador de hora em hora roda a mesma lógica pela função meta-sync (bankCron).
import { type BankIntegration, shiftDay, syncBank } from '../_shared/bank.ts';
import { admin, CORS, json, userFromRequest } from '../_shared/server.ts';
import { dayIn } from '../_shared/util.ts';

const DAY = 86_400_000;
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  const sb = admin();
  const userId = await userFromRequest(sb, req);
  if (!userId) return json({ error: 'Faça login novamente' }, 401);
  const body = await req.json().catch(() => ({}));

  let q = sb.from('integrations').select('id, user_id, enabled, config').eq('platform', 'mercadopago').eq('user_id', userId);
  if (body.integrationId) q = q.eq('id', body.integrationId);
  const { data } = await q;
  const list = (data ?? []) as BankIntegration[];
  if (!list.length) return json({ error: 'Conecte o Mercado Pago primeiro' }, 404);

  const today = dayIn(new Date().toISOString());
  const until = isDay(body.until) ? body.until : today;
  const since = isDay(body.since) ? body.since : shiftDay(until, -29);
  if (since > until) return json({ error: 'Período inválido' }, 400);
  if ((Date.parse(until) - Date.parse(since)) / DAY > 366) return json({ error: 'Período máximo: 12 meses por vez' }, 400);

  const results: { id: string; ok: boolean; message: string }[] = [];
  for (const integ of list) {
    try {
      const message = await syncBank(sb, { ...integ, config: integ.config ?? {} }, { since, until, request: body.action !== 'import' });
      results.push({ id: integ.id, ok: true, message });
    } catch (err) {
      results.push({ id: integ.id, ok: false, message: (err as Error).message });
    }
  }
  return json({ ok: results.every((r) => r.ok), results });
}
