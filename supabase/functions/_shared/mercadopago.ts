// Mercado Pago: extrato da conta (entradas e saídas) a partir do "relatório de liberações"
// (release report). Funções puras + cliente HTTP mínimo — usados pela Edge Function bank-sync.
//
// Fluxo da API (https://api.mercadopago.com, token "Bearer APP_USR-…"):
//   GET/POST /v1/account/release_report/config   configuração do relatório (colunas, fuso, prefixo)
//   POST     /v1/account/release_report          pede um relatório para um período (gerado em segundo plano)
//   GET      /v1/account/release_report/list     relatórios disponíveis
//   GET      /v1/account/release_report/{file}   baixa o CSV
import { dayIn, parseDate } from './util.ts';

export const MP_COLUMNS = [
  'DATE',
  'SOURCE_ID',
  'EXTERNAL_REFERENCE',
  'RECORD_TYPE',
  'DESCRIPTION',
  'NET_CREDIT_AMOUNT',
  'NET_DEBIT_AMOUNT',
  'GROSS_AMOUNT',
  'MP_FEE_AMOUNT',
  'BALANCE_AMOUNT',
  'PAYMENT_METHOD',
];

// ------------------------------------------------------------------ CSV
/** CSV com separador detectado (; ou ,), aspas e quebras de linha dentro de aspas. Cabeçalho em MAIÚSCULAS. */
export function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim() !== ''));
  if (!head) return [];
  const keys = head.map((h) => h.trim().toUpperCase().replace(/\s+/g, '_'));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

/** "1234.56", "-1.234,56", "1,234.56" → número (null se vazio/ inválido). */
export function amount(v: string | undefined): number | null {
  if (v === undefined) return null;
  let s = v.trim().replace(/\s|R\$/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ------------------------------------------------------------------ linhas → movimentações
export interface BankMovement {
  user_id: string;
  integration_id: string;
  bank: 'mercadopago';
  external_id: string;
  date: string;
  occurred_at: string | null;
  direction: 'in' | 'out';
  amount: number;
  gross: number | null;
  fee: number | null;
  balance: number | null;
  kind: string;
  description: string;
  source_id: string | null;
  raw: Record<string, string>;
}

const KIND_LABEL: Record<string, string> = {
  payment: 'Recebimento',
  payout: 'Saque / transferência',
  withdrawal: 'Saque',
  refund: 'Reembolso',
  chargeback: 'Chargeback',
  dispute: 'Disputa',
  mediation: 'Mediação',
  reserve_for_dispute: 'Retenção (disputa)',
  reserve_for_refund: 'Retenção (reembolso)',
  reserve_for_payout: 'Retenção (saque)',
  reserve_for_bpp_shipping_return: 'Retenção (frete)',
  shipping: 'Frete',
  money_transfer: 'Transferência',
  fee: 'Tarifa',
  tax: 'Imposto',
  credit_payment: 'Pagamento de crédito',
  asset_management: 'Rendimento',
};

/** Rótulo em português para o tipo de movimentação do relatório. */
export function kindLabel(description: string): string {
  const d = description.toLowerCase().trim();
  if (KIND_LABEL[d]) return KIND_LABEL[d];
  const hit = Object.keys(KIND_LABEL).find((k) => d.startsWith(k) || d.includes(k));
  return hit ? KIND_LABEL[hit] : description || 'Movimentação';
}

/** Linhas que são só totais/saldo inicial do relatório, não movimentações. */
const SUMMARY = /initial|balance|total|subtotal|saldo/i;

export interface MovementCtx {
  userId: string;
  integrationId: string;
  timezone: string;
}

/**
 * Converte as linhas do relatório em movimentações (ignora totais e linhas zeradas).
 * `initial`: saldo disponível no início do relatório (linha initial_available_balance), quando vier.
 */
export function toMovements(
  rows: Record<string, string>[],
  ctx: MovementCtx,
): { movements: BankMovement[]; unknownColumns: boolean; initial: { date: string; balance: number } | null } {
  const unknownColumns = rows.length > 0 && !('NET_CREDIT_AMOUNT' in rows[0] || 'NET_DEBIT_AMOUNT' in rows[0]);
  const movements: BankMovement[] = [];
  let initial: { date: string; balance: number } | null = null;
  for (const r of rows) {
    const recordType = r.RECORD_TYPE ?? '';
    if (recordType && SUMMARY.test(recordType)) {
      const occurred = parseDate(r.DATE, ctx.timezone);
      const balance = amount(r.BALANCE_AMOUNT);
      if (!initial && /initial/i.test(recordType) && occurred && balance !== null) initial = { date: dayIn(occurred, ctx.timezone), balance };
      continue;
    }
    const credit = Math.abs(amount(r.NET_CREDIT_AMOUNT) ?? 0);
    const debit = Math.abs(amount(r.NET_DEBIT_AMOUNT) ?? 0);
    const net = Math.round((credit - debit) * 100) / 100;
    if (!net) continue;
    const occurred = parseDate(r.DATE, ctx.timezone);
    if (!occurred) continue;
    const description = r.DESCRIPTION ?? '';
    const sourceId = r.SOURCE_ID || null;
    movements.push({
      user_id: ctx.userId,
      integration_id: ctx.integrationId,
      bank: 'mercadopago',
      // mesma linha em relatórios sobrepostos gera o mesmo id → sem duplicar
      external_id: ['mp', sourceId ?? '', recordType, description, r.DATE ?? '', credit.toFixed(2), debit.toFixed(2)].join(':'),
      date: dayIn(occurred, ctx.timezone),
      occurred_at: occurred,
      direction: net > 0 ? 'in' : 'out',
      amount: Math.abs(net),
      gross: amount(r.GROSS_AMOUNT),
      fee: amount(r.MP_FEE_AMOUNT),
      balance: amount(r.BALANCE_AMOUNT),
      kind: kindLabel(description),
      description: [kindLabel(description), r.EXTERNAL_REFERENCE].filter(Boolean).join(' · '),
      source_id: sourceId,
      raw: r,
    });
  }
  return { movements, unknownColumns, initial };
}

// ------------------------------------------------------------------ API
export const mpBase = () => (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get('MP_API_BASE') || 'https://api.mercadopago.com';

export function mpError(status: number, body: unknown): string {
  const msg = (body as { message?: string; error?: string })?.message ?? (body as { error?: string })?.error ?? '';
  if (status === 401 || status === 403) return 'Token do Mercado Pago inválido ou sem permissão. Gere um Access Token de produção novo e salve de novo.';
  if (status === 429) return 'Mercado Pago pediu para esperar (muitas chamadas). Tente de novo em alguns minutos.';
  return `Mercado Pago respondeu ${status}${msg ? `: ${msg}` : ''}`;
}

export class MercadoPago {
  constructor(private token: string, private base = mpBase()) {}

  private async call(method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown; text: string }> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { status: res.status, data, text };
  }

  /** Garante que exista uma configuração do relatório (cria uma com as colunas que o sistema lê, se não houver). */
  async ensureConfig(timezone: string): Promise<void> {
    const got = await this.call('GET', '/v1/account/release_report/config');
    if (got.status === 200) return;
    if (got.status !== 404) throw new Error(mpError(got.status, got.data));
    const created = await this.call('POST', '/v1/account/release_report/config', {
      file_name_prefix: 'cadigital',
      include_withdraw: true,
      execute_after_withdrawal: false,
      display_timezone: timezone === 'America/Sao_Paulo' ? 'GMT-03' : 'GMT-00',
      report_translation: 'en',
      separator: ';',
      columns: MP_COLUMNS.map((key) => ({ key })),
    });
    if (created.status >= 300) throw new Error(mpError(created.status, created.data));
  }

  /** Pede um relatório do período (gerado em segundo plano pelo Mercado Pago). */
  async requestReport(begin: string, end: string): Promise<void> {
    const r = await this.call('POST', '/v1/account/release_report', { begin_date: `${begin}T00:00:00Z`, end_date: `${end}T23:59:59Z` });
    if (r.status >= 300) throw new Error(mpError(r.status, r.data));
  }

  async listReports(): Promise<{ file_name: string; status?: string; date_created?: string }[]> {
    const r = await this.call('GET', '/v1/account/release_report/list');
    if (r.status >= 300) throw new Error(mpError(r.status, r.data));
    return Array.isArray(r.data) ? (r.data as { file_name: string }[]).filter((x) => typeof x?.file_name === 'string') : [];
  }

  /** CSV do relatório, ou null se ainda não estiver pronto. */
  async download(fileName: string): Promise<string | null> {
    const r = await this.call('GET', `/v1/account/release_report/${encodeURIComponent(fileName)}`);
    if (r.status === 404 || r.status === 202) return null;
    if (r.status >= 300) throw new Error(mpError(r.status, r.data));
    return r.text;
  }
}
