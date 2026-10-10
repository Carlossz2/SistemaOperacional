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
