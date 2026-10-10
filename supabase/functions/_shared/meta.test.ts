import { assertEquals } from 'jsr:@std/assert@1';
import { insightsUrl, matchProduct, metaError, normalizeAccount, toAdRow } from './meta.ts';

Deno.test('Meta: conta, URL e regras de produto', () => {
  assertEquals(normalizeAccount('123'), 'act_123');
  assertEquals(normalizeAccount('act_123'), 'act_123');
  const url = new URL(insightsUrl('123', 'tok', '2026-10-01', '2026-10-07', {}));
  assertEquals(url.pathname, '/v23.0/act_123/insights');
  assertEquals(url.searchParams.get('breakdowns'), 'country');
  assertEquals(url.searchParams.get('time_increment'), '1');
  assertEquals(JSON.parse(url.searchParams.get('time_range')!), { since: '2026-10-01', until: '2026-10-07' });
  const rules = [{ contains: 'KETO', productId: 'p-keto' }, { contains: 'reconq', productId: 'p-rec' }];
  assertEquals(matchProduct('[ES] Reconquista - ABO 01', rules), 'p-rec');
  assertEquals(matchProduct('Teste', rules, 'p-default'), 'p-default');
  assertEquals(matchProduct('Teste', rules), null);
});

Deno.test('Meta: linha de insight vira gasto', () => {
  const row = toAdRow(
    { campaign_id: '99', campaign_name: 'KETO US', date_start: '2026-10-05', spend: '123.456', impressions: '1000', clicks: '40', country: 'us', account_currency: 'USD', actions: [{ action_type: 'purchase', value: '3' }] },
    { userId: 'u', account: '123', rate: 5.4, rules: [{ contains: 'keto', productId: 'p1' }], defaultProduct: null },
  )!;
  assertEquals(row.amount, 123.46);
  assertEquals(row.currency, 'USD');
  assertEquals(row.product_id, 'p1');
  assertEquals(row.country, 'US');
  assertEquals(row.external_id, 'meta:act_123:99:2026-10-05:US');
  assertEquals(row.metrics, { impressions: 1000, clicks: 40, purchases: 3 });
  assertEquals(toAdRow({ date_start: '2026-10-05', spend: '0' }, { userId: 'u', account: '1', rate: 1, defaultProduct: null }), null);
});

Deno.test('Meta: mensagens de erro', () => {
  assertEquals(metaError({ code: 190 }).includes('expirado'), true);
  assertEquals(metaError({ code: 17 }).includes('Limite'), true);
});
