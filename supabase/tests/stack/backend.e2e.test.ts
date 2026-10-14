// Teste de ponta a ponta do backend contra o "mini Supabase" local (start.sh precisa estar rodando).
// deno test -A supabase/tests/stack/backend.e2e.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import pg from 'npm:pg@8.13.1';
import { caktoApproved, hotmartApproved, perfectApproved } from '../../functions/_shared/fixtures.ts';

const URL_BASE = 'http://localhost:54321';
// o banco de testes começa sem administrador
const reset = new pg.Pool({ connectionString: Deno.env.get('DATABASE_URL') ?? 'postgres://postgres:postgres@localhost:5432/gestor_e2e' });
await reset.query('delete from auth.users');
await reset.end();
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
const { data: me } = await sb.auth.getUser();
const userId = me.user!.id;
const jwt = (await sb.auth.getSession()).data.session!.access_token;

Deno.test({ name: 'app grava e lê dados próprios pela API', ...opts, fn: async () => {
  assert(!(await sb.from('settings').upsert({ user_id: userId, data: { timezone: 'America/Sao_Paulo', rates: { USD: 5 } } })).error);
  const { error } = await sb.from('products').insert({ id: 'prod-keto', name: 'Keto' });
  assert(!error, error?.message);
}});

Deno.test({ name: 'segundo cadastro é recusado (conta de administrador única)', ...opts, fn: async () => {
  const intruder = createClient(URL_BASE, ANON, { auth: { persistSession: false } });
  const { error } = await intruder.auth.signUp({ email: `invasor-${Date.now()}@teste.com`, password: 'senha-forte-123' });
  assert(error, 'cadastro deveria falhar');
  const { data } = await intruder.rpc('gestor_has_admin');
  assertEquals(data, true);
  const { data: rows } = await intruder.from('products').select('*');
  assertEquals(rows ?? [], [], 'anônimo não lê nada');
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
  // sem login (ou com token inválido) não sincroniza
  const r2 = await post('meta-sync', { integrationId: meta!.id }, { Authorization: 'Bearer token-falso' });
  assertEquals(r2.status, 401);
}});

Deno.test({ name: 'planilha: importa histórico sem duplicar com o webhook e sem desfazer reembolso', ...opts, fn: async () => {
  const call = (body: unknown, auth = `Bearer ${jwt}`) => post('import-sales', body, { Authorization: auth });
  const item = (externalId: string, extra: Record<string, unknown> = {}) => ({
    externalId, status: 'approved', occurredAt: '2026-10-02T15:00:00Z', approvedAt: '2026-10-02T15:00:00Z',
    productExternalId: '', productName: 'Método Reconquista', quantity: 1, currency: 'BRL', gross: 197, fees: null, net: 177.3,
    country: 'BR', buyerEmail: null, buyerName: null, paymentMethod: null, rawStatus: 'Aprovado', ...extra,
  });
  const before = (await sb.from('transactions').select('id').eq('platform', 'hotmart')).data!.length;
  let res = await call({ platform: 'hotmart', items: [item('HP1234567890'), item('PLAN-1'), item('PLAN-2', { currency: 'USD', gross: 30, net: null, fees: 3 }), { externalId: 'ruim', status: 'x' }] });
  let body = await res.json();
  assertEquals(res.status, 200, JSON.stringify(body));
  assertEquals([body.imported, body.failed.length], [3, 1], JSON.stringify(body));
  const { data: tx } = await sb.from('transactions').select('external_id, status, fees, product_id').eq('platform', 'hotmart').order('external_id');
  assertEquals(tx!.length, before + 2, 'venda que já veio por webhook não duplica');
  assertEquals(tx!.find((t) => t.external_id === 'HP1234567890')!.status, 'refunded', 'importar "aprovada" não desfaz reembolso');
  assertEquals(Number(tx!.find((t) => t.external_id === 'PLAN-1')!.fees), 19.7, 'taxa derivada do líquido');
  const { data: prods } = await sb.from('products').select('id').ilike('name', 'Método Reconquista');
  assertEquals(prods!.length, 1, 'produto reaproveitado pelo nome');
  // importar de novo não duplica
  res = await call({ platform: 'hotmart', items: [item('PLAN-1'), item('PLAN-2', { currency: 'USD', gross: 30, net: null, fees: 3 })] });
  body = await res.json();
  assertEquals(body.imported, 2);
  assertEquals((await sb.from('transactions').select('id').eq('platform', 'hotmart')).data!.length, before + 2);
  // consolidado em Receitas (origem automática)
  const { data: sales } = await sb.from('sales').select('date, currency, quantity').eq('origin', 'auto').eq('date', '2026-10-02');
  assert(sales!.length >= 1, 'vendas importadas entram em Receitas');
  // proteções
  assertEquals((await call({ platform: 'hotmart', items: [item('X')] }, 'Bearer token-falso')).status, 401);
  assertEquals((await call({ platform: 'nada', items: [] })).status, 400);
  assertEquals((await call({ platform: 'hotmart', items: Array.from({ length: 501 }, (_, i) => item('L' + i)) })).status, 400);
}});

Deno.test({ name: 'Mercado Pago: pede relatório, importa quando fica pronto, sem duplicar; app só lê', ...opts, fn: async () => {
  const { data: bank, error } = await sb.from('integrations').insert({ platform: 'mercadopago', name: 'Mercado Pago', config: {} }).select().single();
  assert(!error, error?.message);
  const call = (body: Record<string, unknown>) => post('bank-sync', { integrationId: bank!.id, ...body }, { Authorization: `Bearer ${jwt}` });
  // sem token
  let body = await (await call({})).json();
  assert(!body.ok && body.results[0].message.includes('Access Token'), JSON.stringify(body));
  // token inválido
  await sb.rpc('set_integration_secret', { p_integration_id: bank!.id, p_access_token: 'mp-ruim' });
  body = await (await call({})).json();
  assert(!body.ok && body.results[0].message.includes('inválido'), JSON.stringify(body));
  // token certo: pede o relatório (ainda gerando)
  await sb.rpc('set_integration_secret', { p_integration_id: bank!.id, p_access_token: 'mp-bom' });
  body = await (await call({ since: '2026-10-01', until: '2026-10-07' })).json();
  assert(body.ok && body.results[0].message.includes('pedido'), JSON.stringify(body));
  assertEquals((await sb.from('bank_movements').select('id')).data?.length, 0);
  // fica pronto e entra
  await new Promise((r) => setTimeout(r, 1700));
  body = await (await call({ action: 'import' })).json();
  assert(body.ok && body.results[0].message.includes('3 movimentação'), JSON.stringify(body));
  const { data: mov } = await sb.from('bank_movements').select('*').order('date');
  assertEquals(mov!.map((m) => [m.date, m.direction, Number(m.amount)]), [['2026-10-05', 'in', 188.15], ['2026-10-06', 'out', 500], ['2026-10-07', 'out', 97]]);
  assertEquals(Number(mov![2].balance), 591.15);
  // o mesmo relatório não é importado de novo; outro relatório com as mesmas linhas não duplica
  await call({ since: '2026-10-01', until: '2026-10-07' });
  await new Promise((r) => setTimeout(r, 1700));
  await call({ action: 'import' });
  assertEquals((await sb.from('bank_movements').select('id')).data?.length, 3);
  // o app não altera o extrato
  await sb.from('bank_movements').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  const ins = await sb.from('bank_movements').insert({ user_id: userId, external_id: 'x', date: '2026-10-01', direction: 'in', amount: 1 });
  assert(ins.error, 'app não pode inserir no extrato');
  assertEquals((await sb.from('bank_movements').select('id')).data?.length, 3);
  // sem login
  assertEquals((await post('bank-sync', { integrationId: bank!.id }, { Authorization: 'Bearer token-falso' })).status, 401);
  // caixa controlado a partir de uma data: nada anterior é pedido nem guardado (inclusive o que já tinha entrado)
  const cfg = async () => (await sb.from('integrations').select('config').eq('id', bank!.id).single()).data!.config;
  await sb.from('integrations').update({ config: { ...(await cfg()), startDate: '2026-10-06' } }).eq('id', bank!.id);
  body = await (await call({ since: '2026-09-01', until: '2026-10-07' })).json();
  assert(body.ok && body.results[0].message.includes('2026-10-06 a 2026-10-07'), 'pede só a partir do início: ' + JSON.stringify(body));
  assertEquals((await cfg()).lastRequest, { since: '2026-10-06', until: '2026-10-07' });
  await new Promise((r) => setTimeout(r, 1700));
  await call({ action: 'import' });
  assertEquals(((await sb.from('bank_movements').select('date').order('date')).data ?? []).map((m) => m.date), ['2026-10-06', '2026-10-07']);
  body = await (await call({ since: '2026-09-01', until: '2026-10-05' })).json();
  assert(body.ok && body.results[0].message.includes('nada anterior'), 'período todo antes do início não é pedido: ' + JSON.stringify(body));
  // relatório que começa no dia do início traz o saldo da conta nesse dia
  await sb.from('integrations').update({ config: { ...(await cfg()), startDate: '2026-10-01' } }).eq('id', bank!.id);
  await call({ since: '2026-10-01', until: '2026-10-07' });
  await new Promise((r) => setTimeout(r, 1700));
  await call({ action: 'import' });
  assertEquals((await cfg()).opening, { date: '2026-10-01', balance: 1000, source: 'mercadopago' });
  // saldo informado à mão não é sobrescrito
  await sb.from('integrations').update({ config: { ...(await cfg()), opening: { date: '2026-10-01', balance: 900, source: 'manual' } } }).eq('id', bank!.id);
  await call({ since: '2026-10-01', until: '2026-10-07' });
  await new Promise((r) => setTimeout(r, 1700));
  await call({ action: 'import' });
  assertEquals((await cfg()).opening.balance, 900);
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
  assert(body.bank.length === 1 && body.bank[0].ok, 'agendador também atualiza o Mercado Pago: ' + JSON.stringify(body.bank));
  await db.end();
}});

Deno.test({ name: '2FA: sem o código o banco e as funções bloqueiam; com o código liberam', ...opts, fn: async () => {
  const { data: enroll, error } = await sb.auth.mfa.enroll({ factorType: 'totp' });
  assert(!error, error?.message);
  const wrong = await sb.auth.mfa.challengeAndVerify({ factorId: enroll!.id, code: '000000' });
  assert(wrong.error, 'código errado recusado');
  const ok = await sb.auth.mfa.challengeAndVerify({ factorId: enroll!.id, code: '123456' });
  assert(!ok.error, ok.error?.message);
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  assertEquals(aal?.currentLevel, 'aal2');
  // nova sessão só com senha (aal1)
  const email = (await sb.auth.getUser()).data.user!.email!;
  const fresh = createClient(URL_BASE, ANON, { auth: { persistSession: false } });
  await fresh.auth.signInWithPassword({ email, password: 'senha-forte-123' });
  const { data: lvl } = await fresh.auth.mfa.getAuthenticatorAssuranceLevel();
  assertEquals([lvl?.currentLevel, lvl?.nextLevel], ['aal1', 'aal2']);
  const { data: rows } = await fresh.from('products').select('*');
  assertEquals(rows?.length, 0, 'aal1 não lê dados');
  const aal1Jwt = (await fresh.auth.getSession()).data.session!.access_token;
  assertEquals((await post('reprocess', {}, { Authorization: `Bearer ${aal1Jwt}` })).status, 401);
  // depois do código, libera
  const factorId = (await fresh.auth.mfa.listFactors()).data!.totp[0].id;
  assert(!(await fresh.auth.mfa.challengeAndVerify({ factorId, code: '123456' })).error);
  const { data: rows2 } = await fresh.from('products').select('*');
  assert((rows2?.length ?? 0) > 0, 'aal2 lê dados');
  // remove o 2FA para não afetar outros testes
  assert(!(await fresh.auth.mfa.unenroll({ factorId })).error);
}});
