import { describe, expect, it } from 'vitest';
import { breakdown, campaignBreakdown, campaignNames, capitalSummary, spendBreakdown, costSummary, autoGrouping, computeTotals, expandExpenses, timeSeries } from './metrics';
import { emptyDb } from './store';
import { previousPeriod, resolvePreset, weekStart } from './dates';
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
  it('caixa manual = aportes − retiradas − investimentos (independe do lucro)', () => {
    const d = db();
    d.capital = [
      { id: 'c1', date: '2026-01-01', kind: 'aporte', description: '', currency: 'BRL', rate: 1, amount: 1000 },
      { id: 'c2', date: '2026-01-20', kind: 'retirada', description: '', currency: 'BRL', rate: 1, amount: 200 },
    ];
    const c = capitalSummary(d, { from: '2026-01-01', to: '2026-01-31' });
    expect(c.cash).toBeCloseTo(1000 - 200);
  });
});

describe('períodos', () => {
  it('mês passado e período anterior', () => {
    expect(resolvePreset('lastMonth', '2026-03-15')).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousPeriod({ preset: '7d', from: '2026-03-09', to: '2026-03-15' })).toMatchObject({ from: '2026-03-02', to: '2026-03-08' });
  });
});

describe('campaignBreakdown', () => {
  it('soma gasto e métricas da Meta por campanha e calcula CTR, CPC e CPA do pixel', () => {
    const d = db();
    d.ads.push(
      { id: 'a3', date: '2026-01-10', productId: 'p1', source: 'Meta Ads', campaign: 'KETO 01', country: 'BR', currency: 'USD', rate: 5, amount: 20, origin: 'meta', metrics: { impressions: 1000, clicks: 50, purchases: 2 } },
      { id: 'a4', date: '2026-01-11', productId: 'p1', source: 'Meta Ads', campaign: 'KETO 01', country: 'MX', currency: 'USD', rate: 5, amount: 20, origin: 'meta', metrics: { impressions: 1000, clicks: 50, purchases: 2 } },
    );
    const rows = campaignBreakdown(d, { from: '2026-01-01', to: '2026-01-31' });
    const keto = rows.find((r) => r.campaign === 'KETO 01')!;
    expect(keto).toMatchObject({ ads: 200, impressions: 2000, clicks: 100, purchases: 4, pixelCpa: 50, cpc: 2 });
    expect(keto.ctr).toBeCloseTo(0.05);
    expect(keto.cpm).toBeCloseTo(100);
    expect(rows.find((r) => r.campaign === '(sem campanha)' && r.productId === 'p2')?.pixelCpa).toBeNull();
  });
  it('soma vendas lançadas com a campanha e calcula lucro e ROI da campanha', () => {
    const d = db();
    d.ads.push({ id: 'a3', date: '2026-01-10', productId: 'p1', source: 'Meta Ads', campaign: 'KETO 01', country: 'BR', currency: 'BRL', rate: 1, amount: 100 });
    d.sales.push({ id: 's3', date: '2026-01-10', productId: 'p1', platform: 'Hotmart', country: 'BR', currency: 'BRL', rate: 1, quantity: 2, gross: 400, fees: 40, refunds: 0, campaign: ' KETO 01 ' });
    const keto = campaignBreakdown(d, { from: '2026-01-01', to: '2026-01-31' }).find((r) => r.campaign === 'KETO 01')!;
    expect(keto).toMatchObject({ ads: 100, gross: 400, net: 360, units: 2, cpa: 50 });
    expect(keto.profit).toBeCloseTo(360 - 100 - 36); // imposto 10% sobre o líquido
    expect(keto.roi).toBeCloseTo((360 - 100 - 36) / 100);
  });
  it('filtro por campanha: só gastos e vendas da campanha, sem despesas', () => {
    const d = db();
    d.ads.push({ id: 'a3', date: '2026-01-10', productId: 'p1', source: 'Meta Ads', campaign: 'KETO 01', country: 'BR', currency: 'BRL', rate: 1, amount: 100 });
    d.sales.push({ id: 's3', date: '2026-01-10', productId: 'p1', platform: 'Hotmart', country: 'BR', currency: 'BRL', rate: 1, quantity: 2, gross: 400, fees: 40, refunds: 0, campaign: 'KETO 01' });
    const t = computeTotals(d, { from: '2026-01-01', to: '2026-01-31', campaign: 'KETO 01' });
    expect(t).toMatchObject({ ads: 100, gross: 400, units: 2, expenses: 0 });
    expect(campaignNames(d)).toEqual(['KETO 01']);
    expect(campaignNames(d, 'p2')).toEqual([]);
  });
});

describe('semana a semana', () => {
  it('semana começa na segunda', () => {
    expect(weekStart('2026-01-11')).toBe('2026-01-05'); // domingo
    expect(weekStart('2026-01-05')).toBe('2026-01-05'); // segunda
    expect(weekStart('2026-01-07')).toBe('2026-01-05');
  });
  it('agrupa por semana, da mais recente para a mais antiga', () => {
    const d = db(); // vendas e ads em 10 e 11/01 (sáb/dom), despesa em 05/01 (seg): mesma semana
    const w = costSummary(d, { from: '2025-12-29', to: '2026-01-14' }, 'week', '2026-01-14');
    expect(w.map((x) => [x.from, x.to, x.current, x.partial])).toEqual([
      ['2026-01-12', '2026-01-14', true, true],
      ['2026-01-05', '2026-01-11', false, false],
      ['2025-12-29', '2026-01-04', false, false],
    ]);
    expect(w[1].spend).toBe(650 + 100);
    expect(w[1].deductions).toBe(150 + 100 + 125);
    expect(w[1].totals.profit).toBe(375);
    expect(w[0].spend).toBe(0);
  });
  it('corta as pontas no período e agrupa por mês ou dia', () => {
    const d = db();
    const m = costSummary(d, { from: '2025-12-15', to: '2026-02-10' }, 'month', '2026-03-01');
    expect(m.map((x) => [x.from, x.to, x.partial, x.current])).toEqual([
      ['2026-02-01', '2026-02-10', true, false],
      ['2026-01-01', '2026-01-31', false, false],
      ['2025-12-15', '2025-12-31', true, false],
    ]);
    expect(m[1].totals.profit).toBe(375);
    const days = costSummary(d, { from: '2026-01-09', to: '2026-01-11' }, 'day');
    expect(days.map((x) => x.from)).toEqual(['2026-01-11', '2026-01-10', '2026-01-09']);
    expect(days.reduce((a, x) => a + x.spend, 0)).toBe(650);
  });
  it('a soma dos trechos bate com o total do período (todas as quebras)', () => {
    const d = db();
    const f = { from: '2025-11-20', to: '2026-01-20' };
    const total = computeTotals(d, f);
    for (const g of ['day', 'week', 'month'] as const) {
      const rows = costSummary(d, f, g);
      expect(rows.reduce((a, x) => a + x.totals.profit, 0)).toBeCloseTo(total.profit);
      expect(rows.reduce((a, x) => a + x.spend, 0)).toBeCloseTo(total.ads + total.expenses);
    }
  });
  it('agrupamento automático pelo tamanho do período', () => {
    expect(autoGrouping('2026-01-01', '2026-01-14')).toBe('day');
    expect(autoGrouping('2026-01-01', '2026-03-31')).toBe('week');
    expect(autoGrouping('2025-01-01', '2026-01-01')).toBe('month');
  });
  it('para onde foi o dinheiro', () => {
    const b = spendBreakdown(db(), { from: '2026-01-01', to: '2026-01-31' });
    expect(b.ads).toEqual([{ label: 'Meta Ads', amount: 400 }, { label: 'Google Ads', amount: 250 }]);
    expect(b.expenses).toEqual([{ label: 'Ferramentas / SaaS', amount: 100 }]);
  });
});

describe('impostos: CNPJ e Meta', () => {
  it('imposto da Meta incide só sobre o gasto da Meta e entra no lucro', () => {
    const d = db(); // ads: Meta 400 (BRL) e Google 50 USD (250)
    d.settings.adTaxRate = 12.15;
    const t = computeTotals(d, { from: '2026-01-01', to: '2026-01-31' });
    expect(t.adTax).toBeCloseTo(400 * 0.1215);
    expect(t.taxCompany).toBe(125); // 10% do líquido (1250)
    expect(t.tax).toBeCloseTo(125 + 48.6);
    expect(t.profit).toBeCloseTo(375 - 48.6);
    expect(t.roas).toBeCloseTo(1500 / 650); // ROAS continua sobre o gasto (igual ao Gerenciador)
  });
  it('imposto do CNPJ sobre o faturamento bruto', () => {
    const d = db();
    d.settings.taxBase = 'gross';
    const t = computeTotals(d, { from: '2026-01-01', to: '2026-01-31' });
    expect(t.taxCompany).toBe(150); // 10% de 1500
    expect(t.profit).toBe(1250 - 650 - 100 - 150);
  });
  it('quebras, série e semanas usam as mesmas regras', () => {
    const d = db();
    d.settings.adTaxRate = 10;
    d.settings.taxBase = 'gross';
    const f = { from: '2026-01-01', to: '2026-01-31' };
    const total = computeTotals(d, f).profit;
    const byProduct = breakdown(d, f, 'productId');
    expect(byProduct.find((r) => r.key === 'p1')!.adTax).toBeCloseTo(40);
    expect(timeSeries(d, f).points.at(-1)!.cumulative).toBeCloseTo(total);
    expect(costSummary(d, f, 'week').reduce((a, w) => a + w.totals.profit, 0)).toBeCloseTo(total);
  });
});
