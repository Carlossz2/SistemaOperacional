import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { MiniKpi } from './Kpi';
import { fmtDateTime, SecretField, useIntegrations } from '../pages/Integrations';
import { supabase } from '../lib/cloud/sync';
import { addDays, today } from '../lib/dates';
import { money, shortDate } from '../lib/format';
import { download, toCsv } from '../lib/io';
import { capitalSummary } from '../lib/metrics';
import { usePeriod } from '../lib/period';
import { isCloudActive, useDb } from '../lib/store';

interface Movement {
  id: string;
  date: string;
  occurred_at: string | null;
  direction: 'in' | 'out';
  amount: number;
  balance: number | null;
  kind: string;
  description: string;
  source_id: string | null;
}

/** Topo da aba Caixa & capital: conta Mercado Pago (saldo, entradas, saídas e extrato) + caixa estimado. */
export function BankPanel() {
  return isCloudActive() ? <Cloud /> : <Local />;
}

function Local() {
  return (
    <>
      <CashKpis />
      <div className="callout mb">
        <h2>Conta Mercado Pago</h2>
        <p>
          Para puxar sozinho tudo que entra e sai da conta da empresa, conecte o Supabase em <Link to="/configuracoes">Configurações</Link>.
        </p>
      </div>
    </>
  );
}

/** Caixa estimado pelos lançamentos (vendas − custos + aportes − retiradas − investimentos). */
function CashKpis({ bank }: { bank?: { balance: number | null; asOf: string | null; inflow: number; outflow: number } }) {
  const db = useDb();
  const { period } = usePeriod();
  const cur = db.settings.baseCurrency;
  const m = (v: number) => money(v, cur);
  const cap = useMemo(() => capitalSummary(db, { from: period.from, to: period.to }), [db, period]);
  return (
    <div className="grid mini-row">
      {bank && (
        <>
          <MiniKpi
            label="Saldo na conta (Mercado Pago)"
            value={bank.balance === null ? '—' : m(bank.balance)}
            current={null}
            previous={null}
            extra={<span className="muted small">{bank.asOf ? `após a última movimentação (${fmtDateTime(bank.asOf)})` : 'aguardando o 1º extrato'}</span>}
          />
          <MiniKpi label="Entradas no período" value={m(bank.inflow)} current={null} previous={null} extra={<span className="muted small">na conta</span>} />
          <MiniKpi label="Saídas no período" value={m(bank.outflow)} current={null} previous={null} extra={<span className="muted small">na conta</span>} />
          <MiniKpi
            label="Resultado da conta"
            value={m(bank.inflow - bank.outflow)}
            negative={bank.inflow - bank.outflow < 0}
            current={null}
            previous={null}
            extra={<span className="muted small">entradas − saídas</span>}
          />
        </>
      )}
      <MiniKpi
        label="Caixa estimado (lançamentos)"
        value={m(cap.cash)}
        negative={cap.cash < 0}
        current={null}
        previous={null}
        title="Aportes + lucro acumulado − retiradas − investimentos, até o fim do período"
        extra={<span className="muted small">até {shortDate(period.to)}</span>}
      />
      <MiniKpi label="Aportes no período" value={m(cap.aportes)} current={null} previous={null} extra={<span className="muted small">capital que entrou</span>} />
      <MiniKpi
        label="Retiradas + investimentos"
        value={m(cap.retiradas + cap.investimentos)}
        current={null}
        previous={null}
        extra={<span className="muted small">no período</span>}
      />
    </div>
  );
}

const RANGES = [
  { v: '30', label: 'Últimos 30 dias' },
  { v: '90', label: 'Últimos 90 dias' },
  { v: '365', label: 'Últimos 12 meses' },
];

function Cloud() {
  const { list, secrets, reload, loaded } = useIntegrations();
  const { period } = usePeriod();
  const bank = list.find((i) => i.platform === 'mercadopago');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [range, setRange] = useState('90');
  const [moves, setMoves] = useState<Movement[]>([]);
  const [last, setLast] = useState<Movement | null>(null);
  const [tick, setTick] = useState(0);
  const timers = useRef<number[]>([]);

  // extrato do período + último saldo (ao vivo + reserva a cada 60 s)
  useEffect(() => {
    const sb = supabase();
    const ch = sb
      .channel(`bank-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bank_movements' }, () => setTick((t) => t + 1));
    ch.subscribe();
    const timer = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => {
      clearInterval(timer);
      timers.current.forEach(clearTimeout);
      void sb.removeChannel(ch);
    };
  }, []);
  useEffect(() => {
    if (!bank) return;
    const sb = supabase();
    void (async () => {
      const all: Movement[] = [];
      for (let from = 0; from < 20_000; from += 1000) {
        const { data } = await sb
          .from('bank_movements')
          .select('id, date, occurred_at, direction, amount, balance, kind, description, source_id')
          .gte('date', period.from)
          .lte('date', period.to)
          .order('occurred_at', { ascending: false })
          .range(from, from + 999);
        all.push(...((data ?? []) as Movement[]));
        if (!data || data.length < 1000) break;
      }
      setMoves(all.map((x) => ({ ...x, amount: Number(x.amount), balance: x.balance === null ? null : Number(x.balance) })));
      const { data: lastRow } = await sb
        .from('bank_movements')
        .select('id, date, occurred_at, direction, amount, balance, kind, description, source_id')
        .not('balance', 'is', null)
        .order('occurred_at', { ascending: false })
        .limit(1);
      setLast(lastRow?.[0] ? ({ ...lastRow[0], balance: Number(lastRow[0].balance) } as Movement) : null);
    })();
  }, [bank?.id, period.from, period.to, tick]);

  const invoke = useCallback(
    async (body: Record<string, unknown>) => {
      const { data, error } = await supabase().functions.invoke('bank-sync', { body: { integrationId: bank?.id, ...body } });
      const text = error ? `Erro: ${error.message}` : (data?.results ?? []).map((r: { ok: boolean; message: string }) => `${r.ok ? '✓' : '✗'} ${r.message}`).join(' · ');
      setMsg(text);
      await reload();
      setTick((t) => t + 1);
      return data?.ok === true;
    },
    [bank?.id, reload],
  );

  const connect = async () => {
    setBusy(true);
    const { error } = await supabase().from('integrations').insert({ platform: 'mercadopago', name: 'Mercado Pago', config: {} });
    setBusy(false);
    if (error) return alert(error.message);
    setOpen(true);
    await reload();
  };

  const syncNow = async () => {
    setBusy(true);
    setMsg('Pedindo o extrato ao Mercado Pago…');
    const ok = await invoke({ since: addDays(today(), -(Number(range) - 1)), until: today() });
    setBusy(false);
    // o relatório leva alguns minutos para ficar pronto: busca de novo sozinho enquanto a tela estiver aberta
    if (ok) for (const wait of [60_000, 180_000, 420_000]) timers.current.push(window.setTimeout(() => void invoke({ action: 'import' }), wait));
  };

  const flows = useMemo(() => {
    const inflow = moves.filter((x) => x.direction === 'in').reduce((a, x) => a + x.amount, 0);
    const outflow = moves.filter((x) => x.direction === 'out').reduce((a, x) => a + x.amount, 0);
    return { inflow, outflow };
  }, [moves]);

  if (!loaded) return <CashKpis />;

  const hasToken = Boolean(bank && secrets[bank.id]?.has_access_token);
  const lastError = bank?.last_sync_status?.startsWith('erro') ? bank.last_sync_status.replace(/^erro:\s*/, '') : '';
  const state = !bank
    ? null
    : !hasToken
      ? { tone: 'warn', label: 'Falta salvar o Access Token' }
      : lastError
        ? { tone: 'warn', label: 'Erro na última sincronização' }
        : bank.enabled
          ? { tone: 'ok', label: 'Automático · de hora em hora' }
          : { tone: 'info', label: 'Sincronização automática pausada' };
  const showConfig = Boolean(bank) && (open || !hasToken);

  return (
    <>
      <div className="card mb">
        <div className="card-head">
          <div className="card-title">
            <span className="icon-box"><Icon name="wallet" size={17} /></span>
            <h2>Conta Mercado Pago</h2>
            {state && <span className={`status ${state.tone}`}>{state.label}</span>}
          </div>
          <div className="head-actions">
            {!bank ? (
              <button className="primary" disabled={busy} onClick={connect}>
                <Icon name="plus" size={15} /> Conectar Mercado Pago
              </button>
            ) : (
              <>
                <select aria-label="Período do extrato" value={range} onChange={(e) => setRange(e.target.value)} disabled={!hasToken}>
                  {RANGES.map((r) => (
                    <option key={r.v} value={r.v}>{r.label}</option>
                  ))}
                </select>
                <button disabled={busy || !hasToken} onClick={syncNow}>
                  <Icon name="refresh" size={14} /> Sincronizar agora
                </button>
                {hasToken && <button onClick={() => setOpen(!open)}>{open ? 'Fechar' : 'Configurar'}</button>}
              </>
            )}
          </div>
        </div>
        {!bank ? (
          <p className="muted small" style={{ margin: 0 }}>
            Conecte a conta da empresa uma vez e tudo que entra e sai (recebimentos, Pix e transferências enviados, saques, reembolsos, tarifas)
            entra aqui sozinho, de hora em hora, com o saldo.
          </p>
        ) : (
          <p className="muted small" style={{ margin: showConfig ? '0 0 14px' : 0 }}>
            {msg ||
              (lastError
                ? `Última tentativa ${fmtDateTime(bank.last_sync_at)}: ${lastError}`
                : bank.last_sync_at
                  ? `Última sincronização ${fmtDateTime(bank.last_sync_at)} · ${(bank.last_sync_status ?? '').replace(/^ok:\s*/, '')}`
                  : hasToken
                    ? 'Pronto. Escolha o período e clique em "Sincronizar agora" para trazer o histórico.'
                    : 'Cole o Access Token abaixo para começar.')}
          </p>
        )}
        {showConfig && bank && (
          <div className="form-grid">
            <SecretField integId={bank.id} kind="access_token" label="Access Token de produção (APP_USR-…)" has={hasToken} onSaved={reload} />
            <div className="field">
              <label className="check" style={{ marginTop: 22 }}>
                <input
                  type="checkbox"
                  checked={bank.enabled}
                  onChange={async (e) => {
                    await supabase().from('integrations').update({ enabled: e.target.checked }).eq('id', bank.id);
                    await reload();
                  }}
                />
                Atualizar sozinho de hora em hora
              </label>
            </div>
            <details className="span-2" open={!hasToken}>
              <summary className="small" style={{ cursor: 'pointer' }}>Como pegar o Access Token do Mercado Pago</summary>
              <ol className="small muted">
                <li>Entre em <b>mercadopago.com.br/developers/panel/app</b> com a conta da empresa.</li>
                <li>Clique em <b>Criar aplicação</b> (qualquer nome, ex.: CADIGITAL). Se pedir o tipo, escolha pagamentos online / outra.</li>
                <li>Na aplicação, abra <b>Credenciais de produção</b> e copie o <b>Access Token</b> (começa com APP_USR-).</li>
                <li>Cole acima e clique em Salvar. Ele fica guardado só no servidor e não aparece de volta.</li>
                <li>Depois clique em <b>Sincronizar agora</b>. O Mercado Pago leva alguns minutos para gerar o extrato; ele entra sozinho.</li>
              </ol>
            </details>
          </div>
        )}
      </div>

      <CashKpis bank={bank ? { balance: last?.balance ?? null, asOf: last?.occurred_at ?? null, inflow: flows.inflow, outflow: flows.outflow } : undefined} />

      {bank && <Statement moves={moves} />}
    </>
  );
}

function Statement({ moves }: { moves: Movement[] }) {
  const db = useDb();
  const [dir, setDir] = useState<'' | 'in' | 'out'>('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(50);
  const m = (v: number) => money(v, db.settings.baseCurrency);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return moves.filter((x) => (!dir || x.direction === dir) && (!needle || `${x.description} ${x.kind} ${x.source_id ?? ''}`.toLowerCase().includes(needle)));
  }, [moves, dir, q]);
  const byKind = useMemo(() => {
    const out = new Map<string, number>();
    for (const x of moves.filter((x) => x.direction === 'out')) out.set(x.kind, (out.get(x.kind) ?? 0) + x.amount);
    return [...out.entries()].sort((a, b) => b[1] - a[1]);
  }, [moves]);

  const exportCsv = () =>
    download(
      `extrato-mercadopago-${today()}.csv`,
      toCsv(rows.map((x) => ({ Data: x.date, Tipo: x.kind, Descricao: x.description, Entrada: x.direction === 'in' ? x.amount : '', Saida: x.direction === 'out' ? x.amount : '', Saldo: x.balance ?? '', ID: x.source_id ?? '' }))),
      'text/csv;charset=utf-8',
    );

  return (
    <div className="card mb">
      <div className="card-head">
        <div className="card-title">
          <span className="icon-box"><Icon name="flow" size={17} /></span>
          <h2>Extrato da conta</h2>
        </div>
        <div className="head-actions">
          <label className="search">
            <Icon name="search" size={15} />
            <input placeholder="Descrição ou ID" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <select aria-label="Tipo de movimentação" value={dir} onChange={(e) => setDir(e.target.value as '' | 'in' | 'out')}>
            <option value="">Entradas e saídas</option>
            <option value="in">Só entradas</option>
            <option value="out">Só saídas</option>
          </select>
          <button onClick={exportCsv} disabled={!rows.length}>
            <Icon name="download" size={15} /> CSV
          </button>
        </div>
      </div>
      {byKind.length > 0 && (
        <p className="small muted" style={{ margin: '0 0 10px' }}>
          Saídas no período por tipo: {byKind.map(([k, v]) => `${k} ${m(v)}`).join(' · ')}
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Movimentação</th>
              <th className="num">Entrada</th>
              <th className="num">Saída</th>
              <th className="num">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((x) => (
              <tr key={x.id}>
                <td>{shortDate(x.date)}</td>
                <td>
                  {x.description || x.kind}
                  {x.source_id && <span className="muted small"> · #{x.source_id}</span>}
                </td>
                <td className="num pos">{x.direction === 'in' ? m(x.amount) : ''}</td>
                <td className="num neg">{x.direction === 'out' ? m(x.amount) : ''}</td>
                <td className="num muted">{x.balance === null ? '—' : m(x.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">Nenhuma movimentação no período.</div>}
      </div>
      {rows.length > limit && (
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <button onClick={() => setLimit(limit + 100)}>Mostrar mais ({rows.length - limit})</button>
        </div>
      )}
    </div>
  );
}
