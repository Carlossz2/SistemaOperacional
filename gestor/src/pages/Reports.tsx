import { useMemo, useState } from 'react';
import { useDb } from '../lib/store';
import { FilterBar, usePeriod } from '../lib/period';
import { monthsBetween } from '../lib/dates';
import { breakdown, computeTotals, type Filter, type Totals } from '../lib/metrics';
import { money, monthLabel, num, pct, ratio } from '../lib/format';
import { download, toCsv } from '../lib/io';
import { BreakdownTable, DIM_LABEL, type Dim } from '../components/BreakdownTable';
import { Icon } from '../components/Icon';

type Line = { label: string; get: (t: Totals) => number | null; kind: 'money' | 'pct' | 'x' | 'int'; strong?: boolean; sign?: -1 };

// DRE gerencial simplificado de uma operação de direct response
const DRE: Line[] = [
  { label: 'Faturamento bruto', get: (t) => t.gross, kind: 'money', strong: true },
  { label: '(−) Taxas de plataforma', get: (t) => t.fees, kind: 'money', sign: -1 },
  { label: '(−) Reembolsos e chargebacks', get: (t) => t.refunds, kind: 'money', sign: -1 },
  { label: '(=) Receita líquida', get: (t) => t.net, kind: 'money', strong: true },
  { label: '(−) Tráfego pago', get: (t) => t.ads, kind: 'money', sign: -1 },
  { label: '(−) Despesas operacionais', get: (t) => t.expenses, kind: 'money', sign: -1 },
  { label: '(−) Impostos estimados', get: (t) => t.tax, kind: 'money', sign: -1 },
  { label: '(=) Lucro líquido', get: (t) => t.profit, kind: 'money', strong: true },
  { label: 'Margem líquida', get: (t) => t.margin, kind: 'pct' },
  { label: 'ROAS', get: (t) => t.roas, kind: 'x' },
  { label: 'ROI', get: (t) => t.roi, kind: 'pct' },
  { label: 'CPA', get: (t) => t.cpa, kind: 'money' },
  { label: 'Vendas', get: (t) => t.units, kind: 'int' },
];

export function Reports() {
  const db = useDb();
  const { period, productId, country } = usePeriod();
  const [dim, setDim] = useState<Dim>('productId');
  const cur = db.settings.baseCurrency;
  const base: Filter = { from: period.from, to: period.to, productId: productId || undefined, country: country || undefined };

  const months = useMemo(() => {
    return monthsBetween(period.from, period.to).map((m) => {
      const from = m + '-01' < period.from ? period.from : m + '-01';
      const endOfMonth = `${m}-${String(new Date(Number(m.slice(0, 4)), Number(m.slice(5)), 0).getDate()).padStart(2, '0')}`;
      const to = endOfMonth > period.to ? period.to : endOfMonth;
      return { m, t: computeTotals(db, { ...base, from, to }) };
    });
  }, [db, period, productId, country]);
  const total = useMemo(() => computeTotals(db, base), [db, period, productId, country]);
  const rows = useMemo(() => breakdown(db, base, dim), [db, period, productId, country, dim]);

  const fmt = (v: number | null, l: Line) =>
    v === null ? '—' : l.kind === 'pct' ? pct(v) : l.kind === 'int' ? num(v) : l.kind === 'x' ? ratio(v) : money((l.sign ?? 1) * v, cur);
  const nameOf = (k: string) => (dim === 'productId' ? db.products.find((p) => p.id === k)?.name ?? '—' : k);

  const exportDre = () => {
    const out = DRE.map((l) => ({
      Linha: l.label,
      ...Object.fromEntries(months.map(({ m, t }) => [m, l.get(t) ?? ''])),
      Total: l.get(total) ?? '',
    }));
    download(`dre-${period.from}-${period.to}.csv`, toCsv(out), 'text/csv;charset=utf-8');
  };
  const exportBreakdown = () => {
    const out = rows.map((r) => ({
      [DIM_LABEL[dim]]: nameOf(r.key),
      Vendas: r.units, Bruto: r.gross, Taxas: r.fees, Reembolsos: r.refunds, Liquido: r.net,
      Ads: r.ads, Despesas: r.expenses, Impostos: r.tax, Lucro: r.profit, ROAS: r.roas ?? '', CPA: r.cpa ?? '',
    }));
    download(`relatorio-${dim}-${period.from}-${period.to}.csv`, toCsv(out), 'text/csv;charset=utf-8');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Relatórios</h1>
          <p className="muted">DRE mensal e quebras de desempenho da operação.</p>
        </div>
      </div>
      <FilterBar />

      <div className="card mb">
        <div className="card-head">
          <h2>DRE gerencial (mês a mês)</h2>
          <button onClick={exportDre}><Icon name="download" size={16} /> CSV</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th />
                {months.map(({ m }) => <th key={m} className="num">{monthLabel(m)}</th>)}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {DRE.map((l) => (
                <tr key={l.label} style={l.strong ? { fontWeight: 700 } : undefined}>
                  <td>{l.label}</td>
                  {months.map(({ m, t }) => {
                    const v = l.get(t);
                    const neg = l.label.includes('Lucro') && v !== null && v < 0;
                    return <td key={m} className={`num ${neg ? 'neg' : ''}`}>{fmt(v, l)}</td>;
                  })}
                  <td className={`num ${l.label.includes('Lucro') && total.profit < 0 ? 'neg' : ''}`}><b>{fmt(l.get(total), l)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="segmented" role="tablist">
            {(Object.keys(DIM_LABEL) as Dim[]).map((d) => (
              <button key={d} className={d === dim ? 'on' : ''} onClick={() => setDim(d)} role="tab" aria-selected={d === dim}>
                {DIM_LABEL[d]}
              </button>
            ))}
          </div>
          <button onClick={exportBreakdown} disabled={!rows.length}><Icon name="download" size={16} /> CSV</button>
        </div>
        <BreakdownTable
          rows={rows}
          dim={dim}
          currency={cur}
          nameOf={nameOf}
          targetCpa={dim === 'productId' ? (id) => db.products.find((x) => x.id === id)?.targetCpa || undefined : undefined}
        />
        {dim !== 'productId' && (
          <p className="muted small">Nesta visão o resultado é margem de contribuição (receita líquida − ads − impostos), sem despesas fixas.</p>
        )}
      </div>
    </>
  );
}
