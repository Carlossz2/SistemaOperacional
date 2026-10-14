import { describe, expect, it } from 'vitest';
import { bankCashAt, bankFlows, lastMoveAt, type CashMove } from './cash';

const mv = (date: string, direction: 'in' | 'out', amount: number, balance: number | null, time = '12:00'): CashMove => ({
  date,
  occurred_at: `${date}T${time}:00-03:00`,
  direction,
  amount,
  balance,
});

const moves = [
  mv('2026-10-10', 'in', 999, 5000), // antes do início: não conta
  mv('2026-10-14', 'in', 200, 1200, '10:00'),
  mv('2026-10-14', 'out', 50, 1150, '15:00'),
  mv('2026-10-16', 'out', 100, 1050),
];

describe('caixa pela conta do banco', () => {
  const cfg = { startDate: '2026-10-14', opening: { date: '2026-10-14', balance: 1000, source: 'mercadopago' as const } };
  it('usa o saldo do banco da última movimentação até o dia', () => {
    expect(bankCashAt(moves, cfg, '2026-10-14')).toBe(1150);
    expect(bankCashAt(moves, cfg, '2026-10-15')).toBe(1150);
    expect(bankCashAt(moves, cfg, '2026-10-20')).toBe(1050);
  });
  it('antes do início do controle não existe caixa', () => {
    expect(bankCashAt(moves, cfg, '2026-10-13')).toBeNull();
  });
  it('no dia do início, sem movimentação, vale o saldo inicial', () => {
    expect(bankCashAt([], cfg, '2026-10-14')).toBe(1000);
  });
  it('sem saldo do banco: saldo inicial + entradas − saídas', () => {
    const noBalance = moves.map((m) => ({ ...m, balance: null }));
    expect(bankCashAt(noBalance, cfg, '2026-10-16')).toBe(1000 + 200 - 50 - 100);
    // e sem saldo inicial não dá para saber
    expect(bankCashAt(noBalance, { startDate: '2026-10-14' }, '2026-10-16')).toBeNull();
  });
  it('saldo inicial de outra data de início não vale', () => {
    expect(bankCashAt([], { startDate: '2026-10-20', opening: cfg.opening }, '2026-10-21')).toBeNull();
  });
  it('movimentação sem saldo depois da última com saldo é somada', () => {
    expect(bankCashAt([...moves, mv('2026-10-17', 'in', 30, null)], cfg, '2026-10-17')).toBe(1080);
  });
  it('entradas e saídas só a partir do início', () => {
    expect(bankFlows(moves, cfg, '2026-10-01', '2026-10-31')).toEqual({ inflow: 200, outflow: 150 });
    expect(bankFlows(moves, cfg, '2026-10-15', '2026-10-31')).toEqual({ inflow: 0, outflow: 100 });
    expect(lastMoveAt(moves, cfg, '2026-10-15')).toBe('2026-10-14T15:00:00-03:00');
  });
});
