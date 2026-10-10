import { describe, expect, it } from 'vitest';
import { breakdown, capitalSummary, computeTotals, expandExpenses, timeSeries } from './metrics';
import { emptyDb } from './store';
import { previousPeriod, resolvePreset } from './dates';
import type { Database, Expense } from './types';

function db(): Database {
  const d = emptyDb();
  d.settings.taxRate = 10;
  d.products = [
    { id: 'p1', name: 'A', market: 'BR', kind: 'front', active: true },
    { id: 'p2', name: 'B', market: 'US', kind: 'front', active: true },
  ];
  d.sales = [
    { id: 's1', date: '2026-01-10', productId: 'p1', platform: 'Kiwify', country: 'BR', currency: 'BRL', rate: 1, quantity: 10, gross: 1000, fees: 100, refunds: 0 },
    { id: 's2', date: '2026-01-11', productId: 'p2', platform: 'ClickBank', country: 'US', currency: 'USD', rate: 5, quantity: 2, gross: 100, fees: 10, refunds: 20 },
  ];
  d.ads = [
    { id: 'a1', date: '2026-01-10', productId: 'p1', source: 'Meta Ads', country: 'BR', currency: 'BRL', rate: 1, amount: 400 },
    { id: 'a2', date: '2026-01-11', productId: 'p2', source: 'Google Ads', country: 'US', currency: 'USD', rate: 5, amount: 50 },
  ];
  d.expenses = [
    { id: 'e1', date: '2026-01-05', category: 'Ferramentas / SaaS', description: 'X', currency: 'BRL', rate: 1, amount: 100, recurrence: 'none', productId: 'p1' },
  ];
  return d;
}

describe('computeTotals', () => {
  it('converte moedas pela cotação do lançamento e calcula o P&L', () => {
    const t = computeTotals(db(), { from: '2026-01-01', to: '2026-01-31' });
    expect(t.gross).toBe(1500); // 1000 + 100*5
    expect(t.fees).toBe(150);
    expect(t.refunds).toBe(100);
    expect(t.net).toBe(1250);
    expect(t.ads).toBe(650);
    expect(t.expenses).toBe(100);
    expect(t.tax).toBe(125);
    expect(t.profit).toBe(375);
    expect(t.units).toBe(12);
    expect(t.roas).toBeCloseTo(1500 / 650);
    expect(t.cpa).toBeCloseTo(650 / 12);
    expect(t.roi).toBeCloseTo(375 / 750);
  });

  it('respeita o período e retorna métricas nulas sem divisor', () => {
    const t = computeTotals(db(), { from: '2026-02-01', to: '2026-02-28' });
    expect(t.gross).toBe(0);
    expect(t.roas).toBeNull();
    expect(t.cpa).toBeNull();
  });

  it('filtro por país ignora despesas operacionais (margem de contribuição)', () => {
    const t = computeTotals(db(), { from: '2026-01-01', to: '2026-01-31', country: 'BR' });
    expect(t.expenses).toBe(0);
    expect(t.gross).toBe(1000);
  });

  it('filtro por produto inclui só despesas atribuídas a ele', () => {
    expect(computeTotals(db(), { from: '2026-01-01', to: '2026-01-31', productId: 'p1' }).expenses).toBe(100);
    expect(computeTotals(db(), { from: '2026-01-01', to: '2026-01-31', productId: 'p2' }).expenses).toBe(0);
  });
});

describe('expandExpenses', () => {
  const rec: Expense = { id: 'r', date: '2026-01-31', category: 'C', description: 'D', currency: 'BRL', rate: 1, amount: 50, recurrence: 'monthly', endMonth: '2026-04' };
  it('gera uma ocorrência por mês, ajustando o dia ao fim do mês e parando no mês final', () => {
    const occ = expandExpenses([rec], '2026-01-01', '2026-12-31');
    expect(occ.map((o) => o.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('não gera ocorrências antes da data inicial', () => {
    expect(expandExpenses([rec], '2025-11-01', '2026-01-30')).toHaveLength(0);
  });
});

describe('breakdown e séries', () => {
  it('quebra por produto soma receitas, ads e despesas atribuídas', () => {
    const rows = breakdown(db(), { from: '2026-01-01', to: '2026-01-31' }, 'productId');
    const p1 = rows.find((r) => r.key === 'p1')!;
    expect(p1.gross).toBe(1000);
    expect(p1.ads).toBe(400);
    expect(p1.expenses).toBe(100);
  });
  it('série diária fecha com o total', () => {
    const d = db();
    const f = { from: '2026-01-01', to: '2026-01-31' };
    const s = timeSeries(d, f);
    expect(s.granularity).toBe('day');
    expect(s.points).toHaveLength(31);
    expect(s.points.at(-1)!.cumulative).toBeCloseTo(computeTotals(d, f).profit);
  });
  it('caixa = aportes + lucro acumulado − retiradas − investimentos', () => {
    const d = db();
    d.capital = [
      { id: 'c1', date: '2026-01-01', kind: 'aporte', description: '', currency: 'BRL', rate: 1, amount: 1000 },
      { id: 'c2', date: '2026-01-20', kind: 'retirada', description: '', currency: 'BRL', rate: 1, amount: 200 },
    ];
    const c = capitalSummary(d, { from: '2026-01-01', to: '2026-01-31' });
    expect(c.cash).toBeCloseTo(1000 + 375 - 200);
  });
});

describe('períodos', () => {
  it('mês passado e período anterior', () => {
    expect(resolvePreset('lastMonth', '2026-03-15')).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousPeriod({ preset: '7d', from: '2026-03-09', to: '2026-03-15' })).toMatchObject({ from: '2026-03-02', to: '2026-03-08' });
  });
});
