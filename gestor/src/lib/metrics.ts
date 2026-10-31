import type { AdSpend, CapitalMove, Database, Expense, Sale, Settings } from './types';
import { addDays, addMonths, daysBetween, monthOf, monthsBetween, weekStart } from './dates';
import { chargedIn } from './expenseStatus';

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

/** Gasto da Meta (sincronizado ou lançado como Meta/Facebook/Instagram) — sobre ele incidem os impostos da Meta. */
export const isMetaAd = (a: AdSpend) => a.origin === 'meta' || /meta|facebook|instagram/i.test(a.source ?? '');
export const adTaxOf = (a: AdSpend, s: Pick<Settings, 'adTaxRate'>) => (isMetaAd(a) ? (adBase(a) * (Number(s.adTaxRate) || 0)) / 100 : 0);

export type TaxCfg = Pick<Settings, 'taxRate' | 'taxBase' | 'adTaxRate'>;
/** Imposto do CNPJ sobre a receita líquida (padrão) ou sobre o faturamento bruto. */
export const companyTax = (gross: number, net: number, cfg: TaxCfg) =>
  Math.max(0, cfg.taxBase === 'gross' ? gross : net) * ((Number(cfg.taxRate) || 0) / 100);

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
      // despesa única cancelada não conta
      if (e.status !== 'canceled' && e.date >= from && e.date <= to) out.push({ expense: e, date: e.date, amount });
      continue;
    }
    const day = Number(e.date.slice(8, 10));
    const start = monthOf(e.date) > monthOf(from) ? monthOf(e.date) : monthOf(from);
    const lastMonth = e.endMonth && e.endMonth < monthOf(to) ? e.endMonth : monthOf(to);
    for (let m = start; m <= lastMonth; m = addMonths(m, 1)) {
      if (!chargedIn(e, m)) continue; // pausada nesse mês
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
  /** Impostos totais = imposto do CNPJ + impostos da Meta */
  tax: number;
  /** Imposto do CNPJ */
  taxCompany: number;
  /** Impostos cobrados pela Meta sobre os anúncios */
  adTax: number;
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

export interface TotalsParts {
  gross: number;
  fees: number;
  refunds: number;
  units: number;
  ads: number;
  expenses: number;
  /** Impostos da Meta já calculados sobre o gasto (ver adTaxOf) */
  adTax?: number;
}

export function buildTotals(parts: TotalsParts, cfg: TaxCfg | number): Totals {
  const tc: TaxCfg = typeof cfg === 'number' ? { taxRate: cfg } : cfg;
  const net = parts.gross - parts.fees - parts.refunds;
  const taxCompany = companyTax(parts.gross, net, tc);
  const adTax = parts.adTax ?? 0;
  const tax = taxCompany + adTax;
  const profit = net - parts.ads - parts.expenses - tax;
  return {
    ...parts,
    net,
    tax,
    taxCompany,
    adTax,
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
      adTax: sum(ads, (a) => adTaxOf(a, db.settings)),
      expenses: sum(expenses, (o) => o.amount),
    },
    db.settings,
  );
}

export interface SeriesPoint {
  key: string; // dia (AAAA-MM-DD) ou mês (AAAA-MM)
  gross: number;
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
  const map = new Map(keys.map((k) => [k, { gross: 0, net: 0, ads: 0, adTax: 0, expenses: 0 }]));
  const { sales, ads, expenses } = filtered(db, f);
  for (const s of sales) {
    const b = map.get(bucket(s.date))!;
    b.net += saleNet(s);
    b.gross += saleGross(s);
  }
  for (const a of ads) {
    const b = map.get(bucket(a.date))!;
    b.ads += adBase(a);
    b.adTax += adTaxOf(a, db.settings);
  }
  for (const o of expenses) map.get(bucket(o.date))!.expenses += o.amount;
  let cumulative = 0;
  const points = keys.map((key) => {
    const { adTax, ...b } = map.get(key)!;
    const tax = companyTax(b.gross, b.net, db.settings) + adTax;
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
  const rows = new Map<string, Required<TotalsParts>>();
  const get = (k: string) => {
    if (!rows.has(k)) rows.set(k, { gross: 0, fees: 0, refunds: 0, units: 0, ads: 0, adTax: 0, expenses: 0 });
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
    for (const a of ads) {
      const r = get(String(a[dim] || '—'));
      r.ads += adBase(a);
      r.adTax += adTaxOf(a, db.settings);
    }
  }
  if (dim === 'productId') {
    for (const o of expenses) if (o.expense.productId) get(o.expense.productId).expenses += o.amount;
  }
  return [...rows.entries()]
    .map(([key, parts]) => ({ key, ...buildTotals(parts, db.settings) }))
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
  /** Caixa pelos lançamentos manuais até o fim do período: aportes − retiradas − investimentos (não depende de vendas nem lucro) */
  cash: number;
}

const capitalBase = (c: CapitalMove) => toBase(c.amount, c.rate);

export function capitalSummary(db: Database, f: Filter): CapitalSummary {
  const inPeriod = db.capital.filter((c) => inRange(c.date, f));
  const byKind = (moves: CapitalMove[], kind: CapitalMove['kind']) =>
    sum(moves.filter((c) => c.kind === kind), capitalBase);
  const allUntil = db.capital.filter((c) => c.date <= f.to);
  return {
    aportes: byKind(inPeriod, 'aporte'),
    retiradas: byKind(inPeriod, 'retirada'),
    investimentos: byKind(inPeriod, 'investimento'),
    cash: byKind(allUntil, 'aporte') - byKind(allUntil, 'retirada') - byKind(allUntil, 'investimento'),
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
  type Acc = { campaign: string; source: string; productId: string; impressions: number; clicks: number; purchases: number; gross: number; fees: number; refunds: number; units: number; ads: number; adTax: number };
  const rows = new Map<string, Acc>();
  const get = (campaign: string, productId: string, source: string) => {
    const key = `${campaign}|${productId}`;
    if (!rows.has(key)) rows.set(key, { campaign, source, productId, impressions: 0, clicks: 0, purchases: 0, gross: 0, fees: 0, refunds: 0, units: 0, ads: 0, adTax: 0 });
    return rows.get(key)!;
  };
  for (const a of db.ads.filter((x) => matchAd(x, f))) {
    const r = get(campaignOf(a) || '(sem campanha)', a.productId, a.source);
    r.ads += adBase(a);
    r.adTax += adTaxOf(a, db.settings);
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
      ...buildTotals({ ...parts, expenses: 0 }, db.settings),
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

export type Grouping = 'day' | 'week' | 'month';

export interface CostRow {
  /** Início do trecho (dia, segunda-feira ou dia 1; cortado no início do período) */
  from: string;
  /** Fim do trecho (cortado no fim do período) */
  to: string;
  /** Trecho ainda em andamento (contém hoje e não acabou) */
  current: boolean;
  /** Trecho cortado pelo período (não é o dia/semana/mês inteiro) */
  partial: boolean;
  totals: Totals;
  /** Tráfego + despesas operacionais */
  spend: number;
  /** Taxas + reembolsos + impostos */
  deductions: number;
}

const bucketStart = (d: string, g: Grouping) => (g === 'day' ? d : g === 'week' ? weekStart(d) : `${monthOf(d)}-01`);
const bucketEnd = (start: string, g: Grouping) => (g === 'day' ? start : g === 'week' ? addDays(start, 6) : addDays(`${addMonths(monthOf(start), 1)}-01`, -1));

/** Agrupamento automático pelo tamanho do período: até 14 dias por dia, até ~6 meses por semana, acima disso por mês. */
export function autoGrouping(from: string, to: string): Grouping {
  const days = daysBetween(from, to).length;
  return days <= 14 ? 'day' : days <= 186 ? 'week' : 'month';
}

/** Custos e resultado do período quebrados por dia, semana (seg–dom) ou mês, do mais recente para o mais antigo. */
export function costSummary(db: Database, f: Filter, g: Grouping, ref: string = f.to): CostRow[] {
  const out: CostRow[] = [];
  for (let start = bucketStart(f.from, g); start <= f.to; start = addDays(bucketEnd(start, g), 1)) {
    const end = bucketEnd(start, g);
    const from = start < f.from ? f.from : start;
    const to = end > f.to ? f.to : end;
    const totals = computeTotals(db, { ...f, from, to });
    out.push({
      from,
      to,
      current: from <= ref && ref < end,
      partial: from !== start || to !== end,
      totals,
      spend: totals.ads + totals.expenses,
      deductions: totals.fees + totals.refunds + totals.tax,
    });
  }
  return out.reverse();
}

/** Para onde foi o dinheiro no período: tráfego por fonte e despesas por categoria (moeda base). */
export function spendBreakdown(db: Database, f: Filter) {
  const { ads, expenses } = filtered(db, f);
  const group = <T,>(xs: T[], key: (x: T) => string, val: (x: T) => number) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + val(x));
    return [...m.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
  };
  return {
    ads: group(ads, (a) => a.source || 'Outros', adBase),
    expenses: group(expenses, (o) => o.expense.category || 'Outros', (o) => o.amount),
  };
}
