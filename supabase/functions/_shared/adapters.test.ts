// Rodar: deno test supabase/functions/_shared
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { ADAPTERS, cakto, generic, ggcheckout, hotmart, lastlink, perfectpay } from './adapters.ts';
import { processPayload, type Repo, type TransactionRow } from './process.ts';
import { dayIn, get, money, parseDate } from './util.ts';
import { caktoApproved, ggPaid, hotmartApproved, lastlinkConfirmed, perfectApproved } from './fixtures.ts';

const cfg = { timezone: 'America/Sao_Paulo' };

// ------------------------------------------------------------------ util
Deno.test('get: caminho sem diferenciar maiúsculas, _ e índices', () => {
  const o = { Data: { Purchase: { Price: { Value: 10 } }, Products: [{ Id: 'x' }] }, sale_amount: 5 };
  assertEquals(get(o, 'data.purchase.price.value'), 10);
  assertEquals(get(o, 'Data.Products.0.id'), 'x');
  assertEquals(get(o, 'saleAmount'), 5);
  assertEquals(get(o, 'nada.aqui'), undefined);
});

Deno.test('money: formatos de valor', () => {
  assertEquals(money(197), 197);
  assertEquals(money('197.00'), 197);
  assertEquals(money('1.234,56'), 1234.56);
  assertEquals(money('1,234.56'), 1234.56);
  assertEquals(money('R$ 97,90'), 97.9);
  assertEquals(money(19700, true), 197);
  assertEquals(money({ value: 47 }), 47);
  assertEquals(money(''), null);
});

Deno.test('parseDate: epoch, ISO e data local sem fuso', () => {
  assertEquals(parseDate(1760000000000), new Date(1760000000000).toISOString());
  assertEquals(parseDate(1760000000), new Date(1760000000000).toISOString());
  assertEquals(parseDate('2026-10-10 23:30:00', 'America/Sao_Paulo'), '2026-10-11T02:30:00.000Z');
  assertEquals(parseDate('10/10/2026 08:00', 'America/Sao_Paulo'), '2026-10-10T11:00:00.000Z');
  assertEquals(parseDate('2026-10-10T12:00:00Z'), '2026-10-10T12:00:00.000Z');
  // venda às 23h30 de Brasília conta no dia certo
  assertEquals(dayIn('2026-10-11T02:30:00.000Z', 'America/Sao_Paulo'), '2026-10-10');
});

// ------------------------------------------------------------------ Hotmart

Deno.test('Hotmart: compra aprovada internacional (líquido em BRL)', () => {
  const r = hotmart.parse(hotmartApproved, cfg);
  assertEquals(r.ignore, undefined);
  const t = r.items[0];
  assertEquals(t.externalId, 'HP1234567890');
  assertEquals(t.status, 'approved');
  assertEquals(t.currency, 'USD');
  assertEquals(t.gross, 27);
  assertEquals(t.net, 120.5);
  assertEquals(t.netCurrency, 'BRL');
  assertEquals(t.country, 'MX');
  assertEquals(t.productExternalId, '1234567');
});

Deno.test('Hotmart: reembolso, chargeback e eventos ignorados', () => {
  assertEquals(hotmart.parse({ ...hotmartApproved, event: 'PURCHASE_REFUNDED' }, cfg).items[0].status, 'refunded');
  assertEquals(hotmart.parse({ ...hotmartApproved, event: 'PURCHASE_CHARGEBACK' }, cfg).items[0].status, 'chargeback');
  assert(hotmart.parse({ ...hotmartApproved, event: 'SUBSCRIPTION_CANCELLATION' }, cfg).ignore);
  assert(hotmart.parse({ ...hotmartApproved, event: 'PURCHASE_OUT_OF_SHOPPING_CART' }, cfg).ignore);
});

Deno.test('Hotmart: hottok no cabeçalho', () => {
  assert(hotmart.verify({ headers: { 'x-hotmart-hottok': 'segredo' }, body: {}, secret: 'segredo' }));
  assert(!hotmart.verify({ headers: { 'x-hotmart-hottok': 'errado' }, body: {}, secret: 'segredo' }));
  assert(hotmart.verify({ headers: {}, body: {}, secret: null }), 'sem segredo configurado aceita');
});

// ------------------------------------------------------------------ Cakto

Deno.test('Cakto: compra aprovada com taxa', () => {
  const t = cakto.parse(caktoApproved, cfg).items[0];
  assertEquals(t.externalId, 'ord_abc');
  assertEquals(t.status, 'approved');
  assertEquals(t.gross, 197);
  assertEquals(t.fees, 9.86);
  assertEquals(t.productName, 'Método Fitness 21D');
  assertEquals(t.approvedAt, '2026-10-10T18:00:00.000Z');
});

Deno.test('Cakto: webhook v2 com lista (principal + order bump)', () => {
  const r = cakto.parse(
    { ...caktoApproved, data: [caktoApproved.data, { ...caktoApproved.data, id: 'ord_bump', amount: 37, fees: 1.85, product: { id: 'prod_2', name: 'Bump' } }] },
    cfg,
  );
  assertEquals(r.items.length, 2);
  assertEquals(r.items[1].externalId, 'ord_bump');
  assertEquals(r.items[1].gross, 37);
});

Deno.test('Cakto: eventos e segredo no corpo', () => {
  assertEquals(cakto.parse({ ...caktoApproved, event: 'refund' }, cfg).items[0].status, 'refunded');
  assertEquals(cakto.parse({ ...caktoApproved, event: 'chargeback' }, cfg).items[0].status, 'chargeback');
  assert(cakto.parse({ ...caktoApproved, event: 'pix_gerado' }, cfg).ignore);
  assert(cakto.verify({ headers: {}, body: caktoApproved, secret: 'cakto-secret' }));
  assert(!cakto.verify({ headers: {}, body: caktoApproved, secret: 'outro' }));
});

// ------------------------------------------------------------------ Lastlink

Deno.test('Lastlink: compra completa, reembolso e teste', () => {
  const t = lastlink.parse(lastlinkConfirmed, cfg).items[0];
  assertEquals(t.externalId, 'pay_777');
  assertEquals(t.gross, 397);
  assertEquals(t.productExternalId, 'LL-PROD');
  assertEquals(lastlink.parse({ ...lastlinkConfirmed, Event: 'Payment_Refund' }, cfg).items[0].status, 'refunded');
  assertEquals(lastlink.parse({ ...lastlinkConfirmed, IsTest: true }, cfg).test, true);
  // aceita chaves em camelCase também
  const camel = { event: 'Purchase_Order_Confirmed', data: { products: [{ id: 'p' }], purchase: { paymentId: 'x1', price: { value: 10 } } } };
  assertEquals(lastlink.parse(camel, cfg).items[0].externalId, 'x1');
});

// ------------------------------------------------------------------ GGCheckout

Deno.test('GGCheckout: pix pago, cartão, reembolso e segredo em cabeçalho', () => {
  const t = ggcheckout.parse(ggPaid, cfg).items[0];
  assertEquals(t.externalId, 'gg_pay_1');
  assertEquals(t.gross, 67.9);
  assertEquals(t.productName, 'Ebook Receitas');
  assertEquals(ggcheckout.parse({ ...ggPaid, event: 'card.paid' }, cfg).items[0].status, 'approved');
  assertEquals(ggcheckout.parse({ ...ggPaid, event: 'pix.refunded' }, cfg).items[0].status, 'refunded');
  assert(ggcheckout.parse({ ...ggPaid, event: 'pix.generated' }, cfg).ignore);
  assert(ggcheckout.verify({ headers: { authorization: 'Bearer s3' }, body: {}, secret: 's3' }));
  assert(ggcheckout.verify({ headers: { 'x-secret': 's3' }, body: {}, secret: 's3' }));
  assert(!ggcheckout.verify({ headers: {}, body: {}, secret: 's3' }));
});

// ------------------------------------------------------------------ PerfectPay

Deno.test('PerfectPay: aprovado, devolvido, chargeback, pendente e token', () => {
  const t = perfectpay.parse(perfectApproved, cfg).items[0];
  assertEquals(t.externalId, 'PPCPMTB5B6RC');
  assertEquals(t.gross, 197);
  assertEquals(t.approvedAt, '2026-10-10T12:05:00.000Z');
  assertEquals(perfectpay.parse({ ...perfectApproved, sale_status_enum: 7 }, cfg).items[0].status, 'refunded');
  assertEquals(perfectpay.parse({ ...perfectApproved, sale_status_enum: 9 }, cfg).items[0].status, 'chargeback');
  assert(perfectpay.parse({ ...perfectApproved, sale_status_enum: 1 }, cfg).ignore);
  assert(perfectpay.verify({ headers: {}, body: perfectApproved, secret: 'pp-token' }));
  assert(!perfectpay.verify({ headers: {}, body: perfectApproved, secret: 'x' }));
});

// ------------------------------------------------------------------ Genérico
Deno.test('Genérico: mapeamento configurável', () => {
  const body = { tx: { code: 'G1', state: 'PAGO', total: '1.234,50' }, item: { sku: 'S1', title: 'Curso' } };
  const r = generic.parse(body, {
    ...cfg,
    mapping: { externalId: 'tx.code', status: 'tx.state', gross: 'tx.total', productId: 'item.sku', productName: 'item.title' },
  });
  assertEquals(r.items[0].status, 'approved');
  assertEquals(r.items[0].gross, 1234.5);
  assert(generic.parse(body, cfg).ignore, 'sem mapeamento => ignora com aviso');
  const custom = generic.parse(body, { ...cfg, mapping: { externalId: 'tx.code', status: 'tx.state', gross: 'tx.total', statusMap: { pago: 'refunded' } } });
  assertEquals(custom.items[0].status, 'refunded');
});

// ------------------------------------------------------------------ Processamento
class MemoryRepo implements Repo {
  rows: TransactionRow[] = [];
  products = new Map<string, string>();
  async resolveProduct(platform: string, ext: string, name: string) {
    const k = `${platform}:${ext}`;
    if (!this.products.has(k)) this.products.set(k, `prod-${this.products.size + 1}:${name}`);
    return this.products.get(k)!;
  }
  async rate(currency: string) {
    return ({ USD: 5, EUR: 6 } as Record<string, number>)[currency] ?? 1;
  }
  async ingest(row: TransactionRow) {
    this.rows.push(row);
  }
}
const ctx = { userId: 'u1', integrationId: 'i1', platformKey: 'hotmart', platformLabel: 'Hotmart', eventId: 1 };

Deno.test('Processamento: Hotmart internacional calcula taxas pelo líquido em outra moeda', async () => {
  const repo = new MemoryRepo();
  const r = await processPayload(hotmart, hotmartApproved, cfg, ctx, repo);
  assertEquals(r.status, 'processed');
  const row = repo.rows[0];
  // bruto US$ 27 (= R$ 135); líquido R$ 120,50 (= US$ 24,10) => taxas US$ 2,90
  assertEquals(row.currency, 'USD');
  assertEquals(row.rate, 5);
  assertEquals(row.fees, 2.9);
  assertEquals(row.country, 'MX');
  assertEquals(row.fees_estimated, false);
});

Deno.test('Processamento: sem taxa informada usa % configurado e avisa', async () => {
  const repo = new MemoryRepo();
  const r = await processPayload(lastlink, lastlinkConfirmed, { ...cfg, feePercent: 10 }, { ...ctx, platformKey: 'lastlink', platformLabel: 'Lastlink' }, repo);
  assertEquals(repo.rows[0].fees, 39.7);
  assertEquals(repo.rows[0].fees_estimated, true);
  assert(r.message.includes('estimadas'));
  const repo2 = new MemoryRepo();
  const r2 = await processPayload(lastlink, lastlinkConfirmed, cfg, ctx, repo2);
  assertEquals(repo2.rows[0].fees, 0);
  assert(r2.message.includes('defina o % de taxa'));
});

Deno.test('Processamento: evento de teste e evento ignorado não gravam nada', async () => {
  const repo = new MemoryRepo();
  const t = await processPayload(lastlink, { ...lastlinkConfirmed, IsTest: true }, cfg, ctx, repo);
  assertEquals(t.status, 'ignored');
  assert(t.message.includes('TESTE'));
  const i = await processPayload(cakto, { ...caktoApproved, event: 'checkout_abandonment' }, cfg, ctx, repo);
  assertEquals(i.status, 'ignored');
  assertEquals(repo.rows.length, 0);
});

Deno.test('Processamento: data da venda no fuso de Brasília', async () => {
  const repo = new MemoryRepo();
  await processPayload(perfectpay, { ...perfectApproved, date_approved: '2026-10-10 23:50:00' }, cfg, ctx, repo);
  assertEquals(repo.rows[0].sale_date, '2026-10-10');
});

Deno.test('Todos os adaptadores registrados', () => {
  assertEquals(Object.keys(ADAPTERS).sort(), ['cakto', 'generic', 'ggcheckout', 'hotmart', 'lastlink', 'perfectpay']);
});
