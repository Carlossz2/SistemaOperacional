// Caixa = dinheiro de verdade, separado de faturamento e lucro.
// Com o Mercado Pago conectado: saldo da conta, controlado a partir de uma data (nada anterior conta).
// Sem banco: só os lançamentos de Caixa & capital (aportes − retiradas − investimentos).

export interface CashMove {
  date: string;
  occurred_at: string | null;
  direction: 'in' | 'out';
  amount: number;
  balance: number | null;
}

export interface BankCashConfig {
  /** Início do controle do caixa (AAAA-MM-DD) */
  startDate: string;
  /** Saldo da conta no início do controle */
  opening?: { date: string; balance: number; source: 'mercadopago' | 'manual' } | null;
}

const order = (a: CashMove, b: CashMove) => (a.occurred_at ?? a.date).localeCompare(b.occurred_at ?? b.date);
const net = (m: CashMove) => (m.direction === 'in' ? m.amount : -m.amount);

/** Saldo inicial válido (o informado para outra data de início não vale). */
export const openingOf = (cfg: BankCashConfig) => (cfg.opening && cfg.opening.date === cfg.startDate ? cfg.opening.balance : null);

/**
 * Saldo da conta no fim do dia `day`: o saldo informado pelo banco na última movimentação até lá
 * (mais o que veio depois dela sem saldo), ou, sem saldo do banco, saldo inicial + entradas − saídas.
 * null = ainda não dá para saber (antes do início, ou sem saldo inicial nem saldo do banco).
 */
export function bankCashAt(moves: CashMove[], cfg: BankCashConfig, day: string): number | null {
  if (day < cfg.startDate) return null;
  const until = moves.filter((m) => m.date >= cfg.startDate && m.date <= day).sort(order);
  let base: number | null = openingOf(cfg);
  let from = 0;
  for (let i = until.length - 1; i >= 0; i--) {
    if (until[i].balance !== null) {
      base = until[i].balance;
      from = i + 1;
      break;
    }
  }
  if (base === null) return null;
  return Math.round((base + until.slice(from).reduce((a, m) => a + net(m), 0)) * 100) / 100;
}

/** Entradas e saídas da conta no período (só a partir do início do controle). */
export function bankFlows(moves: CashMove[], cfg: BankCashConfig, from: string, to: string) {
  const start = from < cfg.startDate ? cfg.startDate : from;
  const inPeriod = moves.filter((m) => m.date >= start && m.date <= to);
  return {
    inflow: inPeriod.filter((m) => m.direction === 'in').reduce((a, m) => a + m.amount, 0),
    outflow: inPeriod.filter((m) => m.direction === 'out').reduce((a, m) => a + m.amount, 0),
  };
}

/** Momento da última movimentação até o dia (para "atualizado em"). */
export function lastMoveAt(moves: CashMove[], cfg: BankCashConfig, day: string): string | null {
  const until = moves.filter((m) => m.date >= cfg.startDate && m.date <= day).sort(order);
  const last = until[until.length - 1];
  return last ? (last.occurred_at ?? last.date) : null;
}
