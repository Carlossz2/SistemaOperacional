import { describe, expect, it } from 'vitest';
import { candleGroup, candles } from './market';
import type { SeriesPoint } from './metrics';

const series = (profits: number[], start = '2026-01-05'): SeriesPoint[] => {
  let cum = 0;
  return profits.map((profit, i) => {
    cum += profit;
    const d = new Date(2026, 0, 5 + i);
    const key = i === 0 ? start : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { key, gross: 100, net: 90, ads: 0, expenses: 0, tax: 0, profit, cumulative: cum };
  });
};

describe('velas do lucro acumulado', () => {
  it('vela diária: abre no fechamento anterior, sobe com lucro e desce com prejuízo', () => {
    const c = candles(series([100, -30, 50]), 'day', 2);
    expect(c.map((x) => [x.open, x.close, x.up])).toEqual([
      [0, 100, true],
      [100, 70, false],
      [70, 120, true],
    ]);
    expect(c[1].range).toEqual([70, 100]);
    expect(c.map((x) => x.ma)).toEqual([null, 85, 95]);
  });
  it('vela semanal: pavio com o maior e o menor acumulado da semana, volume = bruto', () => {
    // seg 05/01 a dom 11/01 = 1 semana; seg 12/01 começa outra
    const c = candles(series([100, -300, 50, 0, 0, 0, 0, 20]), 'week');
    expect(c.length).toBe(2);
    expect(c[0]).toMatchObject({ key: '2026-01-05', from: '2026-01-05', to: '2026-01-11', open: 0, close: -150, high: 100, low: -200, volume: 700, profit: -150, up: false });
    expect(c[1]).toMatchObject({ key: '2026-01-12', open: -150, close: -130, up: true });
  });
  it('soma dos resultados das velas = lucro do período', () => {
    const s = series([10, 20, -5, 7, 9, -12, 30, 4, 4]);
    for (const g of ['day', 'week', 'month'] as const) {
      const c = candles(s, g);
      expect(c.reduce((a, x) => a + x.profit, 0)).toBe(67);
      expect(c.at(-1)!.close).toBe(67);
    }
  });
  it('tamanho da vela pelo período', () => {
    expect(candleGroup('2026-01-01', '2026-01-30')).toBe('day');
    expect(candleGroup('2026-01-01', '2026-06-30')).toBe('week');
    expect(candleGroup('2024-01-01', '2026-06-30')).toBe('month');
  });
});
