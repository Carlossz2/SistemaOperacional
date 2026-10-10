import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useDb, replaceDb } from '../lib/store';
import { FilterBar, usePeriod } from '../lib/period';
import { previousPeriod } from '../lib/dates';
import { breakdown, capitalSummary, computeTotals, expensesByCategory, timeSeries, type Filter } from '../lib/metrics';
import { money, num, pct, ratio, shortDate } from '../lib/format';
import { Kpi } from '../components/Kpi';
import { CumulativeChart, ProfitChart, RevenueVsAdsChart } from '../components/Charts';
import { BreakdownTable } from '../components/BreakdownTable';
import { demoDb } from '../lib/demo';

export function Dashboard() {
  const db = useDb();
  const { period, productId, country } = usePeriod();
  const cur = db.settings.baseCurrency;
  const f: Filter = { from: period.from, to: period.to, productId: productId || undefined, country: country || undefined };
  const prevF: Filter = { ...f, ...previousPeriod(period) };

  const data = useMemo(() => {
    return {
      t: computeTotals(db, f),
      p: computeTotals(db, prevF),
      series: timeSeries(db, f),
      byProduct: breakdown(db, f, 'productId'),
      byCountry: breakdown(db, f, 'country'),
      bySource: breakdown(db, f, 'source'),
      categories: expensesByCategory(db, f),
      capital: capitalSummary(db, f),
    };
  }, [db, f.from, f.to, f.productId, f.country]);

  const empty = !db.sales.length && !db.ads.length && !db.expenses.length;
  const { t, p } = data;
  const m = (v: number) => money(v, cur);
  const productName = (id: string) => db.products.find((x) => x.id === id)?.name ?? '—';
  const totalCat = data.categories.reduce((a, c) => a + c.amount, 0) || 1;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{db.settings.businessName}</h1>
          <p className="muted">
            {shortDate(period.from)} – {shortDate(period.to)} · valores em {cur}
          </p>
        </div>
      </div>
      <FilterBar />

      {empty && (
        <div className="callout mb">
          <h2>Bem-vindo ao seu Gestor DR</h2>
          <p>
            Comece cadastrando suas <Link to="/produtos">ofertas</Link>, depois lance <Link to="/receitas">receitas</Link>,{' '}
            <Link to="/trafego">tráfego</Link> e <Link to="/despesas">despesas</Link>. Ou explore com dados fictícios.
          </p>
          <button className="primary" onClick={() => replaceDb(demoDb())}>
            Carregar dados de demonstração
          </button>
        </div>
      )}

      <div className="grid kpis">
        <Kpi hero label="Lucro líquido" value={m(t.profit)} negative={t.profit < 0} current={t.profit} previous={p.profit}
          title="Receita líquida − ads − despesas − impostos estimados" />
        <Kpi label="Faturamento bruto" value={m(t.gross)} current={t.gross} previous={p.gross} />
        <Kpi label="Receita líquida" value={m(t.net)} current={t.net} previous={p.net} title="Bruto − taxas − reembolsos" />
        <Kpi label="Investimento em ads" value={m(t.ads)} current={t.ads} previous={p.ads} inverse />
        <Kpi label="ROAS" value={ratio(t.roas)} current={t.roas} previous={p.roas} title="Faturamento bruto ÷ ads"
          extra={<div className="muted small">Líquido: {ratio(t.netRoas)}</div>} />
        <Kpi label="ROI" value={pct(t.roi)} current={t.roi} previous={p.roi} title="Lucro ÷ (ads + despesas)" />
        <Kpi label="Margem líquida" value={pct(t.margin)} current={t.margin} previous={p.margin} title="Lucro ÷ faturamento bruto" />
        <Kpi label="CPA" value={t.cpa === null ? '—' : m(t.cpa)} current={t.cpa} previous={p.cpa} inverse title="Ads ÷ nº de vendas" />
        <Kpi label="Vendas" value={num(t.units)} current={t.units} previous={p.units}
          extra={<div className="muted small">Ticket médio: {t.aov === null ? '—' : m(t.aov)}</div>} />
        <Kpi label="Despesas operacionais" value={m(t.expenses)} current={t.expenses} previous={p.expenses} inverse />
        <Kpi label="Impostos estimados" value={m(t.tax)} current={t.tax} previous={p.tax} inverse
          title={`${db.settings.taxRate}% sobre a receita líquida (ajuste em Configurações)`} />
        <Kpi label="Taxa de reembolso" value={pct(t.refundRate)} current={t.refundRate} previous={p.refundRate} inverse
          extra={<div className="muted small">{m(t.refunds)} devolvidos</div>} />
      </div>

      <div className="grid cols-2 mb">
        <div className="card">
          <div className="card-head">
            <h2>Lucro {data.series.granularity === 'day' ? 'por dia' : 'por mês'}</h2>
            <span className="legend">
              <span><i className="swatch" style={{ background: 'var(--pos)' }} />Lucro</span>
              <span><i className="swatch" style={{ background: 'var(--neg)' }} />Prejuízo</span>
            </span>
          </div>
          <ProfitChart {...data.series} currency={cur} />
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Receita líquida × ads</h2>
          </div>
          <RevenueVsAdsChart {...data.series} currency={cur} />
        </div>
      </div>

      <div className="card mb">
        <div className="card-head">
          <h2>Desempenho por produto</h2>
          <Link to="/relatorios" className="small">Ver relatórios →</Link>
        </div>
        <BreakdownTable
          rows={data.byProduct}
          dim="productId"
          currency={cur}
          nameOf={productName}
          targetCpa={(id) => db.products.find((x) => x.id === id)?.targetCpa || undefined}
        />
      </div>

      <div className="grid cols-2 mb">
        <div className="card">
          <h2>Por país</h2>
          <BreakdownTable rows={data.byCountry} dim="country" currency={cur} limit={8} compact />
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <h2>Investimento por fonte de tráfego</h2>
            <BreakdownTable rows={data.bySource} dim="source" currency={cur} />
          </div>
          <div className="card">
            <h2>Caixa & capital</h2>
            <table>
              <tbody>
                <tr><td>Aportes no período</td><td className="num pos">{m(data.capital.aportes)}</td></tr>
                <tr><td>Retiradas no período</td><td className="num neg">{m(data.capital.retiradas)}</td></tr>
                <tr><td>Investimentos no período</td><td className="num neg">{m(data.capital.investimentos)}</td></tr>
                <tr><td>Lucro acumulado (total)</td><td className="num">{m(data.capital.accumulatedProfit)}</td></tr>
              </tbody>
              <tfoot>
                <tr><td>Caixa estimado</td><td className={`num ${data.capital.cash < 0 ? 'neg' : ''}`}>{m(data.capital.cash)}</td></tr>
              </tfoot>
            </table>
            <p className="muted small">Aportes + lucro acumulado − retiradas − investimentos, até {shortDate(period.to)}.</p>
          </div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Lucro acumulado no período</h2>
          <CumulativeChart {...data.series} currency={cur} />
        </div>
        <div className="card">
          <h2>Despesas por categoria</h2>
          {data.categories.length ? (
            <table>
              <tbody>
                {data.categories.map((c) => (
                  <tr key={c.category}>
                    <td>{c.category}</td>
                    <td style={{ width: '40%' }}>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(c.amount / totalCat) * 100}%` }} />
                      </div>
                    </td>
                    <td className="num">{pct(c.amount / totalCat, 0)}</td>
                    <td className="num">{m(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">Sem despesas no período.</div>
          )}
        </div>
      </div>
    </>
  );
}
