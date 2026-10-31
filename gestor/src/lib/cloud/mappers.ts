// Conversão entre o formato do app (camelCase) e as tabelas do Supabase (snake_case).
import type { AdSpend, CapitalMove, Collection, Expense, Product, Sale } from '../types';

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const opt = (v: unknown) => (v === null || v === undefined ? undefined : v);

export const TABLE: Record<Collection, string> = {
  products: 'products',
  sales: 'sales',
  ads: 'ads',
  expenses: 'expenses',
  capital: 'capital',
};

export const fromRow = {
  products: (r: Row): Product => ({
    id: String(r.id),
    name: String(r.name),
    market: String(r.market ?? ''),
    kind: r.kind as Product['kind'],
    active: Boolean(r.active),
    targetCpa: r.target_cpa === null || r.target_cpa === undefined ? undefined : Number(r.target_cpa),
  }),
  sales: (r: Row): Sale => ({
    id: String(r.id),
    date: String(r.date),
    productId: String(r.product_id),
    platform: String(r.platform ?? ''),
    country: String(r.country ?? ''),
    currency: String(r.currency),
    rate: num(r.rate),
    quantity: num(r.quantity),
    gross: num(r.gross),
    fees: num(r.fees),
    refunds: num(r.refunds),
    campaign: opt(r.campaign) as string | undefined,
    notes: opt(r.notes) as string | undefined,
    origin: (r.origin as Sale['origin']) ?? 'manual',
  }),
  ads: (r: Row): AdSpend => ({
    id: String(r.id),
    date: String(r.date),
    productId: r.product_id ? String(r.product_id) : '',
    source: String(r.source ?? ''),
    campaign: opt(r.campaign) as string | undefined,
    country: String(r.country ?? ''),
    currency: String(r.currency),
    rate: num(r.rate),
    amount: num(r.amount),
    notes: opt(r.notes) as string | undefined,
    origin: (r.origin as AdSpend['origin']) ?? 'manual',
    metrics: (r.metrics as AdSpend['metrics']) ?? null,
  }),
  expenses: (r: Row): Expense => ({
    id: String(r.id),
    date: String(r.date),
    category: String(r.category),
    description: String(r.description ?? ''),
    currency: String(r.currency),
    rate: num(r.rate),
    amount: num(r.amount),
    productId: r.product_id ? String(r.product_id) : undefined,
    recurrence: r.recurrence as Expense['recurrence'],
    endMonth: r.end_month ? String(r.end_month) : undefined,
    status: (r.status as Expense['status']) ?? 'active',
    pausedFrom: r.paused_from ? String(r.paused_from) : undefined,
    pauses: Array.isArray(r.pauses) && r.pauses.length ? (r.pauses as Expense['pauses']) : undefined,
    notes: opt(r.notes) as string | undefined,
  }),
  capital: (r: Row): CapitalMove => ({
    id: String(r.id),
    date: String(r.date),
    kind: r.kind as CapitalMove['kind'],
    description: String(r.description ?? ''),
    currency: String(r.currency),
    rate: num(r.rate),
    amount: num(r.amount),
    notes: opt(r.notes) as string | undefined,
  }),
} satisfies Record<Collection, (r: Row) => unknown>;

const nul = (v: unknown) => (v === undefined || v === '' ? null : v);

/** Linha para gravar. Campos controlados pelo servidor (user_id, origin automático) não são enviados. */
export const toRow = {
  products: (p: Product): Row => ({
    id: p.id,
    name: p.name,
    market: p.market ?? '',
    kind: p.kind,
    active: p.active,
    target_cpa: p.targetCpa ? p.targetCpa : null,
  }),
  sales: (s: Sale): Row => ({
    id: s.id,
    date: s.date,
    product_id: s.productId,
    platform: s.platform ?? '',
    country: s.country ?? '',
    currency: s.currency,
    rate: s.rate,
    quantity: s.quantity,
    gross: s.gross,
    fees: s.fees,
    refunds: s.refunds,
    // só envia quando o formulário tocou no campo (registros antigos continuam gravando sem ele)
    ...(s.campaign !== undefined ? { campaign: nul(s.campaign?.trim()) } : {}),
    notes: nul(s.notes),
  }),
  ads: (a: AdSpend): Row => ({
    id: a.id,
    date: a.date,
    product_id: nul(a.productId),
    source: a.source ?? '',
    campaign: nul(a.campaign),
    country: a.country ?? '',
    currency: a.currency,
    rate: a.rate,
    amount: a.amount,
    notes: nul(a.notes),
  }),
  expenses: (e: Expense): Row => ({
    id: e.id,
    date: e.date,
    category: e.category,
    description: e.description ?? '',
    currency: e.currency,
    rate: e.rate,
    amount: e.amount,
    product_id: nul(e.productId),
    recurrence: e.recurrence,
    end_month: e.recurrence === 'monthly' ? nul(e.endMonth) : null,
    status: e.status ?? 'active',
    paused_from: e.status === 'paused' ? nul(e.pausedFrom) : null,
    pauses: e.recurrence === 'monthly' ? (e.pauses ?? []) : [],
    notes: nul(e.notes),
  }),
  capital: (c: CapitalMove): Row => ({
    id: c.id,
    date: c.date,
    kind: c.kind,
    description: c.description ?? '',
    currency: c.currency,
    rate: c.rate,
    amount: c.amount,
    notes: nul(c.notes),
  }),
} satisfies Record<Collection, (x: never) => Row>;

/** Registros gerados automaticamente não podem ser editados/apagados pelo app. */
export function isLocked(collection: Collection, item: { origin?: string }): boolean {
  return (collection === 'sales' && item.origin === 'auto') || (collection === 'ads' && item.origin === 'meta');
}
