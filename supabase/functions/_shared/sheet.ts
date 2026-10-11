// Importação de vendas por planilha (relatórios exportados da Hotmart, Cakto e outras).
// Funções puras, usadas no app (ler o arquivo, reconhecer colunas, prévia) e no servidor (validar).
import type { NormalizedTx, TxStatus } from './adapters.ts';
import { country as countryCode, money, parseDate, str } from './util.ts';

export type FieldKey =
  | 'externalId'
  | 'date'
  | 'status'
  | 'productName'
  | 'productId'
  | 'gross'
  | 'net'
  | 'fees'
  | 'currency'
  | 'country'
  | 'buyerEmail'
  | 'buyerName'
  | 'paymentMethod'
  | 'quantity';

export interface ImportField {
  key: FieldKey;
  label: string;
  required?: boolean;
  /** Nomes de coluna conhecidos (sem acento, minúsculos), do mais específico ao mais genérico */
  aliases: string[];
}

// A ordem importa: campos mais específicos primeiro (ex.: "valor líquido" antes de "valor").
export const IMPORT_FIELDS: ImportField[] = [
  {
    key: 'externalId',
    label: 'Código da venda / transação',
    required: true,
    aliases: ['transacao', 'codigo da transacao', 'cod transacao', 'id da transacao', 'id da venda', 'codigo da venda', 'id do pedido', 'numero do pedido', 'codigo do pedido', 'pedido', 'order id', 'transaction', 'transaction id', 'id', 'codigo', 'ref', 'referencia'],
  },
  {
    key: 'date',
    label: 'Data da venda / aprovação',
    required: true,
    aliases: ['data de aprovacao', 'data da aprovacao', 'data aprovacao', 'data de pagamento', 'data do pagamento', 'data da venda', 'data da compra', 'data do pedido', 'data de confirmacao', 'paid at', 'approved at', 'data de criacao', 'created at', 'data', 'date'],
  },
  { key: 'status', label: 'Status', aliases: ['status da transacao', 'status da venda', 'status do pagamento', 'status do pedido', 'situacao', 'status'] },
  { key: 'productId', label: 'Código do produto', aliases: ['codigo do produto', 'id do produto', 'cod produto', 'product id', 'id produto', 'id da oferta', 'codigo da oferta'] },
  { key: 'productName', label: 'Produto', aliases: ['nome do produto', 'produto', 'product', 'product name', 'oferta', 'nome da oferta', 'offer'] },
  {
    key: 'net',
    label: 'Valor líquido (você recebe)',
    aliases: ['valor liquido', 'comissao do produtor', 'minha comissao', 'voce recebe', 'valor recebido', 'valor a receber', 'faturamento liquido', 'liquido', 'net', 'net amount', 'comissao'],
  },
  { key: 'fees', label: 'Taxas', aliases: ['taxa da plataforma', 'taxas da plataforma', 'tarifa', 'taxas', 'taxa', 'fees', 'fee'] },
  {
    key: 'gross',
    label: 'Valor bruto (pago pelo cliente)',
    required: true,
    aliases: ['valor de compra com impostos', 'valor da compra', 'valor total', 'valor da venda', 'preco total', 'valor bruto', 'faturamento bruto', 'preco do produto', 'preco', 'total', 'valor', 'amount', 'price', 'gross'],
  },
  { key: 'currency', label: 'Moeda', aliases: ['moeda da compra', 'moeda', 'currency'] },
  { key: 'country', label: 'País', aliases: ['pais do comprador', 'pais', 'country'] },
  { key: 'buyerEmail', label: 'E-mail do cliente', aliases: ['email do comprador', 'e mail do comprador', 'email do cliente', 'e mail do cliente', 'email', 'e mail'] },
  { key: 'buyerName', label: 'Nome do cliente', aliases: ['nome do comprador', 'nome do cliente', 'comprador', 'cliente', 'nome', 'customer'] },
  { key: 'paymentMethod', label: 'Forma de pagamento', aliases: ['forma de pagamento', 'metodo de pagamento', 'meio de pagamento', 'tipo de pagamento', 'pagamento', 'payment method'] },
  { key: 'quantity', label: 'Quantidade', aliases: ['quantidade', 'qtd', 'quantity'] },
];

export type Mapping = Partial<Record<FieldKey, number>>;

/** "Data de Aprovação" → "data de aprovacao" */
export const normHeader = (s: unknown) =>
  str(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Reconhece as colunas pelos nomes. Cada coluna é usada uma vez; nome exato vence "contém". */
export function guessMapping(headers: unknown[]): Mapping {
  const norm = headers.map(normHeader);
  const used = new Set<number>();
  const out: Mapping = {};
  for (const pass of ['exact', 'contains'] as const) {
    for (const f of IMPORT_FIELDS) {
      if (out[f.key] !== undefined) continue;
      for (const alias of f.aliases) {
        const i = norm.findIndex((h, idx) => !used.has(idx) && h !== '' && (pass === 'exact' ? h === alias : alias.length > 3 && h.includes(alias)));
        if (i >= 0) {
          out[f.key] = i;
          used.add(i);
          break;
        }
      }
    }
  }
  return out;
}

/** CSV/TSV → cabeçalho + linhas (separador detectado: ; , ou tab; aspas e quebras dentro de aspas). */
export function parseCsvTable(text: string): { headers: string[]; rows: string[][] } {
  const clean = text.replace(/^﻿/, '');
  // separador: o que mais aparece numa mesma linha entre as 10 primeiras (relatórios às vezes começam com uma linha de título)
  const sample = clean.split(/\r?\n/, 10);
  const counts = [';', ',', '\t']
    .map((c) => [c, Math.max(0, ...sample.map((l) => l.split(c).length - 1))] as const)
    .sort((a, b) => b[1] - a[1]);
  const sep = counts[0][1] > 0 ? counts[0][0] : ',';
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
  const nonEmpty = rows.filter((r) => r.some((x) => x.trim() !== ''));
  const [headers = [], ...body] = nonEmpty;
  return { headers: headers.map((h) => h.trim()), rows: body.map((r) => r.map((x) => x.trim())) };
}

/** Status da planilha → status do sistema (null = desconhecido). */
export function statusFromText(v: unknown): TxStatus | null {
  const s = normHeader(v);
  if (!s) return null;
  if (/chargeback|contestad|disput|charged back/.test(s)) return 'chargeback';
  if (/reembols|devolvid|estorn|refund/.test(s)) return 'refunded';
  if (/cancel|recusad|expirad|negad|falh|refused|failed|abandon|bloquead/.test(s)) return 'canceled';
  if (/pend|aguard|process|atrasad|waiting|analise|boleto impresso|gerad|em aberto|iniciad|open/.test(s)) return 'pending';
  if (/aprovad|complet|conclu|finaliz|pago|paga\b|paid|approved|confirm|succeed|sucesso|liberad/.test(s)) return 'approved';
  return null;
}

/** Data de planilha: Date (Excel), número serial do Excel, "05/10/2026 14:03", "2026-10-05"… → ISO. */
export function parseSheetDate(v: unknown, tz: string): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // serial do Excel (dias desde 1899-12-30), no fuso local da operação
    const ms = Math.round((v - 25569) * 86_400_000);
    const d = new Date(ms);
    const local = d.toISOString().slice(0, 19).replace('T', ' ');
    return parseDate(local, tz);
  }
  let s = str(v).trim();
  if (!s) return null;
  // 5/10/2026 → 05/10/2026 ; "05/10/2026 às 14:03" → "05/10/2026 14:03"
  s = s.replace(/\s+(as|às)\s+/i, ' ').replace(/^(\d)\//, '0$1/').replace(/\/(\d)\//, '/0$1/');
  s = s.replace(/^(\d{2}\/\d{2}\/\d{4})[ T](\d):/, '$1 0$2:');
  s = s.replace(/^(\d{2})-(\d{2})-(\d{4})/, '$1/$2/$3');
  return parseDate(s, tz);
}

export interface SheetOptions {
  timezone: string;
  /** Moeda quando não há coluna de moeda */
  currency: string;
  /** Sem coluna de status: tratar todas as linhas como aprovadas */
  assumeApproved: boolean;
}

export interface SheetResult {
  items: NormalizedTx[];
  skipped: { line: number; reason: string }[];
}

/** Linhas da planilha → vendas no formato dos webhooks (mesmo código = mesma venda, sem duplicar). */
export function rowsToTxs(rows: unknown[][], mapping: Mapping, opts: SheetOptions): SheetResult {
  const items: NormalizedTx[] = [];
  const skipped: SheetResult['skipped'] = [];
  const seen = new Map<string, number>();
  const cell = (r: unknown[], k: FieldKey) => (mapping[k] === undefined ? undefined : r[mapping[k]!]);
  rows.forEach((r, idx) => {
    const line = idx + 2; // +1 cabeçalho, +1 base 1
    if (!r.some((x) => str(x).trim() !== '')) return;
    const id = str(cell(r, 'externalId')).trim();
    if (!id) return skipped.push({ line, reason: 'sem código da venda' });
    const when = parseSheetDate(cell(r, 'date'), opts.timezone);
    if (!when) return skipped.push({ line, reason: `data não reconhecida: "${str(cell(r, 'date'))}"` });
    // pendentes/canceladas entram, mas não somam (mesma regra dos webhooks)
    const status: TxStatus | null = mapping.status === undefined ? (opts.assumeApproved ? 'approved' : null) : statusFromText(cell(r, 'status'));
    if (!status) return skipped.push({ line, reason: `status não reconhecido: "${str(cell(r, 'status'))}"` });
    const netRaw = money(cell(r, 'net'));
    let gross = money(cell(r, 'gross'));
    if (gross === null && netRaw !== null) gross = netRaw;
    if (gross === null) return skipped.push({ line, reason: 'sem valor da venda' });
    const feesRaw = money(cell(r, 'fees'));
    // mesma venda repetida na planilha (ex.: uma linha por parcela): fica a primeira
    const key = `${id}|${str(cell(r, 'productId')) || str(cell(r, 'productName'))}`;
    if (seen.has(key)) return skipped.push({ line, reason: `venda repetida (igual à linha ${seen.get(key)})` });
    seen.set(key, line);
    const qty = Number(str(cell(r, 'quantity')).replace(',', '.'));
    items.push({
      externalId: id.slice(0, 200),
      status,
      rawStatus: str(cell(r, 'status')).slice(0, 100) || 'planilha',
      occurredAt: when,
      approvedAt: status === 'approved' ? when : null,
      productExternalId: str(cell(r, 'productId')).trim().slice(0, 200),
      productName: str(cell(r, 'productName')).trim().slice(0, 300),
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
      currency: (str(cell(r, 'currency')).trim().toUpperCase().match(/^[A-Z]{3}$/)?.[0] ?? opts.currency).toUpperCase(),
      gross: Math.abs(gross),
      fees: feesRaw === null ? null : Math.abs(feesRaw),
      net: netRaw === null ? null : Math.abs(netRaw),
      country: countryCode(cell(r, 'country')),
      buyerEmail: str(cell(r, 'buyerEmail')).trim().slice(0, 300) || null,
      buyerName: str(cell(r, 'buyerName')).trim().slice(0, 300) || null,
      paymentMethod: str(cell(r, 'paymentMethod')).trim().slice(0, 100) || null,
    });
  });
  return { items, skipped };
}

const STATUSES: TxStatus[] = ['approved', 'refunded', 'chargeback', 'pending', 'canceled'];

/** Validação no servidor do que o app enviou (nunca confiar no navegador). */
export function sanitizeItem(v: unknown): NormalizedTx | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const s = (k: string, max: number) => (typeof o[k] === 'string' ? (o[k] as string).trim().slice(0, max) : '');
  const n = (k: string) => (typeof o[k] === 'number' && Number.isFinite(o[k]) && (o[k] as number) >= 0 && (o[k] as number) < 1e9 ? (o[k] as number) : null);
  const iso = (k: string) => {
    const t = s(k, 40);
    return t && !Number.isNaN(Date.parse(t)) ? new Date(t).toISOString() : null;
  };
  const externalId = s('externalId', 200);
  const status = o.status as TxStatus;
  const gross = n('gross');
  const occurredAt = iso('occurredAt');
  if (!externalId || !STATUSES.includes(status) || gross === null || !occurredAt) return null;
  const currency = s('currency', 3).toUpperCase();
  return {
    externalId,
    status,
    rawStatus: s('rawStatus', 100) || 'planilha',
    occurredAt,
    approvedAt: iso('approvedAt'),
    // sem código do produto: usa o nome (senão produtos diferentes cairiam no mesmo "sem-id")
    productExternalId: s('productExternalId', 200) || (s('productName', 300) ? `nome:${normHeader(s('productName', 300))}`.slice(0, 200) : ''),
    productName: s('productName', 300),
    quantity: Math.min(n('quantity') ?? 1, 10_000) || 1,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : 'BRL',
    gross,
    fees: n('fees'),
    net: n('net'),
    country: /^[A-Z]{2}$/.test(s('country', 2)) ? s('country', 2) : null,
    buyerEmail: s('buyerEmail', 300) || null,
    buyerName: s('buyerName', 300) || null,
    paymentMethod: s('paymentMethod', 100) || null,
  };
}
