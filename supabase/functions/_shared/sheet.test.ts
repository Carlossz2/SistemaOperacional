import { assert, assertEquals } from 'jsr:@std/assert@1';
import { guessMapping, parseCsvTable, parseSheetDate, rowsToTxs, sanitizeItem, statusFromText } from './sheet.ts';

const tz = 'America/Sao_Paulo';

Deno.test('Planilha: reconhece colunas típicas da Hotmart', () => {
  const headers = ['Transação', 'Produto', 'Código do Produto', 'Status da Transação', 'Data de Aprovação', 'Moeda', 'Preço Total', 'Comissão do Produtor', 'País', 'Email do Comprador', 'Nome', 'Forma de Pagamento'];
  const m = guessMapping(headers);
  assertEquals(m, { externalId: 0, productName: 1, productId: 2, status: 3, date: 4, currency: 5, gross: 6, net: 7, country: 8, buyerEmail: 9, buyerName: 10, paymentMethod: 11 });
});

Deno.test('Planilha: reconhece colunas típicas da Cakto', () => {
  const headers = ['ID do Pedido', 'Data de Pagamento', 'Status', 'Oferta', 'Valor', 'Valor Líquido', 'Taxas', 'Cliente', 'E-mail'];
  const m = guessMapping(headers);
  assertEquals([m.externalId, m.date, m.status, m.productName, m.gross, m.net, m.fees, m.buyerName, m.buyerEmail], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

Deno.test('Planilha: CSV com ; e aspas; datas e status', () => {
  const { headers, rows } = parseCsvTable('﻿a;b\n"1;2";x\n\n3;"y ""z"""\n');
  assertEquals(headers, ['a', 'b']);
  assertEquals(rows, [['1;2', 'x'], ['3', 'y "z"']]);
  // linha de título antes do cabeçalho (sem separador) não engana a detecção
  const t = parseCsvTable('Relatório de vendas - Hotmart\nTransação;Valor\nHP1;197,00\n');
  assertEquals([t.headers, t.rows], [['Relatório de vendas - Hotmart'], [['Transação', 'Valor'], ['HP1', '197,00']]]);
  assertEquals(parseSheetDate('05/10/2026 14:03:22', tz), '2026-10-05T17:03:22.000Z');
  assertEquals(parseSheetDate('5/10/2026', tz), '2026-10-05T03:00:00.000Z');
  assertEquals(parseSheetDate('2026-10-05', tz), '2026-10-05T03:00:00.000Z');
  assertEquals(parseSheetDate(46300, tz)?.slice(0, 10), '2026-10-05'); // serial do Excel
  assertEquals(parseSheetDate('ontem', tz), null);
  assertEquals(['Aprovado', 'COMPLETE', 'Reembolsado', 'Chargeback', 'Cancelada', 'Aguardando pagamento', 'Boleto impresso', 'xyz'].map(statusFromText), [
    'approved', 'approved', 'refunded', 'chargeback', 'canceled', 'pending', 'pending', null,
  ]);
});

Deno.test('Planilha: linhas viram vendas; erros e repetidas são apontados', () => {
  const headers = ['Transação', 'Produto', 'Status', 'Data', 'Preço Total', 'Comissão do Produtor', 'País'];
  const rows = [
    ['HP1', 'Método Reconquista', 'Aprovado', '05/10/2026 14:03', 'R$ 197,00', 'R$ 177,30', 'Brasil'],
    ['HP2', 'Método Reconquista', 'Reembolsado', '06/10/2026', '197', '177.3', 'BR'],
    ['HP1', 'Método Reconquista', 'Aprovado', '05/10/2026 14:03', '197', '177.3', 'BR'],
    ['', 'x', 'Aprovado', '06/10/2026', '1', '', ''],
    ['HP3', 'x', 'Aprovado', 'ontem', '1', '', ''],
    ['HP4', 'x', '???', '06/10/2026', '1', '', ''],
    ['', '', '', '', '', '', ''],
  ];
  const r = rowsToTxs(rows, guessMapping(headers), { timezone: tz, currency: 'BRL', assumeApproved: false });
  assertEquals(r.items.map((i) => [i.externalId, i.status, i.gross, i.net, i.country]), [
    ['HP1', 'approved', 197, 177.3, 'BR'],
    ['HP2', 'refunded', 197, 177.3, 'BR'],
  ]);
  assertEquals(r.items[0].approvedAt, '2026-10-05T17:03:00.000Z');
  assertEquals(r.skipped.map((s) => s.line), [4, 5, 6, 7]);
  assert(r.skipped[0].reason.includes('repetida'));
});

Deno.test('Planilha: sem coluna de status, opção de considerar aprovadas', () => {
  const r = rowsToTxs([['P1', '01/10/2026', '50']], { externalId: 0, date: 1, gross: 2 }, { timezone: tz, currency: 'USD', assumeApproved: true });
  assertEquals([r.items[0].status, r.items[0].currency], ['approved', 'USD']);
  const r2 = rowsToTxs([['P1', '01/10/2026', '50']], { externalId: 0, date: 1, gross: 2 }, { timezone: tz, currency: 'BRL', assumeApproved: false });
  assertEquals(r2.items.length, 0);
});

Deno.test('Planilha: servidor valida o que chega do app', () => {
  const ok = sanitizeItem({ externalId: ' HP1 ', status: 'approved', gross: 197, occurredAt: '2026-10-05T17:03:00Z', currency: 'brl', country: 'BR', quantity: 1, fees: null, net: 177.3 });
  assertEquals([ok?.externalId, ok?.currency, ok?.net], ['HP1', 'BRL', 177.3]);
  assertEquals(ok?.productExternalId, '', 'sem código e sem nome');
  const a = sanitizeItem({ externalId: 'a', status: 'approved', gross: 1, occurredAt: '2026-10-05', productName: 'Keto Black' });
  const b = sanitizeItem({ externalId: 'b', status: 'approved', gross: 1, occurredAt: '2026-10-05', productName: 'Método X' });
  assertEquals([a?.productExternalId, b?.productExternalId], ['nome:keto black', 'nome:metodo x'], 'produtos sem código não se misturam');
  assertEquals(sanitizeItem({ externalId: 'x', status: 'hack', gross: 1, occurredAt: '2026-10-05' }), null);
  assertEquals(sanitizeItem({ externalId: 'x', status: 'approved', gross: -1, occurredAt: '2026-10-05' }), null);
  assertEquals(sanitizeItem({ externalId: 'x', status: 'approved', gross: 1, occurredAt: 'nada' }), null);
});
