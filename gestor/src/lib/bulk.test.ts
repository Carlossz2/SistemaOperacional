import { describe, expect, it } from 'vitest';
import { parseBulkSales } from './bulk';

const opts = { baseCurrency: 'BRL', rates: { BRL: 1, USD: 5.4 }, defaultPlatform: 'Hotmart' };

describe('lançar vários de uma vez', () => {
  it('lê linhas com ; ou tab, cabeçalho opcional, moeda e cotação', () => {
    const text = [
      'Data;Produto;Vendas;Faturamento bruto;Moeda;Cotação;País;Plataforma;Observações',
      '31/03/2026;Calyx AI;7;294,10',
      '30/09/2026;Atlas Visual do Acesso por Cordas;327;6.848,57;BRL;;BR;Cakto;Histórico',
      '14/10/2026\tTruco de la reconquista\t8\t63,77\tUSD\t5,03\tMX',
      '',
    ].join('\n');
    const r = parseBulkSales(text, opts);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.date, x.productName, x.quantity, x.gross, x.currency, x.rate, x.country, x.platform])).toEqual([
      ['2026-03-31', 'Calyx AI', 7, 294.1, 'BRL', 1, 'BR', 'Hotmart'],
      ['2026-09-30', 'Atlas Visual do Acesso por Cordas', 327, 6848.57, 'BRL', 1, 'BR', 'Cakto'],
      ['2026-10-14', 'Truco de la reconquista', 8, 63.77, 'USD', 5.03, 'MX', 'Hotmart'],
    ]);
  });
  it('aponta erros por linha', () => {
    const r = parseBulkSales('31/02/2026;X;1;10\n01/03/2026;;1;10\n01/03/2026;X;um;10\n01/03/2026;X;1;10;EUR', { ...opts, rates: { BRL: 1 } });
    expect(r.rows).toEqual([]);
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 3, 4]);
    expect(r.errors[3].message).toContain('cotação');
  });
});
