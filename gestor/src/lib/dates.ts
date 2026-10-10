// Datas sempre como string AAAA-MM-DD no fuso local, para evitar o clássico bug de UTC "voltar um dia".

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function today(): string {
  return toISO(new Date());
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return toISO(new Date(y, m - 1, d + days));
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = monthOf(from); m <= monthOf(to); m = addMonths(m, 1)) out.push(m);
  return out;
}

export interface Period {
  preset: PresetKey;
  from: string;
  to: string;
}

export type PresetKey = 'today' | 'yesterday' | '7d' | '30d' | 'mtd' | 'lastMonth' | '90d' | 'ytd' | 'all' | 'custom';

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: 'yesterday', label: 'Ontem' },
  { key: '7d', label: 'Últimos 7 dias' },
  { key: '30d', label: 'Últimos 30 dias' },
  { key: 'mtd', label: 'Este mês' },
  { key: 'lastMonth', label: 'Mês passado' },
  { key: '90d', label: 'Últimos 90 dias' },
  { key: 'ytd', label: 'Este ano' },
  { key: 'all', label: 'Todo o período' },
  { key: 'custom', label: 'Personalizado' },
];

export function resolvePreset(key: PresetKey, ref = today(), earliest = ref): Period {
  const month = monthOf(ref);
  switch (key) {
    case 'today':
      return { preset: key, from: ref, to: ref };
    case 'yesterday': {
      const y = addDays(ref, -1);
      return { preset: key, from: y, to: y };
    }
    case '7d':
      return { preset: key, from: addDays(ref, -6), to: ref };
    case '30d':
      return { preset: key, from: addDays(ref, -29), to: ref };
    case '90d':
      return { preset: key, from: addDays(ref, -89), to: ref };
    case 'mtd':
      return { preset: key, from: `${month}-01`, to: ref };
    case 'lastMonth': {
      const lm = addMonths(month, -1);
      return { preset: key, from: `${lm}-01`, to: addDays(`${month}-01`, -1) };
    }
    case 'ytd':
      return { preset: key, from: `${ref.slice(0, 4)}-01-01`, to: ref };
    case 'all':
    case 'custom':
      return { preset: key, from: earliest < ref ? earliest : ref, to: ref };
  }
}

/** Período imediatamente anterior com a mesma duração (para comparar variação). */
export function previousPeriod(p: Period): Period {
  const len = daysBetween(p.from, p.to).length;
  return { preset: 'custom', from: addDays(p.from, -len), to: addDays(p.from, -1) };
}
