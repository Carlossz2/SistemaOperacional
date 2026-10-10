// Teste de ponta a ponta do backend contra o "mini Supabase" local (start.sh precisa estar rodando).
// deno test -A supabase/tests/stack/backend.e2e.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import pg from 'npm:pg@8.13.1';
import { caktoApproved, hotmartApproved, perfectApproved } from '../../functions/_shared/fixtures.ts';

const URL_BASE = 'http://localhost:54321';
const ANON = Deno.env.get('ANON_KEY')!;
const db = new pg.Pool({ connectionString: Deno.env.get('DATABASE_URL') ?? 'postgres://postgres:postgres@localhost:5432/gestor_e2e' });
const opts = { sanitizeOps: false, sanitizeResources: false };

async function newUser(email: string) {
  const sb = createClient(URL_BASE, ANON, { auth: { persistSession: false }, realtime: { params: {} } });
  const { error } = await sb.auth.signUp({ email, password: 'senha-forte-123' });
  if (error) throw error;
  return sb;
}
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${URL_BASE}/functions/v1/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

const sb = await newUser(`dono-${Date.now()}@teste.com`);
const other = await newUser(`outro-${Date.now()}@teste.com`);
const { data: me } = await sb.auth.getUser();
const userId = me.user!.id;
const jwt = (await sb.auth.getSession()).data.session!.access_token;

Deno.test({ name: 'app grava e lê dados próprios pela API', ...opts, fn: async () => {
  assert(!(await sb.from('settings').upsert({ user_id: userId, data: { timezone: 'America/Sao_Paulo', rates: { USD: 5 } } })).error);
  const { error } = await sb.from('products').insert({ id: 'prod-keto', name: 'Keto' });
  assert(!error, error?.message);
  const { data } = await other.from('products').select('*');
  assertEquals(data?.length, 0, 'outro usuário não vê');
}});

let hotmartToken = '';
let hotmartIntegration = '';
Deno.test({ name: 'webhook Hotmart: autenticação, gravação bruta e consolidação', ...opts, fn: async () => {
  const { data: integ, error } = await sb.from('integrations').insert({ platform: 'hotmart', name: 'Hotmart' }).select().single();
  assert(!error, error?.message);
  hotmartToken = integ.token;
  hotmartIntegration = integ.id;
  assertEquals(hotmartToken.length, 48);
  assert(!(await sb.rpc('set_integration_secret', { p_integration_id: integ.id, p_secret: 'hottok-ok' })).error);

  // URL inválida
  assertEquals((await post('webhook/' + 'f'.repeat(48), hotmartApproved)).status, 404);
  // hottok errado: 401, mas o evento fica guardado
  const bad = await post(`webhook/${hotmartToken}`, hotmartApproved, { 'X-HOTMART-HOTTOK': 'errado' });
  assertEquals(bad.status, 401);
  // hottok certo
  const ok = await post(`webhook/${hotmartToken}`, hotmartApproved, { 'X-HOTMART-HOTTOK': 'hottok-ok' });
  assertEquals(ok.status, 200);
  assertEquals((await ok.json()).status, 'processed');

  const { data: events } = await sb.from('webhook_events').select('status, message, headers, payload').order('id');
  assertEquals(events?.map((e) => e.status), ['unauthorized', 'processed']);
  assertEquals(events?.[1].headers['x-hotmart-hottok'], '***', 'segredo não fica salvo em claro');
  assert(events?.[1].payload, 'payload bruto guardado');

  const { data: sales } = await sb.from('sales').select('*').eq('origin', 'auto');
  assertEquals(sales?.length, 1);
  const s = sales![0];
  // US$ 27 a 5,00 (cotação do dia da API simulada); líquido R$ 120,50 => taxas US$ 2,90
  assertEquals([s.platform, s.country, s.currency, Number(s.rate), Number(s.gross), Number(s.fees), Number(s.quantity)], ['Hotmart', 'MX', 'USD', 5, 27, 2.9, 1]);
  const { data: product } = await sb.from('products').select('name').eq('id', s.product_id).single();
  assertEquals(product?.name, 'Método Reconquista', 'produto criado automaticamente');
}});

Deno.test({ name: 'reenvio, reembolso e reprocessamento', ...opts, fn: async () => {
  await post(`webhook/${hotmartToken}`, hotmartApproved, { 'X-HOTMART-HOTTOK': 'hottok-ok' }); // reenvio
  let { data: sales } = await sb.from('sales').select('quantity, refunds').eq('origin', 'auto');
  assertEquals(Number(sales![0].quantity), 1, 'reenvio não duplica');

  await post(`webhook/${hotmartToken}`, { ...hotmartApproved, event: 'PURCHASE_REFUNDED' }, { 'X-HOTMART-HOTTOK': 'hottok-ok' });
  ({ data: sales } = await sb.from('sales').select('quantity, refunds').eq('origin', 'auto'));
  assertEquals(Number(sales![0].refunds), 24.1, 'reembolso = bruto − taxas');

  // reprocessar o evento recusado (usuário confirma que é legítimo)
  const res = await post('reprocess', { statuses: ['unauthorized'] }, { Authorization: `Bearer ${jwt}` });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).counts.processed, 1);
  const { data: tx } = await sb.from('transactions').select('status');
  assertEquals(tx?.map((t) => t.status), ['refunded'], 'aprovação reprocessada não desfaz reembolso');
  // sem login não reprocessa
  assertEquals((await post('reprocess', {})).status, 401);
}});

Deno.test({ name: 'Cakto (lista com order bump) e PerfectPay (form-urlencoded)', ...opts, fn: async () => {
  const { data: cakto } = await sb.from('integrations').insert({ platform: 'cakto', name: 'Cakto' }).select().single();
  const list = { ...caktoApproved, data: [caktoApproved.data, { ...caktoApproved.data, id: 'bump1', amount: 37, fees: 1.85, product: { id: 'b', name: 'Bump' } }] };
  assertEquals((await post(`webhook/${cakto!.token}`, list)).status, 200);

  const { data: pp } = await sb.from('integrations').insert({ platform: 'perfectpay', name: 'PerfectPay', config: { feePercent: 8 } }).select().single();
  const form = new URLSearchParams({
    token: 'x', code: 'PP1', sale_amount: '197.00', currency_enum: '1', sale_status_enum: '2', date_approved: '2026-10-10 10:00:00',
    'product[code]': 'PPX', 'product[name]': 'Kit',
  });
  const r = await fetch(`${URL_BASE}/functions/v1/webhook/${pp!.token}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
  assertEquals(r.status, 200);
  const { data: tx } = await sb.from('transactions').select('platform_label, gross, fees, fees_estimated, product_name').in('platform', ['cakto', 'perfectpay']).order('created_at');
  assertEquals(tx?.length, 3);
  const kit = tx!.find((t) => t.platform_label === 'PerfectPay')!;
  assertEquals([Number(kit.gross), Number(kit.fees), kit.fees_estimated, kit.product_name], [197, 15.76, true, 'Kit']);
  // perfectApproved (JSON) também funciona
  assertEquals((await post(`webhook/${pp!.token}`, perfectApproved)).status, 200);
}});

Deno.test({ name: 'vincular produto da plataforma a outro produto move as vendas', ...opts, fn: async () => {
  const { data: alias } = await sb.from('product_aliases').select('id, product_id').eq('platform', 'hotmart').single();
  const { error } = await sb.from('product_aliases').update({ product_id: 'prod-keto' }).eq('id', alias!.id);
  assert(!error, error?.message);
  const { data: sales } = await sb.from('sales').select('product_id').eq('origin', 'auto').eq('platform', 'Hotmart');
  assertEquals(sales?.map((s) => s.product_id), ['prod-keto']);
  // app não consegue alterar venda automática nem transações
  await sb.from('sales').update({ gross: 1 }).eq('origin', 'auto');
  const { data: after } = await sb.from('sales').select('gross').eq('origin', 'auto').eq('platform', 'Hotmart');
  assertEquals(Number(after![0].gross), 27);
  const { error: txErr } = await sb.from('transactions').update({ gross: 1 }).eq('platform', 'hotmart');
  assert(txErr, 'transações são somente leitura');
}});

Deno.test({ name: 'Meta: sincroniza gastos com paginação, regras e cotação; erros claros', ...opts, fn: async () => {
  const { data: meta } = await sb
    .from('integrations')
    .insert({ platform: 'meta', name: 'Meta Ads', config: { accountIds: ['123'], rules: [{ contains: 'keto', productId: 'prod-keto' }] } })
    .select()
    .single();
  assert(!(await sb.rpc('set_integration_secret', { p_integration_id: meta!.id, p_access_token: 'token-bom' })).error);
  const call = () => post('meta-sync', { integrationId: meta!.id, since: '2026-10-01', until: '2026-10-01' }, { Authorization: `Bearer ${jwt}` });
  let res = await call();
  const body = await res.json();
  assertEquals(res.status, 200, JSON.stringify(body));
  assert(body.ok, JSON.stringify(body));
  let { data: ads } = await sb.from('ads').select('*').eq('origin', 'meta').order('amount');
  assertEquals(ads?.length, 2, 'duas páginas');
  assertEquals([ads![0].campaign, ads![0].product_id, Number(ads![0].rate), ads![0].country], ['KETO US', 'prod-keto', 5, 'US']);
  assertEquals(ads![1].product_id, null, 'sem regra => sem produto');
  res = await call();
  ({ data: ads } = await sb.from('ads').select('id').eq('origin', 'meta'));
  assertEquals(ads?.length, 2, 'sincronizar de novo não duplica');
  // app não apaga gasto da Meta
  await sb.from('ads').delete().eq('origin', 'meta');
  ({ data: ads } = await sb.from('ads').select('id').eq('origin', 'meta'));
  assertEquals(ads?.length, 2);
  // token expirado
  await sb.rpc('set_integration_secret', { p_integration_id: meta!.id, p_access_token: 'expired' });
  res = await call();
  const err = await res.json();
  assert(!err.ok && err.results[0].message.includes('expirado'), JSON.stringify(err));
  const { data: integ } = await sb.from('integrations').select('last_sync_status').eq('id', meta!.id).single();
  assert(integ?.last_sync_status?.startsWith('erro'));
  // outro usuário não sincroniza a integração alheia
  const otherJwt = (await other.auth.getSession()).data.session!.access_token;
  const r2 = await post('meta-sync', { integrationId: meta!.id }, { Authorization: `Bearer ${otherJwt}` });
  assertEquals((await r2.json()).results.length, 0);
}});

Deno.test({ name: 'agendador: segredo interno sincroniza e tenta de novo webhooks com erro', ...opts, fn: async () => {
  const { rows } = await db.query("select value from private.app_config where key = 'cron_secret'");
  const secret = rows[0].value;
  await sb.rpc('set_integration_secret', { p_integration_id: (await sb.from('integrations').select('id').eq('platform', 'meta').single()).data!.id, p_access_token: 'token-bom' });
  assertEquals((await post('meta-sync', {}, { 'x-cron-secret': 'errado' })).status, 401);
  const res = await post('meta-sync', {}, { 'x-cron-secret': secret });
  const body = await res.json();
  assertEquals(res.status, 200, JSON.stringify(body));
  assert(body.results.length >= 1 && body.results.every((r: { ok: boolean }) => r.ok), JSON.stringify(body));
  await db.end();
}});
