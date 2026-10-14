import { useEffect, useMemo, useState } from 'react';
import { bankCashAt, bankFlows, lastMoveAt, type BankCashConfig, type CashMove } from '../cash';
import { capitalSummary } from '../metrics';
import { isCloudActive, useDb } from '../store';
import { supabase } from './sync';

export interface CashView {
  /** De onde vem o caixa: conta Mercado Pago ou lançamentos manuais de Caixa & capital */
  source: 'mercadopago' | 'manual';
  /** Saldo no fim do período (null = ainda não dá para saber) */
  value: number | null;
  /** Saldo no fim do período anterior (para comparar) */
  prev: number | null;
  /** Entradas e saídas de dinheiro no período */
  inflow: number;
  outflow: number;
  /** Início do controle do caixa (só Mercado Pago) */
  startDate: string | null;
  /** Última movimentação considerada */
  asOf: string | null;
}

interface BankState {
  cfg: BankCashConfig;
  moves: CashMove[];
}

/** Carrega a conta Mercado Pago (configuração + extrato desde o início do controle) e acompanha ao vivo. */
function useBank(): BankState | null | undefined {
  const [state, setState] = useState<BankState | null | undefined>(isCloudActive() ? undefined : null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isCloudActive()) return;
    const sb = supabase();
    const ch = sb
      .channel(`cash-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bank_movements' }, () => setTick((t) => t + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'integrations' }, () => setTick((t) => t + 1));
    ch.subscribe();
    const timer = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => {
      clearInterval(timer);
      void sb.removeChannel(ch);
    };
  }, []);
  useEffect(() => {
    if (!isCloudActive()) return;
    let alive = true;
    void (async () => {
      const sb = supabase();
      const { data: integ } = await sb.from('integrations').select('config').eq('platform', 'mercadopago').limit(1).maybeSingle();
      const config = (integ?.config ?? null) as (Partial<BankCashConfig> & Record<string, unknown>) | null;
      if (!integ || !config?.startDate) {
        if (alive) setState(null);
        return;
      }
      const cfg: BankCashConfig = { startDate: config.startDate, opening: config.opening ?? null };
      const moves: CashMove[] = [];
      for (let from = 0; from < 50_000; from += 1000) {
        const { data } = await sb
          .from('bank_movements')
          .select('date, occurred_at, direction, amount, balance')
          .gte('date', cfg.startDate)
          .order('occurred_at', { ascending: true })
          .range(from, from + 999);
        moves.push(...((data ?? []) as CashMove[]).map((m) => ({ ...m, amount: Number(m.amount), balance: m.balance === null ? null : Number(m.balance) })));
        if (!data || data.length < 1000) break;
      }
      if (alive) setState({ cfg, moves });
    })();
    return () => {
      alive = false;
    };
  }, [tick]);
  return state;
}

/**
 * Caixa do período: saldo da conta Mercado Pago (quando conectada, a partir da data de início)
 * ou, sem banco, os lançamentos manuais de Caixa & capital. Nunca usa faturamento nem lucro.
 */
export function useCash(from: string, to: string, prevTo: string): CashView & { loading: boolean } {
  const db = useDb();
  const bank = useBank();
  return useMemo(() => {
    if (bank) {
      const { inflow, outflow } = bankFlows(bank.moves, bank.cfg, from, to);
      return {
        source: 'mercadopago' as const,
        value: bankCashAt(bank.moves, bank.cfg, to),
        prev: bankCashAt(bank.moves, bank.cfg, prevTo),
        inflow,
        outflow,
        startDate: bank.cfg.startDate,
        asOf: lastMoveAt(bank.moves, bank.cfg, to),
        loading: false,
      };
    }
    const cur = capitalSummary(db, { from, to });
    return {
      source: 'manual' as const,
      value: cur.cash,
      prev: capitalSummary(db, { from: prevTo, to: prevTo }).cash,
      inflow: cur.aportes,
      outflow: cur.retiradas + cur.investimentos,
      startDate: null,
      asOf: null,
      loading: bank === undefined,
    };
  }, [bank, db, from, to, prevTo]);
}
