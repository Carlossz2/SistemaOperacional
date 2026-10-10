// Processamento de um evento de webhook já autenticado: adaptador -> transações gravadas.
// Não depende do Supabase diretamente (recebe um "Repo"), para poder ser testado isoladamente.
import { type Adapter, type AdapterConfig, type NormalizedTx } from './adapters.ts';
import { dayIn, fmtBRL, round2 } from './util.ts';

export interface TransactionRow {
  user_id: string;
  integration_id: string | null;
  platform: string;
  platform_label: string;
  external_id: string;
  status: NormalizedTx['status'];
  raw_status: string;
  product_id: string;
  product_external_id: string;
  product_name: string;
  sale_date: string;
  country: string;
  currency: string;
  rate: number;
  quantity: number;
  gross: number;
  fees: number;
  net: number | null;
  fees_estimated: boolean;
  buyer_email: string | null;
  buyer_name: string | null;
  payment_method: string | null;
  approved_at: string | null;
  refunded_at: string | null;
  status_at: string;
  last_event_id: number | null;
}

export interface Repo {
  resolveProduct(platformKey: string, externalId: string, name: string): Promise<string>;
  /** BRL por 1 unidade da moeda no dia */
  rate(currency: string, day: string): Promise<number>;
  ingest(row: TransactionRow): Promise<void>;
}

export interface ProcessContext {
  userId: string;
  integrationId: string | null;
  /** chave da origem (hotmart, cakto, generic:<id>) */
  platformKey: string;
  platformLabel: string;
  eventId: number | null;
  now?: Date;
}

export interface ProcessResult {
  status: 'processed' | 'ignored';
  eventName: string;
  externalId: string | null;
  message: string;
}

const STATUS_PT: Record<NormalizedTx['status'], string> = {
  approved: 'Venda aprovada',
  refunded: 'Reembolso',
  chargeback: 'Chargeback',
  pending: 'Pendente',
  canceled: 'Cancelada/recusada',
};

export function describe(tx: NormalizedTx, fees?: number, estimated?: boolean): string {
  const parts = [STATUS_PT[tx.status], tx.productName || tx.productExternalId || 'produto sem nome', fmtBRL(tx.gross, tx.currency)];
  if (fees !== undefined) parts.push(`taxas ${fmtBRL(fees, tx.currency)}${estimated ? ' (estimadas)' : ''}`);
  if (tx.country) parts.push(tx.country);
  return parts.join(' · ');
}

export async function processPayload(
  adapter: Adapter,
  body: unknown,
  cfg: AdapterConfig,
  ctx: ProcessContext,
  repo: Repo,
): Promise<ProcessResult> {
  const tz = cfg.timezone || 'America/Sao_Paulo';
  const parsed = adapter.parse(body, { ...cfg, timezone: tz });
  const externalId = parsed.items[0]?.externalId ?? null;

  if (parsed.ignore) return { status: 'ignored', eventName: parsed.event, externalId, message: parsed.ignore };
  if (parsed.test) {
    return {
      status: 'ignored',
      eventName: parsed.event,
      externalId,
      message: `Evento de TESTE recebido e lido corretamente (não entra nos números): ${parsed.items.map((i) => describe(i)).join(' | ')}`,
    };
  }

  const nowIso = (ctx.now ?? new Date()).toISOString();
  const messages: string[] = [];
  for (const tx of parsed.items) {
    const when = tx.approvedAt ?? tx.occurredAt ?? nowIso;
    const saleDate = dayIn(when, tz);
    const currency = (tx.currency || 'BRL').toUpperCase();
    const rate = currency === 'BRL' ? 1 : await repo.rate(currency, saleDate);

    // Taxas: informadas > derivadas do líquido > % configurado (estimado)
    let fees = tx.fees;
    let estimated = false;
    if (fees === null && tx.net !== null) {
      let netInSaleCurrency = tx.net;
      const netCur = (tx.netCurrency || currency).toUpperCase();
      if (netCur !== currency) {
        const netRate = netCur === 'BRL' ? 1 : await repo.rate(netCur, saleDate);
        netInSaleCurrency = (tx.net * netRate) / rate;
      }
      fees = Math.max(0, tx.gross - netInSaleCurrency);
    }
    if (fees === null) {
      fees = (tx.gross * (cfg.feePercent ?? 0)) / 100;
      estimated = true;
    }
    fees = round2(Math.min(fees, tx.gross));

    const productId = await repo.resolveProduct(ctx.platformKey, tx.productExternalId, tx.productName);
    await repo.ingest({
      user_id: ctx.userId,
      integration_id: ctx.integrationId,
      platform: ctx.platformKey,
      platform_label: ctx.platformLabel,
      external_id: tx.externalId,
      status: tx.status,
      raw_status: tx.rawStatus,
      product_id: productId,
      product_external_id: tx.productExternalId || 'sem-id',
      product_name: tx.productName,
      sale_date: saleDate,
      country: tx.country || cfg.defaultCountry || 'BR',
      currency,
      rate,
      quantity: tx.quantity || 1,
      gross: round2(tx.gross),
      fees,
      net: tx.net,
      fees_estimated: estimated,
      buyer_email: tx.buyerEmail,
      buyer_name: tx.buyerName,
      payment_method: tx.paymentMethod,
      approved_at: tx.status === 'approved' ? when : tx.approvedAt,
      refunded_at: tx.status === 'refunded' || tx.status === 'chargeback' ? (tx.occurredAt ?? nowIso) : null,
      status_at: tx.occurredAt ?? nowIso,
      last_event_id: ctx.eventId,
    });
    messages.push(describe(tx, fees, estimated));
  }
  const hint = messages.some((m) => m.includes('(estimadas)')) && !cfg.feePercent
    ? ' — a plataforma não informou taxas; defina o % de taxa na integração'
    : '';
  return { status: 'processed', eventName: parsed.event, externalId, message: messages.join(' | ') + hint };
}
