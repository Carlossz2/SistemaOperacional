// Utilitários puros (sem APIs do Deno) — usados pelas Edge Functions e pelo app.

/**
 * Lê um caminho "a.b.0.c" ignorando maiúsculas/minúsculas e "_"/"-" nas chaves,
 * para tolerar variações de formato entre versões das plataformas.
 */
export function get(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(part);
      cur = Number.isInteger(i) ? cur[i] : undefined;
      continue;
    }
    if (typeof cur !== 'object') return undefined;
    const rec = cur as Record<string, unknown>;
    if (part in rec) {
      cur = rec[part];
      continue;
    }
    const norm = (s: string) => s.toLowerCase().replace(/[_-]/g, '');
    const target = norm(part);
    const key = Object.keys(rec).find((k) => norm(k) === target);
    cur = key === undefined ? undefined : rec[key];
  }
  return cur;
}

/** Primeiro caminho com valor não vazio. */
export function first(obj: unknown, paths: string[]): unknown {
  for (const p of paths) {
    const v = get(obj, p);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

export function str(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return '';
  return String(v).trim();
}

/** Converte valores monetários: 197, "197.00", "1.234,56", "R$ 97,00", {value: 97}. */
export function money(v: unknown, inCents = false): number | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const inner = first(v, ['value', 'amount', 'total']);
    return inner === undefined ? null : money(inner, inCents);
  }
  let n: number;
  if (typeof v === 'number') n = v;
  else {
    const s = str(v).replace(/[^\d.,-]/g, '');
    if (!s) return null;
    let norm = s;
    if (s.includes(',') && s.includes('.')) {
      norm = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (s.includes(',')) norm = s.replace(',', '.');
    n = Number(norm);
  }
  if (!Number.isFinite(n)) return null;
  return round2(inCents ? n / 100 : n);
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

const COUNTRY_NAMES: Record<string, string> = {
  brasil: 'BR', brazil: 'BR', mexico: 'MX', méxico: 'MX', colombia: 'CO', colômbia: 'CO', argentina: 'AR', chile: 'CL',
  peru: 'PE', perú: 'PE', equador: 'EC', ecuador: 'EC', portugal: 'PT', espanha: 'ES', españa: 'ES', spain: 'ES',
  'estados unidos': 'US', 'united states': 'US', usa: 'US', canada: 'CA', canadá: 'CA', bolivia: 'BO', bolívia: 'BO',
  paraguai: 'PY', paraguay: 'PY', uruguai: 'UY', uruguay: 'UY', guatemala: 'GT', 'república dominicana': 'DO',
  'costa rica': 'CR', panamá: 'PA', panama: 'PA', venezuela: 'VE', honduras: 'HN', 'el salvador': 'SV', nicaragua: 'NI',
};

export function country(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  if (/^[A-Za-z]{3}$/.test(s) && s.toUpperCase() === 'BRA') return 'BR';
  return COUNTRY_NAMES[s.toLowerCase()] ?? null;
}

/** Diferença (ms) entre o horário local do fuso e UTC num instante. */
function tzOffsetMs(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * Converte datas de webhook em ISO (UTC):
 * epoch em s/ms, ISO com fuso, ou "AAAA-MM-DD HH:MM:SS" sem fuso (interpretado no fuso informado).
 */
export function parseDate(v: unknown, tz = 'America/Sao_Paulo'): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number' || /^\d{10,13}$/.test(str(v))) {
    const n = Number(v);
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const s = str(v);
  const local = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (local) {
    const [, y, m, d, h = '0', mi = '0', se = '0'] = local;
    const guess = Date.UTC(+y, +m - 1, +d, +h, +mi, +se);
    const offset = tzOffsetMs(tz, new Date(guess));
    return new Date(guess - offset).toISOString();
  }
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (br) return parseDate(`${br[3]}-${br[2]}-${br[1]} ${br[4] ?? '00'}:${br[5] ?? '00'}:${br[6] ?? '00'}`, tz);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Data (AAAA-MM-DD) de um instante no fuso informado. */
export function dayIn(iso: string, tz = 'America/Sao_Paulo'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** Comparação de segredos em tempo constante. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function bearer(v: string | undefined): string {
  return (v ?? '').replace(/^Bearer\s+/i, '').trim();
}

export function fmtBRL(v: number, currency = 'BRL'): string {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(v);
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}
