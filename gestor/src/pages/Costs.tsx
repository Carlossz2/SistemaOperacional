import { useMemo, useState } from 'react';
import { useDb } from '../lib/store';
import { FilterBar, FilterNote, usePeriod } from '../lib/period';
import { previousPeriod, today } from '../lib/dates';
import { autoGrouping, computeTotals, costSummary, spendBreakdown, type CostRow, type Grouping } from '../lib/metrics';
import { money, pct, shortDate } from '../lib/format';
import { download, toCsv } from '../lib/io';
import { MiniKpi } from '../components/Kpi';
import { Icon } from '../components/Icon';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const GROUPS: { key: Grouping; label: string; unit: string; plural: string; full: string }[] = [
  { key: 'day', label: 'Por dia', unit: 'dia', plural: 'dias', full: 'dias completos' },
  { key: 'week', label: 'Por semana', unit: 'semana', plural: 'semanas', full: 'semanas completas' },
  { key: 'month', label: 'Por mês', unit: 'mês', plural: 'meses', full: 'meses completos' },
];

const rangeLabel = (from: string, to: string) => (from === to ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`);
const rowLabel = (r: CostRow, g: Grouping) => {
  if (g === 'month' && !r.partial) return `${MONTHS[Number(r.from.slice(5, 7)) - 1]}/${r.from.slice(0, 4)}`;
  return rangeLabel(r.from, r.to);
};

/** Controle de custos: quanto saiu (tráfego, despesas, taxas) e o resultado, por dia, semana ou mês, em qualquer período. */
export function Costs() {
  const db = useDb();
  const { period, productId, country } = usePeriod();
  const [manual, setManual] = useState<Grouping | ''>('');
  const [picked, setPicked] = useState<string | null>(null);
  const cur = db.settings.baseCurrency;
  const m = (v: number) => money(v, cur);
  const ref = today();

  const g: Grouping = manual || autoGrouping(period.from, period.to);
  const G = GROUPS.find((x) => x.key === g)!;
  const f = useMemo(() => ({ from: period.from, to: period.to, productId: productId || undefined, country: country || undefined }), [period, productId, country]);
  const rows = useMemo(() => costSummary(db, f, g, ref), [db, f, g, ref]);
  const total = useMemo(() => computeTotals(db, f), [db, f]);
  const prev = useMemo(() => (period.preset === 'all' ? null : computeTotals(db, { ...f, ...previousPeriod(period) })), [db, f, period]);
  const sel = rows.find((r) => r.from === picked) ?? null;
  const where = useMemo(() => spendBreakdown(db, sel ? { ...f, from: sel.from, to: sel.to } : f), [db, f, sel]);

  const spend = total.ads + total.expenses;
  const deductions = total.fees + total.refunds + total.tax;
  const prevSpend = prev ? prev.ads + prev.expenses : null;
  const maxSpend = Math.max(1, ...rows.map((r) => r.spend));
  // média só dos trechos completos com movimento (dias/semanas antes de começar a usar o sistema não puxam a média para baixo)
  const full = rows.filter((r) => !r.current && !r.partial && (r.spend > 0 || r.totals.gross > 0));
  const base = full.length ? full : rows.filter((r) => r.spend > 0 || r.totals.gross > 0);
  const avg = (fn: (r: CostRow) => number) => (base.length ? base.reduce((a, r) => a + fn(r), 0) / base.length : 0);
  const empty = !rows.some((r) => r.spend > 0 || r.totals.gross > 0);

  const exportCsv = () =>
    download(
      `custos-${period.from}-a-${period.to}.csv`,
      toCsv(
        rows.map((r) => ({
          [G.unit[0].toUpperCase() + G.unit.slice(1)]: `${r.from} a ${r.to}`,
          Faturamento: r.totals.gross,
          Trafego: r.totals.ads,
          Despesas: r.totals.expenses,
          'Taxas e impostos': r.deductions,
          'Custo total': r.spend,
          Lucro: r.totals.profit,
          ROI: r.totals.roi ?? '',
        })),
      ),
      'text/csv;charset=utf-8',
    );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Controle de custos</h1>
          <p className="muted">
            Quanto saiu com tráfego, despesas, taxas e impostos — e o resultado — por dia, semana ou mês. Atualiza sozinho com a Meta, as vendas por webhook e as despesas recorrentes.
          </p>
        </div>
        <div className="head-actions">
          <FilterBar inline />
          <select aria-label="Agrupar" value={manual} onChange={(e) => (setManual(e.target.value as Grouping | ''), setPicked(null))}>
            <option value="">Agrupar: automático ({G.label.toLowerCase()})</option>
            {GROUPS.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
          <button onClick={exportCsv} disabled={empty}>
            <Icon name="download" size={16} /> CSV
          </button>
        </div>
      </div>
      <FilterNote />

      <h2 className="section-title">
        {period.preset === 'all' ? 'Todo o período' : 'No período'}{' '}
        <span className="muted small">
          ({rangeLabel(period.from, period.to)}
          {prev ? ` · comparado com ${rangeLabel(previousPeriod(period).from, previousPeriod(period).to)}` : ''})
        </span>
      </h2>
      <div className="grid mini-row">
        <MiniKpi label="Custo total" value={m(spend)} current={prev && spend} previous={prevSpend} inverse title="Tráfego + despesas operacionais" />
        <MiniKpi label="Tráfego pago" value={m(total.ads)} current={prev && total.ads} previous={prev?.ads ?? null} inverse />
        <MiniKpi label="Despesas" value={m(total.expenses)} current={prev && total.expenses} previous={prev?.expenses ?? null} inverse />
        <MiniKpi
          label="Taxas e impostos"
          value={m(deductions)}
          current={prev && deductions}
          previous={prev ? prev.fees + prev.refunds + prev.tax : null}
          inverse
          title="Taxas de plataforma + reembolsos + impostos estimados"
        />
        <MiniKpi label="Faturamento" value={m(total.gross)} current={prev && total.gross} previous={prev?.gross ?? null} />
        <MiniKpi label="Lucro" value={m(total.profit)} negative={total.profit < 0} current={prev && total.profit} previous={prev?.profit ?? null} />
        <MiniKpi label="ROI" value={pct(total.roi)} negative={total.roi !== null && total.roi < 0} current={prev && total.roi} previous={prev?.roi ?? null} title="Lucro ÷ (tráfego + despesas)" />
        <MiniKpi
          label={`Custo médio por ${G.unit}`}
          value={m(avg((r) => r.spend))}
          current={null}
          previous={null}
          extra={<span className="muted small">{base.length ? `média de ${base.length} ${base.length === 1 ? G.unit : G.plural} com movimento` : 'sem movimento no período'}</span>}
        />
      </div>

      <div className="card mb">
        <div className="card-head">
          <div className="card-title">
            <span className="icon-box"><Icon name="calendar" size={17} /></span>
            <h2>Custos {G.label.toLowerCase()}</h2>
            <span className="muted small">{rows.length} {rows.length === 1 ? G.unit : G.plural}</span>
          </div>
          <span className="muted small">Clique numa linha para ver para onde foi o dinheiro</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{G.unit[0].toUpperCase() + G.unit.slice(1)}</th>
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
              {rows.map((r) => (
                <tr
                  key={r.from}
                  className={`clickable ${sel?.from === r.from ? 'selected' : ''}`}
                  onClick={() => setPicked(sel?.from === r.from ? null : r.from)}
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setPicked(sel?.from === r.from ? null : r.from)}
                  aria-selected={sel?.from === r.from}
                >
                  <td>
                    {rowLabel(r, g)}
                    {r.current ? <span className="muted small"> · em andamento</span> : r.partial && g !== 'day' ? <span className="muted small"> · parcial</span> : null}
                  </td>
                  <td className="num">{m(r.totals.gross)}</td>
                  <td className="num">{m(r.totals.ads)}</td>
                  <td className="num">{m(r.totals.expenses)}</td>
                  <td className="num">{m(r.deductions)}</td>
                  <td>
                    <div className="bar-cell" title={`Custo total: ${m(r.spend)}`}>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(r.spend / maxSpend) * 100}%` }} />
                      </div>
                      <span style={{ minWidth: 104, textAlign: 'right' }}>{m(r.spend)}</span>
                    </div>
                  </td>
                  <td className={`num ${r.totals.profit < 0 ? 'neg' : r.totals.profit > 0 ? 'pos' : ''}`}>{m(r.totals.profit)}</td>
                  <td className="num">{pct(r.totals.roi)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total do período</td>
                <td className="num">{m(total.gross)}</td>
                <td className="num">{m(total.ads)}</td>
                <td className="num">{m(total.expenses)}</td>
                <td className="num">{m(deductions)}</td>
                <td>{m(spend)}</td>
                <td className="num">{m(total.profit)}</td>
                <td className="num">{pct(total.roi)}</td>
              </tr>
              <tr className="muted">
                <td>Média por {G.unit}</td>
                <td className="num">{m(avg((r) => r.totals.gross))}</td>
                <td className="num">{m(avg((r) => r.totals.ads))}</td>
                <td className="num">{m(avg((r) => r.totals.expenses))}</td>
                <td className="num">{m(avg((r) => r.deductions))}</td>
                <td>{m(avg((r) => r.spend))}</td>
                <td className="num">{m(avg((r) => r.totals.profit))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="muted small" style={{ margin: '10px 0 0' }}>
          Despesas mensais recorrentes entram no dia em que são cobradas. A média considera só {G.full} com movimento.
        </p>
      </div>

      <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 'inherit' }}>Para onde foi o dinheiro · {sel ? rowLabel(sel, g) : 'período todo'}</h2>
        {sel && (
          <button className="link" onClick={() => setPicked(null)}>
            Ver o período todo
          </button>
        )}
      </div>
      <div className="grid cols-2">
        <SpendList title="Tráfego por fonte" icon="ads" rows={where.ads} money={m} empty="Sem gasto com anúncios." />
        <SpendList title="Despesas por categoria" icon="expenses" rows={where.expenses} money={m} empty="Sem despesas." />
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
