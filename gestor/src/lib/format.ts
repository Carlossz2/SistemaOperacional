export function money(value: number, currency = 'BRL', compact = false): string {
  const v = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 2,
  }).format(v);
}

export function num(value: number, digits = 0): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(
    Number.isFinite(value) ? value : 0,
  );
}

export function pct(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${num(value * 100, digits)}%`;
}

export function ratio(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${num(value, digits)}x`;
}

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return d ? `${d}/${m}/${y.slice(2)}` : `${m}/${y}`;
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const name = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  return `${name}/${String(y).slice(2)}`;
}

/**
 * Lê um número digitado no padrão brasileiro ou internacional.
 * "1.234,56" → 1234.56 · "1234,56" → 1234.56 · "5,4" → 5.4 · "5.4" → 5.4 · "1.500" → 1500 · "R$ 10" → 10.
 * Retorna null se vazio e NaN se inválido.
 */
export function parseDecimal(input: unknown): number | null {
  if (typeof input === 'number') return input;
  const s = String(input ?? '')
    .replace(/[R$\s ]/g, '')
    .replace(/^[A-Z]{3}(?=[-\d])/, ''); // "USD100"
  if (!s) return null;
  let norm: string;
  if (s.includes(',')) norm = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) norm = s.replace(/\./g, ''); // pontos como milhar: 1.500 / 12.345.678
  else norm = s;
  return /^-?\d*\.?\d+$/.test(norm) ? Number(norm) : NaN;
}

/** Número → texto para campo de formulário, com vírgula decimal e sem separador de milhar. */
export function decimalInput(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return v === undefined || v === null ? '' : String(v);
  return String(v).replace('.', ',');
}
