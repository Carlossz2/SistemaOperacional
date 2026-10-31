import { describe, expect, it } from 'vitest';
import { cancelExpense, pauseExpense, reactivateExpense, statusOf } from './expenseStatus';
import { expandExpenses } from './metrics';
import type { Expense } from './types';

const saas: Expense = { id: 'e1', date: '2026-01-10', category: 'Ferramentas / SaaS', description: 'Utmify', currency: 'BRL', rate: 1, amount: 100, recurrence: 'monthly' };
const months = (e: Expense, from = '2026-01-01', to = '2026-12-31') => expandExpenses([e], from, to).map((o) => o.date.slice(0, 7));

describe('status das despesas', () => {
  it('ativa: cobra todo mês', () => {
    expect(months(saas, '2026-01-01', '2026-04-30')).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    expect(statusOf(saas, '2026-10')).toBe('active');
  });
  it('pausada: para de cobrar a partir do mês; reativada volta e guarda a pausa', () => {
    const paused = pauseExpense(saas, '2026-03');
    expect(months(paused, '2026-01-01', '2026-06-30')).toEqual(['2026-01', '2026-02']);
    expect(statusOf(paused, '2026-10')).toBe('paused');
    const back = reactivateExpense(paused, '2026-05');
    expect(back.pauses).toEqual([{ from: '2026-03', to: '2026-04' }]);
    expect(back.pausedFrom).toBeUndefined();
    expect(months(back, '2026-01-01', '2026-06-30')).toEqual(['2026-01', '2026-02', '2026-05', '2026-06']);
  });
  it('cancelada: cobra até o último mês; reativar depois guarda o intervalo parado', () => {
    const canceled = cancelExpense(saas, '2026-02');
    expect(canceled.endMonth).toBe('2026-02');
    expect(months(canceled)).toEqual(['2026-01', '2026-02']);
    expect(statusOf(canceled, '2026-10')).toBe('canceled');
    const back = reactivateExpense(canceled, '2026-06');
    expect(back.endMonth).toBeUndefined();
    expect(months(back, '2026-01-01', '2026-07-31')).toEqual(['2026-01', '2026-02', '2026-06', '2026-07']);
  });
  it('pausada e depois cancelada: não volta a cobrar os meses da pausa', () => {
    const c = cancelExpense(pauseExpense(saas, '2026-03'), '2026-08');
    expect(c.endMonth).toBe('2026-02');
    expect(months(c)).toEqual(['2026-01', '2026-02']);
  });
  it('despesa única cancelada não conta', () => {
    const once: Expense = { ...saas, recurrence: 'none' };
    expect(months(once)).toEqual(['2026-01']);
    expect(months(cancelExpense(once, '2026-01'))).toEqual([]);
    expect(months(reactivateExpense(cancelExpense(once, '2026-01'), '2026-10'))).toEqual(['2026-01']);
  });
  it('recorrente com último mês no passado (dado antigo) conta como cancelada', () => {
    expect(statusOf({ ...saas, endMonth: '2026-05' }, '2026-10')).toBe('canceled');
    expect(statusOf({ ...saas, endMonth: '2026-12' }, '2026-10')).toBe('active');
  });
});
