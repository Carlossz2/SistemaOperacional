import type { AdSpend, CapitalMove, Database, Expense, Sale } from './types';
import { addMonths, daysBetween, monthOf, monthsBetween } from './dates';

export interface Filter {
  from: string;
  to: string;
  productId?: string;
  country?: string;
  /** Nome exato da campanha (gastos e vendas lançadas com campanha) */
  campaign?: string;
}

export const campaignOf = (x: { campaign?: string }) => x.campaign?.trim() ?? '';

const inRange = (date: string, f: Filter) => date >= f.from && date <= f.to;

export const toBase = (amount: number, rate: number) => (Number(amount) || 0) * (Number(rate) || 0);

export const saleGross = (s: Sale) => toBase(s.gross, s.rate);
export const saleFees = (s: Sale) => toBase(s.fees, s.rate);
export const saleRefunds = (s: Sale) => toBase(s.refunds, s.rate);
export const saleNet = (s: Sale) => saleGross(s) - saleFees(s) - saleRefunds(s);
export const adBase = (a: AdSpend) => toBase(a.amount, a.rate);

/** Ocorrência concreta de uma despesa (despesas mensais viram uma ocorrência por mês). */
export interface ExpenseOccurrence {
  expense: Expense;
  date: string;
  amount: number; // moeda base
}

function lastDayOfMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function expandExpenses(expenses: Expense[], from: string, to: string): ExpenseOccurrence[] {
  const out: ExpenseOccurrence[] = [];
  for (const e of expenses) {
    const amount = toBase(e.amount, e.rate);
    if (e.recurrence !== 'monthly') {
      if (e.date >= from && e.date <= to) out.push({ expense: e, date: e.date, amount });
      continue;
    }
    const day = Number(e.date.slice(8, 10));
    const start = monthOf(e.date) > monthOf(from) ? monthOf(e.date) : monthOf(from);
    const lastMonth = e.endMonth && e.endMonth < monthOf(to) ? e.endMonth : monthOf(to);
    for (let m = start; m <= lastMonth; m = addMonths(m, 1)) {
      const date = `${m}-${String(Math.min(day, lastDayOfMonth(m))).padStart(2, '0')}`;
      if (date >= e.date && date >= from && date <= to) out.push({ expense: e, date, amount });
    }
  }
  return out;
}

export interface Totals {
  gross: number;
  fees: number;
  refunds: number;
  net: number;
  units: number;
  ads: number;
  expenses: number;
  tax: number;
  profit: number;
  margin: number | null;
  roas: number | null;
  netRoas: number | null;
  roi: number | null;
  cpa: number | null;
  aov: number | null;
  refundRate: number | null;
}

const div = (a: number, b: number) => (b ? a / b : null);

export function buildTotals(
  parts: { gross: number; fees: number; refunds: number; units: number; ads: number; expenses: number },
  taxRate: number,
): Totals {
  const net = parts.gross - parts.fees - parts.refunds;
  const tax = Math.max(0, net) * (taxRate / 100);
  const profit = net - parts.ads - parts.expenses - tax;
  return {
    ...parts,
    net,
    tax,
    profit,
    margin: div(profit, parts.gross),
    roas: div(parts.gross, parts.ads),
    netRoas: div(net, parts.ads),
    roi: div(profit, parts.ads + parts.expenses),
    cpa: div(parts.ads, parts.units),
    aov: div(parts.gross, parts.units),
    refundRate: div(parts.refunds, parts.gross),
  };
}

function matchSale(s: Sale, f: Filter) {
  return (
    inRange(s.date, f) &&
    (!f.productId || s.productId === f.productId) &&
    (!f.country || s.country === f.country) &&
    (!f.campaign || campaignOf(s) === f.campaign)
  );
}
function matchAd(a: AdSpend, f: Filter) {
  return (
    inRange(a.date, f) &&
    (!f.productId || a.productId === f.productId) &&
    (!f.country || a.country === f.country) &&
    (!f.campaign || campaignOf(a) === f.campaign)
  );
}
/**
 * Com filtro de produto, só entram despesas atribuídas àquele produto.
 * Com filtro de país ou campanha, despesas não entram — o resultado vira margem de contribuição.
 */
function expenseOccurrences(db: Database, f: Filter) {
  if (f.country || f.campaign) return [];
  return expandExpenses(db.expenses, f.from, f.to).filter((o) => !f.productId || o.expense.productId === f.productId);
}

export function filtered(db: Database, f: Filter) {
  return {
    sales: db.sales.filter((s) => matchSale(s, f)),
    ads: db.ads.filter((a) => matchAd(a, f)),
    expenses: expenseOccurrences(db, f),
  };
}

const sum = <T,>(xs: T[], fn: (x: T) => number) => xs.reduce((acc, x) => acc + fn(x), 0);

export function computeTotals(db: Database, f: Filter): Totals {
  const { sales, ads, expenses } = filtered(db, f);
  return buildTotals(
    {
      gross: sum(sales, saleGross),
      fees: sum(sales, saleFees),
      refunds: sum(sales, saleRefunds),
      units: sum(sales, (s) => Number(s.quantity) || 0),
      ads: sum(ads, adBase),
      expenses: sum(expenses, (o) => o.amount),
    },
    db.settings.taxRate,
  );
}

export interface SeriesPoint {
  key: string; // dia (AAAA-MM-DD) ou mês (AAAA-MM)
  net: number;
  ads: number;
  expenses: number;
  tax: number;
  profit: number;
  cumulative: number;
}

/** Série temporal: diária até `maxDailyDays` (padrão ~3 meses), mensal acima disso. */
export function timeSeries(
  db: Database,
  f: Filter,
  maxDailyDays = 92,
): { granularity: 'day' | 'month'; points: SeriesPoint[] } {
  const days = daysBetween(f.from, f.to);
  const granularity = days.length > maxDailyDays ? 'month' : 'day';
  const keys = granularity === 'day' ? days : monthsBetween(f.from, f.to);
  const bucket = (date: string) => (granularity === 'day' ? date : monthOf(date));
  const map = new Map(keys.map((k) => [k, { net: 0, ads: 0, expenses: 0 }]));
  const { sales, ads, expenses } = filtered(db, f);
  for (const s of sales) map.get(bucket(s.date))!.net += saleNet(s);
  for (const a of ads) map.get(bucket(a.date))!.ads += adBase(a);
  for (const o of expenses) map.get(bucket(o.date))!.expenses += o.amount;
  let cumulative = 0;
  const points = keys.map((key) => {
    const b = map.get(key)!;
    const tax = Math.max(0, b.net) * (db.settings.taxRate / 100);
    const profit = b.net - b.ads - b.expenses - tax;
    cumulative += profit;
    return { key, ...b, tax, profit, cumulative };
  });
  return { granularity, points };
}

export interface BreakdownRow extends Totals {
  key: string;
}

/**
 * Quebra por dimensão (produto, país, plataforma, fonte de tráfego).
 * Despesas operacionais só entram na quebra por produto (quando atribuídas);
 * nas demais o lucro é margem de contribuição (receita líquida − ads − imposto).
 */
export function breakdown(db: Database, f: Filter, dim: 'productId' | 'country' | 'platform' | 'source'): BreakdownRow[] {
  const { sales, ads, expenses } = filtered(db, f);
  const rows = new Map<string, { gross: number; fees: number; refunds: number; units: number; ads: number; expenses: number }>();
  const get = (k: string) => {
    if (!rows.has(k)) rows.set(k, { gross: 0, fees: 0, refunds: 0, units: 0, ads: 0, expenses: 0 });
    return rows.get(k)!;
  };
  if (dim !== 'source') {
    for (const s of sales) {
      const r = get(String(s[dim] || '—'));
      r.gross += saleGross(s);
      r.fees += saleFees(s);
      r.refunds += saleRefunds(s);
      r.units += Number(s.quantity) || 0;
    }
  }
  if (dim !== 'platform') {
    for (const a of ads) get(String(a[dim] || '—')).ads += adBase(a);
  }
  if (dim === 'productId') {
    for (const o of expenses) if (o.expense.productId) get(o.expense.productId).expenses += o.amount;
  }
  return [...rows.entries()]
    .map(([key, parts]) => ({ key, ...buildTotals(parts, db.settings.taxRate) }))
    .sort((a, b) => b.gross + b.ads - (a.gross + a.ads));
}

export function expensesByCategory(db: Database, f: Filter) {
  const map = new Map<string, number>();
  for (const o of filtered(db, f).expenses) map.set(o.expense.category, (map.get(o.expense.category) || 0) + o.amount);
  return [...map.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
}

export interface CapitalSummary {
  aportes: number;
  retiradas: number;
  investimentos: number;
  /** Caixa estimado acumulado até o fim do período */
  cash: number;
  /** Lucro acumulado desde o primeiro lançamento até o fim do período */
  accumulatedProfit: number;
}

const capitalBase = (c: CapitalMove) => toBase(c.amount, c.rate);

export function capitalSummary(db: Database, f: Filter): CapitalSummary {
  const inPeriod = db.capital.filter((c) => inRange(c.date, f));
  const byKind = (moves: CapitalMove[], kind: CapitalMove['kind']) =>
    sum(moves.filter((c) => c.kind === kind), capitalBase);
  const allUntil = db.capital.filter((c) => c.date <= f.to);
  const accumulatedProfit = computeTotals(db, { from: '0000-01-01', to: f.to }).profit;
  return {
    aportes: byKind(inPeriod, 'aporte'),
    retiradas: byKind(inPeriod, 'retirada'),
    investimentos: byKind(inPeriod, 'investimento'),
    accumulatedProfit,
    cash: byKind(allUntil, 'aporte') + accumulatedProfit - byKind(allUntil, 'retirada') - byKind(allUntil, 'investimento'),
  };
}

export function earliestDate(db: Database): string | undefined {
  const dates = [...db.sales, ...db.ads, ...db.expenses, ...db.capital].map((x) => x.date).sort();
  return dates[0];
}

export interface CampaignRow extends Totals {
  campaign: string;
  source: string;
  productId: string;
  impressions: number;
  clicks: number;
  /** Compras informadas pelo pixel da Meta (podem divergir das vendas reais) */
  purchases: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  /** Gasto ÷ compras do pixel */
  pixelCpa: number | null;
}

/**
 * Por campanha (+ produto): gasto e métricas de entrega (Meta) e as vendas lançadas com o nome da campanha.
 * Despesas não entram: lucro = receita líquida − ads − imposto.
 */
export function campaignBreakdown(db: Database, f: Filter): CampaignRow[] {
  type Acc = { campaign: string; source: string; productId: string; impressions: number; clicks: number; purchases: number; gross: number; fees: number; refunds: number; units: number; ads: number };
  const rows = new Map<string, Acc>();
  const get = (campaign: string, productId: string, source: string) => {
    const key = `${campaign}|${productId}`;
    if (!rows.has(key)) rows.set(key, { campaign, source, productId, impressions: 0, clicks: 0, purchases: 0, gross: 0, fees: 0, refunds: 0, units: 0, ads: 0 });
    return rows.get(key)!;
  };
  for (const a of db.ads.filter((x) => matchAd(x, f))) {
    const r = get(campaignOf(a) || '(sem campanha)', a.productId, a.source);
    r.ads += adBase(a);
    r.impressions += Number(a.metrics?.impressions) || 0;
    r.clicks += Number(a.metrics?.clicks) || 0;
    r.purchases += Number(a.metrics?.purchases) || 0;
  }
  for (const s of db.sales.filter((x) => campaignOf(x) && matchSale(x, f))) {
    const r = get(campaignOf(s), s.productId, '');
    r.gross += saleGross(s);
    r.fees += saleFees(s);
    r.refunds += saleRefunds(s);
    r.units += Number(s.quantity) || 0;
  }
  return [...rows.values()]
    .map(({ campaign, source, productId, impressions, clicks, purchases, ...parts }) => ({
      campaign,
      source,
      productId,
      impressions,
      clicks,
      purchases,
      ...buildTotals({ ...parts, expenses: 0 }, db.settings.taxRate),
      ctr: div(clicks, impressions),
      cpc: div(parts.ads, clicks),
      cpm: impressions ? (parts.ads / impressions) * 1000 : null,
      pixelCpa: div(parts.ads, purchases),
    }))
    .sort((a, b) => b.ads + b.gross - (a.ads + a.gross));
}

/** Campanhas conhecidas (gastos e vendas), opcionalmente de um produto. */
export function campaignNames(db: Database, productId?: string): string[] {
  const names = new Set<string>();
  for (const x of [...db.ads, ...db.sales]) if (campaignOf(x) && (!productId || x.productId === productId)) names.add(campaignOf(x));
  return [...names].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
