// "Lançar vários de uma vez": linhas coladas (de uma planilha ou de uma mensagem) → receitas.
// Formato por linha (separado por ; ou tab; cabeçalho opcional):
//   Data ; Produto ; Vendas ; Faturamento bruto ; Moeda ; Cotação ; País ; Plataforma ; Observações
import { parseDecimal } from './format';

export interface BulkSale {
  line: number;
  date: string;
  productName: string;
  quantity: number;
  gross: number;
  currency: string;
  rate: number;
  country: string;
  platform: string;
  notes: string;
}

export interface BulkOptions {
  baseCurrency: string;
  rates: Record<string, number>;
  defaultPlatform: string;
}

function parseDay(v: string): string | null {
  const s = v.trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return valid(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? valid(s) : null;
}
function valid(iso: string): string | null {
  const [y, mo, d] = iso.split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? iso : null;
}

export function parseBulkSales(text: string, opts: BulkOptions): { rows: BulkSale[]; errors: { line: number; message: string }[] } {
  const rows: BulkSale[] = [];
  const errors: { line: number; message: string }[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim()) return;
    const cells = (raw.includes('\t') ? raw.split('\t') : raw.split(';')).map((c) => c.trim());
    const date = parseDay(cells[0] ?? '');
    if (!date) {
      // cabeçalho (1ª linha sem data) é ignorado; nas demais é erro
      if (rows.length === 0 && errors.length === 0 && !/\d/.test(cells[0] ?? '')) return;
      return errors.push({ line, message: `data inválida "${cells[0] ?? ''}" (use 31/03/2026)` });
    }
    const productName = cells[1] ?? '';
    if (!productName) return errors.push({ line, message: 'falta o produto' });
    const quantity = parseDecimal(cells[2] ?? '');
    if (quantity === null || Number.isNaN(quantity) || quantity < 0) return errors.push({ line, message: `nº de vendas inválido "${cells[2] ?? ''}"` });
    const gross = parseDecimal(cells[3] ?? '');
    if (gross === null || Number.isNaN(gross) || gross < 0) return errors.push({ line, message: `faturamento inválido "${cells[3] ?? ''}"` });
    const currency = (cells[4] || opts.baseCurrency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return errors.push({ line, message: `moeda inválida "${cells[4]}"` });
    let rate = currency === opts.baseCurrency ? 1 : parseDecimal(cells[5] ?? '') ?? opts.rates[currency] ?? NaN;
    if (!(rate > 0)) return errors.push({ line, message: `informe a cotação de ${currency} (coluna 6)` });
    if (currency === opts.baseCurrency) rate = 1;
    rows.push({
      line,
      date,
      productName,
      quantity,
      gross,
      currency,
      rate,
      country: (cells[6] || 'BR').toUpperCase().slice(0, 2),
      platform: cells[7] || opts.defaultPlatform,
      notes: cells[8] ?? '',
    });
  });
  return { rows, errors };
}
