// Visão "mercado financeiro" do Dashboard: o lucro acumulado vira um gráfico de velas.
// Cada vela é um dia, semana ou mês: abre no lucro acumulado do início, fecha no do fim
// (sobe com lucro, desce com prejuízo); o pavio mostra o maior e o menor acumulado dentro dela.

import { addDays, daysBetween, monthOf, weekStart } from './dates';
import type { SeriesPoint } from './metrics';

export type CandleGroup = 'day' | 'week' | 'month';

export interface Candle {
  key: string; // dia, segunda-feira da semana ou mês (AAAA-MM)
  from: string;
  to: string;
  open: number;
  close: number;
  high: number;
  low: number;
  /** [low, high] para o gráfico de faixa */
  range: [number, number];
  /** Faturamento bruto do trecho ("volume") */
  volume: number;
  profit: number;
  up: boolean;
  /** Média móvel do fechamento (null enquanto não há velas suficientes) */
  ma: number | null;
}

/** Tamanho da vela pelo tamanho do período: até ~1,5 mês por dia, até 1 ano por semana, acima por mês. */
export function candleGroup(from: string, to: string): CandleGroup {
  const days = daysBetween(from, to).length;
  return days <= 45 ? 'day' : days <= 366 ? 'week' : 'month';
}

/** Agrupa a série DIÁRIA em velas. `daily` precisa estar em ordem e com um ponto por dia. */
export function candles(daily: SeriesPoint[], group: CandleGroup, maWindow = 7): Candle[] {
  const keyOf = (d: string) => (group === 'day' ? d : group === 'week' ? weekStart(d) : monthOf(d));
  const out: Candle[] = [];
  let prevClose = 0;
  for (const p of daily) {
    const key = keyOf(p.key);
    let c = out[out.length - 1];
    if (!c || c.key !== key) {
      c = { key, from: p.key, to: p.key, open: prevClose, close: prevClose, high: prevClose, low: prevClose, range: [prevClose, prevClose], volume: 0, profit: 0, up: true, ma: null };
      out.push(c);
    }
    c.to = p.key;
    c.close = p.cumulative;
    c.high = Math.max(c.high, p.cumulative);
    c.low = Math.min(c.low, p.cumulative);
    c.volume += p.gross;
    c.profit += p.profit;
    prevClose = p.cumulative;
  }
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    c.range = [c.low, c.high];
    c.up = c.close >= c.open;
    if (i + 1 >= maWindow) c.ma = out.slice(i + 1 - maWindow, i + 1).reduce((a, x) => a + x.close, 0) / maWindow;
  }
  return out;
}

/** Último dia de uma vela semanal (para rótulos). */
export const weekEnd = (monday: string) => addDays(monday, 6);
