// Situação das despesas: ativa, pausada ou cancelada.
// Tudo por mês (AAAA-MM), como a recorrência: pausar/cancelar para de cobrar a partir de um mês e
// reativar volta a cobrar, guardando a pausa no histórico para os meses passados continuarem certos.
import { addMonths, monthOf } from './dates';
import type { Expense, ExpenseStatus } from './types';

export const EXPENSE_STATUS: Record<ExpenseStatus, { label: string; tone: 'ok' | 'warn' | 'info' }> = {
  active: { label: 'Ativa', tone: 'ok' },
  paused: { label: 'Pausada', tone: 'warn' },
  canceled: { label: 'Cancelada', tone: 'info' },
};

/** Situação no mês de referência (uma recorrente cujo último mês já passou conta como cancelada). */
export function statusOf(e: Expense, refMonth: string): ExpenseStatus {
  if (e.status === 'paused' || e.status === 'canceled') return e.status;
  if (e.recurrence === 'monthly' && e.endMonth && e.endMonth < refMonth) return 'canceled';
  return 'active';
}

/** O mês é cobrado? (só recorrentes; pausas encerradas, pausa atual e último mês) */
export function chargedIn(e: Expense, month: string): boolean {
  if (month < monthOf(e.date)) return false;
  if (e.endMonth && month > e.endMonth) return false;
  if (e.status === 'paused' && e.pausedFrom && month >= e.pausedFrom) return false;
  return !(e.pauses ?? []).some((p) => month >= p.from && month <= p.to);
}

/** Pausa a partir do mês (primeiro mês sem cobrança). */
export function pauseExpense(e: Expense, fromMonth: string): Expense {
  return { ...e, status: 'paused', pausedFrom: fromMonth };
}

/** Cancela: recorrente deixa de ser cobrada depois de `lastMonth`; única deixa de contar. */
export function cancelExpense(e: Expense, lastMonth: string): Expense {
  const { pausedFrom, ...rest } = e;
  if (e.recurrence !== 'monthly') return { ...rest, status: 'canceled' };
  // pausada e depois cancelada: o último mês cobrado é o anterior à pausa
  const last = e.status === 'paused' && pausedFrom && addMonths(pausedFrom, -1) < lastMonth ? addMonths(pausedFrom, -1) : lastMonth;
  return { ...rest, status: 'canceled', endMonth: last };
}

/** Reativa: volta a cobrar a partir do mês; o intervalo parado vira uma pausa no histórico. */
export function reactivateExpense(e: Expense, fromMonth: string): Expense {
  const { pausedFrom, endMonth, ...rest } = e;
  const out: Expense = { ...rest, status: 'active' };
  if (e.recurrence !== 'monthly') return out;
  const stoppedFrom = e.status === 'paused' ? pausedFrom : endMonth ? addMonths(endMonth, 1) : undefined;
  const to = addMonths(fromMonth, -1);
  if (stoppedFrom && stoppedFrom <= to) out.pauses = [...(e.pauses ?? []), { from: stoppedFrom, to }];
  return out;
}
