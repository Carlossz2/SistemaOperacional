// Adaptadores de webhook: transformam o payload de cada plataforma num formato único.
//
// Formatos baseados na documentação pública das plataformas (out/2026). Como as plataformas
// mudam campos com o tempo, a leitura é tolerante (vários caminhos possíveis, chaves sem
// diferenciar maiúsculas) e o payload bruto é SEMPRE guardado — se algo mudar, é só ajustar
// aqui e reprocessar os eventos.
import { bearer, country, first, get, money, parseDate, safeEqual, str } from './util.ts';

export type TxStatus = 'approved' | 'refunded' | 'chargeback' | 'pending' | 'canceled';
export type PlatformKey = 'hotmart' | 'cakto' | 'lastlink' | 'ggcheckout' | 'perfectpay' | 'generic';

export interface NormalizedTx {
  externalId: string;
  status: TxStatus;
  rawStatus: string;
  occurredAt: string | null;
  approvedAt: string | null;
  productExternalId: string;
  productName: string;
  quantity: number;
  currency: string;
  gross: number;
  /** Taxas da plataforma + afiliados/coprodutores, quando a plataforma informa */
  fees: number | null;
  /** Valor líquido do produtor, quando a plataforma informa */
  net: number | null;
  /** Moeda do líquido, se diferente da moeda da venda (ex.: Hotmart internacional) */
  netCurrency?: string | null;
  country: string | null;
  buyerEmail: string | null;
  buyerName: string | null;
  paymentMethod: string | null;
}

export interface ParseResult {
  event: string;
  /** Evento de teste da plataforma: é validado, mas não entra nos números */
  test?: boolean;
  /** Motivo para ignorar (evento que não é venda/reembolso) */
  ignore?: string;
  items: NormalizedTx[];
}

export interface GenericMapping {
  event?: string;
  externalId: string;
  status: string;
  statusMap?: Record<string, TxStatus | 'ignore'>;
  gross: string;
  fees?: string;
  net?: string;
  currency?: string;
  productId?: string;
  productName?: string;
  country?: string;
  date?: string;
  email?: string;
  name?: string;
}

export interface AdapterConfig {
  /** % de taxa usada quando a plataforma não informa taxas/líquido */
  feePercent?: number;
  /** Valores chegam em centavos */
  amountsInCents?: boolean;
  defaultCountry?: string;
  timezone?: string;
  mapping?: GenericMapping;
}

export interface VerifyInput {
  headers: Record<string, string>;
  body: unknown;
  secret: string | null;
}

export interface Adapter {
  key: PlatformKey;
  label: string;
  /** true = autêntico; false = segredo não confere. Sem segredo configurado, aceita (a URL já é secreta). */
  verify(input: VerifyInput): boolean;
  parse(body: unknown, cfg: AdapterConfig): ParseResult;
  /** Onde o usuário encontra o segredo e quais eventos ativar */
  help: { secretLabel: string; where: string; events: string[] };
}

const lower = (v: unknown) => str(v).toLowerCase();

function checkSecret(secret: string | null, candidates: unknown[]): boolean {
  if (!secret) return true;
  return candidates.some((c) => typeof c === 'string' && c.length > 0 && safeEqual(c.trim(), secret.trim()));
}

function base(partial: Partial<NormalizedTx> & Pick<NormalizedTx, 'externalId' | 'status' | 'rawStatus' | 'gross'>): NormalizedTx {
  return {
    occurredAt: null,
    approvedAt: null,
    productExternalId: '',
    productName: '',
    quantity: 1,
    currency: 'BRL',
    fees: null,
    net: null,
    netCurrency: null,
    country: null,
    buyerEmail: null,
    buyerName: null,
    paymentMethod: null,
    ...partial,
  };
}

// ---------------------------------------------------------------------------------- Hotmart
// Webhook 2.0.0: { id, creation_date, event: "PURCHASE_APPROVED", version, data: { product, buyer, purchase, commissions[] } }
// Autenticação: cabeçalho X-HOTMART-HOTTOK.
const HOTMART_STATUS: Record<string, TxStatus | 'ignore'> = {
  PURCHASE_APPROVED: 'approved',
  PURCHASE_COMPLETE: 'approved',
  PURCHASE_REFUNDED: 'refunded',
  PURCHASE_CHARGEBACK: 'chargeback',
  PURCHASE_CANCELED: 'canceled',
  PURCHASE_EXPIRED: 'canceled',
  PURCHASE_PROTEST: 'ignore',
  PURCHASE_DELAYED: 'ignore',
  PURCHASE_BILLET_PRINTED: 'pending',
  PURCHASE_OUT_OF_SHOPPING_CART: 'ignore',
};

export const hotmart: Adapter = {
  key: 'hotmart',
  label: 'Hotmart',
  help: {
    secretLabel: 'Hottok de verificação',
    where: 'Hotmart → Ferramentas → Webhook (API e Notificações) → Configuração → Hottok',
    events: ['Compra aprovada', 'Compra completa', 'Compra reembolsada', 'Chargeback', 'Compra cancelada'],
  },
  verify: ({ headers, body, secret }) => checkSecret(secret, [headers['x-hotmart-hottok'], get(body, 'hottok')]),
  parse(body, cfg) {
    const event = str(get(body, 'event')).toUpperCase();
    const mapped = HOTMART_STATUS[event];
    if (!mapped || mapped === 'ignore') return { event, ignore: `Evento ${event || '(sem nome)'} não altera vendas`, items: [] };
    const d = get(body, 'data');
    const transaction = str(first(d, ['purchase.transaction', 'purchase.transaction_id']));
    if (!transaction) return { event, ignore: 'Evento sem código de transação', items: [] };
    const priceCurrency = str(first(d, ['purchase.price.currency_value', 'purchase.full_price.currency_value'])) || 'BRL';
    const gross = money(first(d, ['purchase.price.value', 'purchase.full_price.value', 'purchase.original_offer_price.value']), cfg.amountsInCents) ?? 0;
    const commissions = (get(d, 'commissions') as unknown[]) ?? [];
    const producer = Array.isArray(commissions) ? commissions.find((c) => lower(get(c, 'source')) === 'producer') : undefined;
    const net = producer ? money(get(producer, 'value'), cfg.amountsInCents) : null;
    const netCurrency = producer ? str(get(producer, 'currency_value')) || priceCurrency : null;
    const tz = cfg.timezone;
    return {
      event,
      items: [
        base({
          externalId: transaction,
          status: mapped,
          rawStatus: event,
          occurredAt: parseDate(first(body, ['creation_date']), tz),
          approvedAt: parseDate(first(d, ['purchase.approved_date', 'purchase.order_date']), tz),
          productExternalId: str(first(d, ['product.id', 'product.ucode'])),
          productName: str(get(d, 'product.name')),
          currency: priceCurrency.toUpperCase(),
          gross,
          net,
          netCurrency: netCurrency ? netCurrency.toUpperCase() : null,
          country: country(first(d, ['buyer.address.country_iso', 'buyer.address.country'])),
          buyerEmail: str(get(d, 'buyer.email')) || null,
          buyerName: str(get(d, 'buyer.name')) || null,
          paymentMethod: str(get(d, 'purchase.payment.type')) || null,
        }),
      ],
    };
  },
};

// ---------------------------------------------------------------------------------- Cakto
// { secret, event: "purchase_approved", data: { id, status, amount, baseAmount, fees, product{id,name}, offer, customer, paidAt, createdAt, commissions[] } }
// No webhook v2, "data" pode ser uma LISTA (produto principal + order bumps).
const CAKTO_STATUS: Record<string, TxStatus | 'ignore'> = {
  purchase_approved: 'approved',
  subscription_renewed: 'approved',
  refund: 'refunded',
  chargeback: 'chargeback',
  purchase_refused: 'canceled',
};

export const cakto: Adapter = {
  key: 'cakto',
  label: 'Cakto',
  help: {
    secretLabel: 'Chave secreta do webhook',
    where: 'Cakto → Integrações → Webhooks → criar/editar → campo "Secret"',
    events: ['Compra aprovada', 'Reembolso', 'Chargeback', 'Renovação de assinatura', 'Compra recusada'],
  },
  verify: ({ headers, body, secret }) => checkSecret(secret, [get(body, 'secret'), headers['x-cakto-secret'], bearer(headers['authorization'])]),
  parse(body, cfg) {
    const event = lower(get(body, 'event'));
    const mapped = CAKTO_STATUS[event];
    if (!mapped || mapped === 'ignore') return { event, ignore: `Evento ${event || '(sem nome)'} não altera vendas`, items: [] };
    const raw = get(body, 'data');
    const orders = (Array.isArray(raw) ? raw : [raw]).filter((o) => o && typeof o === 'object');
    const tz = cfg.timezone;
    const items = orders
      .map((o) => {
        const id = str(first(o, ['id', 'refId', 'orderId']));
        if (!id) return null;
        const product = get(o, 'product');
        const productId = typeof product === 'string' ? product : str(first(o, ['product.id', 'offer.id']));
        const productName = typeof product === 'string' ? '' : str(first(o, ['product.name', 'offer.name']));
        const commissions = get(o, 'commissions');
        const producer = Array.isArray(commissions)
          ? commissions.find((c) => /produc|owner|seller|vendedor/.test(lower(first(c, ['type', 'role', 'kind']))))
          : undefined;
        const net = producer ? money(first(producer, ['totalAmount', 'amount', 'value']), cfg.amountsInCents) : null;
        return base({
          externalId: id,
          status: mapped,
          rawStatus: `${event}/${lower(get(o, 'status'))}`,
          occurredAt: parseDate(first(o, ['updatedAt', 'createdAt']), tz),
          approvedAt: parseDate(first(o, ['paidAt', 'approvedAt', 'createdAt']), tz),
          productExternalId: productId,
          productName,
          gross: money(first(o, ['amount', 'baseAmount', 'offer.price']), cfg.amountsInCents) ?? 0,
          fees: money(get(o, 'fees'), cfg.amountsInCents),
          net,
          country: country(first(o, ['customer.country', 'customer.address.country'])),
          buyerEmail: str(get(o, 'customer.email')) || null,
          buyerName: str(get(o, 'customer.name')) || null,
          paymentMethod: str(first(o, ['paymentMethod', 'payment_method'])) || null,
        });
      })
      .filter((x): x is NormalizedTx => x !== null);
    if (!items.length) return { event, ignore: 'Evento sem pedido identificável', items: [] };
    return { event, items };
  },
};

// ---------------------------------------------------------------------------------- Lastlink
// { Id, IsTest, Event: "Purchase_Order_Confirmed", CreatedAt, Data: { Products[], Buyer, Purchase{PaymentId, Price{Value}, PaymentDate}, Commissions[] } }
const LASTLINK_STATUS: Record<string, TxStatus | 'ignore'> = {
  purchase_order_confirmed: 'approved',
  recurrent_payment: 'approved',
  payment_refund: 'refunded',
  payment_chargeback: 'chargeback',
  purchase_request_canceled: 'canceled',
  purchase_request_expired: 'canceled',
};

export const lastlink: Adapter = {
  key: 'lastlink',
  label: 'Lastlink',
  help: {
    secretLabel: 'Token do webhook',
    where: 'Lastlink → Integrações → Webhook → token de validação',
    events: ['Compra Completa (Purchase_Order_Confirmed)', 'Pagamento Recorrente', 'Reembolso (Payment_Refund)', 'Chargeback (Payment_Chargeback)'],
  },
  verify: ({ headers, body, secret }) =>
    checkSecret(secret, [
      headers['x-lastlink-token'],
      headers['x-webhook-token'],
      headers['x-token'],
      bearer(headers['authorization']),
      get(body, 'Token'),
    ]),
  parse(body, cfg) {
    const event = str(get(body, 'Event'));
    const mapped = LASTLINK_STATUS[event.toLowerCase()];
    if (!mapped || mapped === 'ignore') return { event, ignore: `Evento ${event || '(sem nome)'} não altera vendas`, items: [] };
    const d = get(body, 'Data');
    const id = str(first(d, ['Purchase.PaymentId', 'Purchase.Id'])) || str(get(body, 'Id'));
    if (!id) return { event, ignore: 'Evento sem identificador do pagamento', items: [] };
    const products = get(d, 'Products');
    const main = Array.isArray(products) ? products[0] : undefined;
    const tz = cfg.timezone;
    const test = get(body, 'IsTest') === true || lower(get(body, 'IsTest')) === 'true';
    return {
      event,
      test,
      items: [
        base({
          externalId: id,
          status: mapped,
          rawStatus: event,
          occurredAt: parseDate(get(body, 'CreatedAt'), tz),
          approvedAt: parseDate(first(d, ['Purchase.PaymentDate', 'Purchase.CreatedAt']), tz) ?? parseDate(get(body, 'CreatedAt'), tz),
          productExternalId: str(first(main, ['Id', 'Code'])),
          productName: str(first(main, ['Name', 'Title'])),
          gross: money(first(d, ['Purchase.Price.Value', 'Purchase.Price', 'Purchase.OriginalPrice.Value']), cfg.amountsInCents) ?? 0,
          currency: str(first(d, ['Purchase.Price.Currency', 'Purchase.Currency'])).toUpperCase() || 'BRL',
          country: country(first(d, ['Buyer.Address.Country', 'Buyer.Country'])),
          buyerEmail: str(get(d, 'Buyer.Email')) || null,
          buyerName: str(get(d, 'Buyer.Name')) || null,
          paymentMethod: str(first(d, ['Purchase.Payment.PaymentMethod', 'Purchase.PaymentMethod'])) || null,
        }),
      ],
    };
  },
};

// ---------------------------------------------------------------------------------- GGCheckout
// { event: "pix.paid" | "card.paid" | "pix.refunded" …, customer{…}, payment{id, amount, status, paymentMethod}, product{…}, products[] }
// Autenticação: cabeçalhos "x-secret" e "Authorization: Bearer <secret>".
function ggStatus(event: string, paymentStatus: string): TxStatus | 'ignore' {
  const e = event.toLowerCase();
  if (/\.(paid|approved)$/.test(e)) return 'approved';
  if (/\.refunded$/.test(e)) return 'refunded';
  if (/charge_?back/.test(e)) return 'chargeback';
  if (/\.(expired|failed|refused|canceled|cancelled)$/.test(e)) return 'canceled';
  if (/\.(generated|pending|created)$/.test(e)) return 'pending';
  const s = paymentStatus.toLowerCase();
  if (s === 'paid' || s === 'approved') return 'approved';
  if (s === 'refunded') return 'refunded';
  if (s.includes('charge')) return 'chargeback';
  return 'ignore';
}

export const ggcheckout: Adapter = {
  key: 'ggcheckout',
  label: 'GGCheckout',
  help: {
    secretLabel: 'Secret do webhook',
    where: 'GGCheckout → Integrações → Webhooks → campo "Secret"',
    events: ['PIX pago', 'Cartão aprovado', 'Reembolso', 'Chargeback'],
  },
  verify: ({ headers, secret }) => checkSecret(secret, [headers['x-secret'], bearer(headers['authorization'])]),
  parse(body, cfg) {
    const event = str(get(body, 'event'));
    const mapped = ggStatus(event, str(get(body, 'payment.status')));
    if (mapped === 'ignore' || mapped === 'pending') return { event, ignore: `Evento ${event || '(sem nome)'} não altera vendas`, items: [] };
    const id = str(first(body, ['payment.id', 'orderId', 'order_id', 'id']));
    if (!id) return { event, ignore: 'Evento sem identificador do pagamento', items: [] };
    const products = get(body, 'products');
    const main =
      get(body, 'product') ??
      (Array.isArray(products) ? products.find((p) => lower(get(p, 'type')) === 'main') ?? products[0] : undefined);
    const tz = cfg.timezone;
    return {
      event,
      items: [
        base({
          externalId: id,
          status: mapped,
          rawStatus: event,
          occurredAt: parseDate(first(body, ['createdAt', 'created_at']), tz),
          approvedAt: parseDate(first(body, ['payment.paidAt', 'payment.paid_at', 'createdAt', 'created_at']), tz),
          productExternalId: str(first(main, ['id', 'code'])),
          productName: str(first(main, ['title', 'name'])),
          gross: money(first(body, ['payment.amount', 'amount', 'total']), cfg.amountsInCents) ?? 0,
          fees: money(first(body, ['payment.fee', 'payment.fees']), cfg.amountsInCents),
          net: money(first(body, ['payment.netAmount', 'payment.net_amount']), cfg.amountsInCents),
          country: country(first(body, ['customer.country', 'customer.address.country'])),
          buyerEmail: str(get(body, 'customer.email')) || null,
          buyerName: str(get(body, 'customer.name')) || null,
          paymentMethod: str(first(body, ['payment.paymentMethod', 'payment.method'])) || event.split('.')[0] || null,
        }),
      ],
    };
  },
};

// ---------------------------------------------------------------------------------- PerfectPay
// { token, code, sale_amount, currency_enum, sale_status_enum, sale_status_detail, date_created, date_approved, product{code,name}, plan{…}, customer{…} }
// sale_status_enum: 2 aprovada · 10 completa · 7 devolvida · 9 chargeback · 5 recusada · 6 cancelada · demais = pendentes
const PERFECTPAY_STATUS: Record<number, TxStatus | 'ignore'> = {
  2: 'approved',
  10: 'approved',
  7: 'refunded',
  9: 'chargeback',
  5: 'canceled',
  6: 'canceled',
  13: 'canceled',
};
const PERFECTPAY_CURRENCY: Record<number, string> = { 1: 'BRL' };

export const perfectpay: Adapter = {
  key: 'perfectpay',
  label: 'PerfectPay',
  help: {
    secretLabel: 'Token do postback',
    where: 'PerfectPay → Ferramentas → Postback/Webhook → token exibido na configuração',
    events: ['Aprovado', 'Completo', 'Devolvido', 'Chargeback', 'Cancelado', 'Recusado'],
  },
  verify: ({ body, secret }) => checkSecret(secret, [get(body, 'token')]),
  parse(body, cfg) {
    const code = Number(get(body, 'sale_status_enum'));
    const detail = str(get(body, 'sale_status_detail'));
    const event = `${Number.isFinite(code) ? code : '?'}${detail ? ` (${detail})` : ''}`;
    const mapped = PERFECTPAY_STATUS[code];
    if (!mapped || mapped === 'ignore') return { event, ignore: `Status ${event} não altera vendas`, items: [] };
    const id = str(first(body, ['code', 'sale_code', 'transaction']));
    if (!id) return { event, ignore: 'Evento sem código da venda', items: [] };
    const cur = Number(get(body, 'currency_enum'));
    const tz = cfg.timezone;
    return {
      event,
      items: [
        base({
          externalId: id,
          status: mapped,
          rawStatus: event,
          occurredAt: parseDate(first(body, ['date_updated', 'date_created']), tz),
          approvedAt: parseDate(first(body, ['date_approved', 'date_created']), tz),
          productExternalId: str(first(body, ['product.code', 'product.external_reference', 'plan.code'])),
          productName: str(first(body, ['product.name', 'plan.name'])),
          gross: money(first(body, ['sale_amount', 'plan.price']), cfg.amountsInCents) ?? 0,
          currency: PERFECTPAY_CURRENCY[cur] ?? 'BRL',
          country: country(first(body, ['customer.country', 'customer.address_country', 'customer.country_code'])),
          buyerEmail: str(get(body, 'customer.email')) || null,
          buyerName: str(first(body, ['customer.full_name', 'customer.name'])) || null,
          paymentMethod: str(first(body, ['payment_type_enum', 'payment_format_enum'])) || null,
        }),
      ],
    };
  },
};

// ---------------------------------------------------------------------------------- Genérico
// Para qualquer plataforma nova: o usuário informa onde estão os campos no JSON.
const DEFAULT_STATUS_WORDS: Record<string, TxStatus | 'ignore'> = {
  approved: 'approved', aprovado: 'approved', aprovada: 'approved', paid: 'approved', pago: 'approved', paga: 'approved',
  complete: 'approved', completed: 'approved', succeeded: 'approved', confirmed: 'approved',
  refunded: 'refunded', reembolsado: 'refunded', reembolsada: 'refunded', refund: 'refunded', devolvido: 'refunded',
  chargeback: 'chargeback', charged_back: 'chargeback', disputed: 'chargeback',
  canceled: 'canceled', cancelled: 'canceled', cancelado: 'canceled', refused: 'canceled', recusado: 'canceled', failed: 'canceled',
  pending: 'pending', pendente: 'pending', waiting_payment: 'pending',
};

export const generic: Adapter = {
  key: 'generic',
  label: 'Outra plataforma',
  help: {
    secretLabel: 'Segredo (opcional)',
    where: 'Se a plataforma enviar um token/segredo em cabeçalho, cole aqui',
    events: ['Venda aprovada', 'Reembolso', 'Chargeback'],
  },
  verify: ({ headers, body, secret }) =>
    checkSecret(secret, [
      headers['x-secret'],
      headers['x-webhook-secret'],
      headers['x-token'],
      bearer(headers['authorization']),
      get(body, 'token'),
      get(body, 'secret'),
    ]),
  parse(body, cfg) {
    const m = cfg.mapping;
    if (!m || !m.externalId || !m.status || !m.gross) {
      return { event: '', ignore: 'Mapeamento de campos não configurado nesta integração', items: [] };
    }
    const event = str(m.event ? get(body, m.event) : get(body, m.status));
    const rawStatus = str(get(body, m.status));
    const custom = Object.fromEntries(Object.entries(m.statusMap ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const mapped = custom[rawStatus.toLowerCase()] ?? DEFAULT_STATUS_WORDS[rawStatus.toLowerCase()];
    if (!mapped || mapped === 'ignore' || mapped === 'pending') {
      return { event, ignore: `Status "${rawStatus}" não altera vendas`, items: [] };
    }
    const id = str(get(body, m.externalId));
    if (!id) return { event, ignore: 'Identificador da venda não encontrado no caminho configurado', items: [] };
    const tz = cfg.timezone;
    return {
      event,
      items: [
        base({
          externalId: id,
          status: mapped,
          rawStatus,
          approvedAt: m.date ? parseDate(get(body, m.date), tz) : null,
          productExternalId: m.productId ? str(get(body, m.productId)) : '',
          productName: m.productName ? str(get(body, m.productName)) : '',
          gross: money(get(body, m.gross), cfg.amountsInCents) ?? 0,
          fees: m.fees ? money(get(body, m.fees), cfg.amountsInCents) : null,
          net: m.net ? money(get(body, m.net), cfg.amountsInCents) : null,
          currency: (m.currency ? str(get(body, m.currency)) : '').toUpperCase() || 'BRL',
          country: m.country ? country(get(body, m.country)) : null,
          buyerEmail: m.email ? str(get(body, m.email)) || null : null,
          buyerName: m.name ? str(get(body, m.name)) || null : null,
        }),
      ],
    };
  },
};

export const ADAPTERS: Record<PlatformKey, Adapter> = { hotmart, cakto, lastlink, ggcheckout, perfectpay, generic };
