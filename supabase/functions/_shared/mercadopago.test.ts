import { assertEquals } from 'jsr:@std/assert@1';
import { amount, kindLabel, parseCsv, toMovements } from './mercadopago.ts';
import { mpReleaseCsv as releaseCsv } from './fixtures.ts';



Deno.test('MP: CSV com ; e aspas', () => {
  const rows = parseCsv('﻿' + releaseCsv);
  assertEquals(rows.length, 5);
  assertEquals(rows[3].EXTERNAL_REFERENCE, 'ref; com ponto e vírgula');
  assertEquals(parseCsv('a,b\n1,"x,y"\n')[0], { A: '1', B: 'x,y' });
});

Deno.test('MP: valores', () => {
  assertEquals(amount('1234.56'), 1234.56);
  assertEquals(amount('-1.234,56'), -1234.56);
  assertEquals(amount('1,234.56'), 1234.56);
  assertEquals(amount(''), null);
  assertEquals(kindLabel('payout'), 'Saque / transferência');
  assertEquals(kindLabel('reserve_for_dispute'), 'Retenção (disputa)');
  assertEquals(kindLabel('algo_novo'), 'algo_novo');
});

Deno.test('MP: linhas viram entradas e saídas (sem totais nem linhas zeradas)', () => {
  const { movements, unknownColumns } = toMovements(parseCsv(releaseCsv), { userId: 'u', integrationId: 'i', timezone: 'America/Sao_Paulo' });
  assertEquals(unknownColumns, false);
  assertEquals(movements.map((m) => [m.date, m.direction, m.amount, m.kind, m.balance]), [
    ['2026-10-05', 'in', 188.15, 'Recebimento', 1188.15],
    ['2026-10-06', 'out', 500, 'Saque / transferência', 688.15],
    ['2026-10-07', 'out', 97, 'Reembolso', 591.15],
  ]);
  assertEquals(movements[0].fee, 8.85);
  assertEquals(movements[0].description, 'Recebimento · pedido-1');
  // a mesma linha em outro relatório gera o mesmo id (não duplica)
  const again = toMovements(parseCsv(releaseCsv), { userId: 'u', integrationId: 'i', timezone: 'America/Sao_Paulo' });
  assertEquals(again.movements.map((m) => m.external_id), movements.map((m) => m.external_id));
});

Deno.test('MP: colunas desconhecidas são sinalizadas', () => {
  const r = toMovements(parseCsv('FECHA;MONTO\n2026-10-05;10'), { userId: 'u', integrationId: 'i', timezone: 'America/Sao_Paulo' });
  assertEquals(r.unknownColumns, true);
  assertEquals(r.movements.length, 0);
});
