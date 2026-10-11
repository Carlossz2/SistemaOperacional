import { useMemo, useState } from 'react';
import { useDb } from '../lib/store';
import { today } from '../lib/dates';
import { spendBreakdown, weeklySummary, weekToDate, type WeekRow } from '../lib/metrics';
import { money, pct } from '../lib/format';
import { download, toCsv } from '../lib/io';
import { MiniKpi } from '../components/Kpi';
import { Icon } from '../components/Icon';

const dm = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const label = (w: WeekRow) => `${dm(w.from)} – ${dm(w.to)}`;
const COUNTS = [8, 12, 26, 52];

/** Controle de gastos semana a semana (segunda a domingo). Tudo calculado na hora a partir dos lançamentos. */
export function Weekly() {
  const db = useDb();
  const [count, setCount] = useState(12);
  const [productId, setProductId] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const cur = db.settings.baseCurrency;
  const m = (v: number) => money(v, cur);
  const ref = today();
  const f = useMemo(() => (productId ? { productId } : {}), [productId]);

  const weeks = useMemo(() => weeklySummary(db, count, ref, f), [db, count, ref, f]);
  const wtd = useMemo(() => weekToDate(db, ref, f), [db, ref, f]);
  const sel = weeks.find((w) => w.from === picked) ?? weeks[0];
  const where = useMemo(() => spendBreakdown(db, { from: sel.from, to: sel.to, ...f }), [db, sel, f]);
  const maxSpend = Math.max(1, ...weeks.map((w) => w.spend));
  // média só das semanas fechadas com movimento (semanas antes de começar a usar o sistema não puxam a média para baixo)
  const closed = weeks.filter((w) => !w.current && (w.spend > 0 || w.totals.gross > 0));
  const avg = (fn: (w: WeekRow) => number) => (closed.length ? closed.reduce((a, w) => a + fn(w), 0) / closed.length : 0);
  const c = wtd.current;
  const p = wtd.previous;

  const exportCsv = () =>
    download(
      `semanal-${ref}.csv`,
      toCsv(
        weeks.map((w) => ({
          Semana: `${w.from} a ${w.to}`,
          Faturamento: w.totals.gross,
          Trafego: w.totals.ads,
          Despesas: w.totals.expenses,
          'Taxas e impostos': w.deductions,
          'Custo total': w.spend,
          Lucro: w.totals.profit,
          ROI: w.totals.roi ?? '',
        })),
      ),
      'text/csv;charset=utf-8',
    );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Semana a semana</h1>
          <p className="muted">
            Gastos e resultado de cada semana (segunda a domingo). Atualiza sozinho com a Meta, as vendas por webhook e as despesas recorrentes.
          </p>
        </div>
        <div className="toolbar" style={{ margin: 0 }}>
          <button onClick={exportCsv}>
            <Icon name="download" size={16} /> CSV
          </button>
        </div>
      </div>

      <div className="toolbar">
        <select aria-label="Quantidade de semanas" value={count} onChange={(e) => setCount(Number(e.target.value))}>
          {COUNTS.map((n) => (
            <option key={n} value={n}>Últimas {n} semanas</option>
          ))}
        </select>
        <select aria-label="Produto" value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Todos os produtos</option>
          {db.products.map((x) => (
            <option key={x.id} value={x.id}>{x.name}</option>
          ))}
        </select>
      </div>

      <h2 className="section-title">
        Esta semana <span className="muted small">({label(c)} · comparado com {label(p)})</span>
      </h2>
      <div className="grid mini-row">
        <MiniKpi label="Custo total" value={m(c.spend)} current={c.spend} previous={p.spend} inverse title="Tráfego + despesas operacionais" />
        <MiniKpi label="Tráfego pago" value={m(c.totals.ads)} current={c.totals.ads} previous={p.totals.ads} inverse />
        <MiniKpi label="Despesas" value={m(c.totals.expenses)} current={c.totals.expenses} previous={p.totals.expenses} inverse />
        <MiniKpi label="Taxas e impostos" value={m(c.deductions)} current={c.deductions} previous={p.deductions} inverse title="Taxas de plataforma + reembolsos + impostos estimados" />
        <MiniKpi label="Faturamento" value={m(c.totals.gross)} current={c.totals.gross} previous={p.totals.gross} />
        <MiniKpi label="Lucro" value={m(c.totals.profit)} negative={c.totals.profit < 0} current={c.totals.profit} previous={p.totals.profit} />
        <MiniKpi label="ROI" value={pct(c.totals.roi)} negative={c.totals.roi !== null && c.totals.roi < 0} current={c.totals.roi} previous={p.totals.roi} title="Lucro ÷ (tráfego + despesas)" />
        <MiniKpi
          label="Média semanal de custo"
          value={m(avg((w) => w.spend))}
          current={null}
          previous={null}
          extra={<span className="muted small">{closed.length ? `${closed.length} semana(s) fechada(s) com movimento` : 'nenhuma semana fechada ainda'}</span>}
        />
      </div>

      <div className="card mb">
        <div className="card-head">
          <div className="card-title">
            <span className="icon-box"><Icon name="calendar" size={17} /></span>
            <h2>Histórico semanal</h2>
          </div>
          <span className="muted small">Clique numa semana para ver para onde foi o dinheiro</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Semana</th>
                <th className="num">Faturamento</th>
                <th className="num">Tráfego</th>
                <th className="num">Despesas</th>
                <th className="num">Taxas e impostos</th>
                <th>Custo total</th>
                <th className="num">Lucro</th>
                <th className="num">ROI</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr
                  key={w.from}
                  className={`clickable ${w.from === sel.from ? 'selected' : ''}`}
                  onClick={() => setPicked(w.from)}
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setPicked(w.from)}
                  aria-selected={w.from === sel.from}
                >
                  <td>
                    {label(w)}
                    {w.current && <span className="muted small"> · em andamento</span>}
                  </td>
                  <td className="num">{m(w.totals.gross)}</td>
                  <td className="num">{m(w.totals.ads)}</td>
                  <td className="num">{m(w.totals.expenses)}</td>
                  <td className="num">{m(w.deductions)}</td>
                  <td>
                    <div className="bar-cell" title={`Custo total: ${m(w.spend)}`}>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(w.spend / maxSpend) * 100}%` }} />
                      </div>
                      <span style={{ minWidth: 104, textAlign: 'right' }}>{m(w.spend)}</span>
                    </div>
                  </td>
                  <td className={`num ${w.totals.profit < 0 ? 'neg' : w.totals.profit > 0 ? 'pos' : ''}`}>{m(w.totals.profit)}</td>
                  <td className="num">{pct(w.totals.roi)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Média ({closed.length} sem. fechadas)</td>
                <td className="num">{m(avg((w) => w.totals.gross))}</td>
                <td className="num">{m(avg((w) => w.totals.ads))}</td>
                <td className="num">{m(avg((w) => w.totals.expenses))}</td>
                <td className="num">{m(avg((w) => w.deductions))}</td>
                <td>{m(avg((w) => w.spend))}</td>
                <td className="num">{m(avg((w) => w.totals.profit))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="muted small" style={{ margin: '10px 0 0' }}>
          Despesas mensais recorrentes entram na semana do dia em que são cobradas.
        </p>
      </div>

      <div className="grid cols-2">
        <SpendList title={`Tráfego por fonte · ${label(sel)}`} icon="ads" rows={where.ads} money={m} empty="Sem gasto com anúncios nessa semana." />
        <SpendList title={`Despesas por categoria · ${label(sel)}`} icon="expenses" rows={where.expenses} money={m} empty="Sem despesas nessa semana." />
      </div>
    </>
  );
}

function SpendList(p: { title: string; icon: string; rows: { label: string; amount: number }[]; money: (v: number) => string; empty: string }) {
  const total = p.rows.reduce((a, r) => a + r.amount, 0);
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">
          <span className="icon-box"><Icon name={p.icon} size={17} /></span>
          <h2>{p.title}</h2>
        </div>
        {total > 0 && <b>{p.money(total)}</b>}
      </div>
      {!p.rows.length ? (
        <div className="empty">{p.empty}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td>
                    <div className="bar-cell" title={`${r.label}: ${p.money(r.amount)}`}>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(r.amount / total) * 100}%` }} />
                      </div>
                      <span style={{ minWidth: 56, textAlign: 'right' }} className="muted small">{pct(r.amount / total, 0)}</span>
                    </div>
                  </td>
                  <td className="num">{p.money(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
