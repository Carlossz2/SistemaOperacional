import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDb } from '../lib/store';
import { FilterBar, FilterNote, usePeriod } from '../lib/period';
import { previousPeriod, type PresetKey } from '../lib/dates';
import { breakdown, capitalSummary, computeTotals, expensesByCategory, timeSeries, type Filter, type Totals } from '../lib/metrics';
import { money, num, pct, ratio, shortDate } from '../lib/format';
import { download, toCsv } from '../lib/io';
import { HeroKpi, MiniKpi } from '../components/Kpi';
import { DonutChart, FlowChart, ProfitChart } from '../components/Charts';
import { BreakdownTable } from '../components/BreakdownTable';
import { Transactions } from '../components/Transactions';
import { Icon } from '../components/Icon';
import { RefreshButton } from '../components/RefreshButton';

const RANGES: { key: PresetKey; label: string }[] = [
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
  { key: '365d', label: '1A' },
  { key: 'all', label: 'Tudo' },
];

/** Custos totais = tudo que sai do faturamento bruto. */
const totalCosts = (t: Totals) => t.fees + t.refunds + t.ads + t.expenses + t.tax;

export function Dashboard() {
  const db = useDb();
  const { period, productId, country, setPreset } = usePeriod();
  const [refreshed, setRefreshed] = useState<{ ok: boolean; message: string; at: Date } | null>(null);
  const cur = db.settings.baseCurrency;
  const f = useMemo<Filter>(
    () => ({ from: period.from, to: period.to, productId: productId || undefined, country: country || undefined }),
    [period.from, period.to, productId, country],
  );

  const data = useMemo(() => {
    const prevF = { ...f, ...previousPeriod(period) };
    return {
      t: computeTotals(db, f),
      p: computeTotals(db, prevF),
      series: timeSeries(db, f),
      flow: timeSeries(db, f, 366),
      byProduct: breakdown(db, f, 'productId'),
      byCountry: breakdown(db, f, 'country'),
      bySource: breakdown(db, f, 'source'),
      categories: expensesByCategory(db, f),
      capital: capitalSummary(db, f),
      prevCapital: capitalSummary(db, prevF),
    };
  }, [db, f, period]);

  const empty = !db.sales.length && !db.ads.length && !db.expenses.length;
  const { t, p, capital } = data;
  const m = (v: number) => money(v, cur);
  const productName = (id: string) => db.products.find((x) => x.id === id)?.name ?? '—';
  const totalCat = data.categories.reduce((a, c) => a + c.amount, 0) || 1;
  const costs = totalCosts(t);
  const prevCosts = totalCosts(p);
  const generated = db.capital.filter((c) => c.kind === 'aporte' && c.date <= period.to).reduce((a, c) => a + c.amount * c.rate, 0) +
    Math.max(0, capital.accumulatedProfit);

  const exportCsv = () => {
    const rows = data.series.points.map((pt) => ({
      Periodo: pt.key,
      'Receita liquida': pt.net,
      Ads: pt.ads,
      Despesas: pt.expenses,
      Impostos: pt.tax,
      Lucro: pt.profit,
      'Lucro acumulado': pt.cumulative,
    }));
    download(`fluxo-${period.from}-${period.to}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">
            {db.settings.businessName} · {shortDate(period.from)} – {shortDate(period.to)} · valores em {cur}
          </p>
          {refreshed && (
            <p className={`small ${refreshed.ok ? 'muted' : 'form-error'}`} style={{ margin: '4px 0 0' }} role="status">
              Atualizado às {refreshed.at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {refreshed.message}
            </p>
          )}
        </div>
        <div className="head-actions">
          <FilterBar inline />
          <RefreshButton onResult={setRefreshed} />
          <button onClick={exportCsv} disabled={empty}>
            <Icon name="upload" size={15} /> Exportar
          </button>
          <details className="menu">
            <summary className="btn primary">
              <Icon name="plus" size={15} /> Novo lançamento
            </summary>
            <div className="menu-list" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open')}>
              <Link to="/receitas">Receita / venda</Link>
              <Link to="/trafego">Gasto com tráfego</Link>
              <Link to="/despesas">Despesa</Link>
              <Link to="/caixa">Aporte / retirada</Link>
              <Link to="/produtos">Produto / oferta</Link>
            </div>
          </details>
        </div>
      </div>
      <FilterNote />

      {empty && (
        <div className="callout mb">
          <h2>Bem-vindo à CADIGITAL</h2>
          <p>
            Cadastre suas <Link to="/produtos">ofertas</Link>, depois lance <Link to="/receitas">receitas</Link>,{' '}
            <Link to="/trafego">tráfego</Link> e <Link to="/despesas">despesas</Link>. Já tem um backup? Restaure em{' '}
            <Link to="/configuracoes">Configurações</Link>.
          </p>
          <Link to="/produtos" className="btn primary">
            <Icon name="plus" size={15} /> Cadastrar primeira oferta
          </Link>
        </div>
      )}

      <div className="grid hero-row">
        <HeroKpi
          label="Faturamento bruto"
          icon="cash"
          color="var(--series-1)"
          value={m(t.gross)}
          fill={t.gross ? t.net / t.gross : 0}
          fillLabel={`${pct(t.gross ? t.net / t.gross : null, 0)} vira líquido`}
          current={t.gross}
          previous={p.gross}
          title="Barra: parte do faturamento que sobra após taxas e reembolsos"
        />
        <HeroKpi
          label="Custos totais"
          icon="trend"
          color="var(--series-2)"
          value={m(costs)}
          fill={t.gross ? costs / t.gross : 0}
          fillLabel={`consome ${pct(t.gross ? costs / t.gross : null, 0)} do bruto`}
          current={costs}
          previous={prevCosts}
          inverse
          title="Taxas + reembolsos + ads + despesas + impostos. Barra: quanto do faturamento os custos consomem"
        />
        <HeroKpi
          label="Lucro líquido"
          icon="coins"
          color="var(--series-3)"
          value={m(t.profit)}
          negative={t.profit < 0}
          fill={t.margin ?? 0}
          fillLabel={`margem ${pct(t.margin, 0)}`}
          current={t.profit}
          previous={p.profit}
          title="Receita líquida − ads − despesas − impostos. Barra: margem líquida"
        />
        <HeroKpi
          label="Caixa estimado"
          icon="wallet"
          color="var(--series-5)"
          value={m(capital.cash)}
          negative={capital.cash < 0}
          fill={generated ? capital.cash / generated : 0}
          fillLabel={`${pct(generated ? capital.cash / generated : null, 0)} do gerado`}
          current={capital.cash}
          previous={data.prevCapital.cash}
          title="Aportes + lucro acumulado − retiradas − investimentos. Barra: quanto do capital gerado continua em caixa"
        />
      </div>

      <div className="grid mini-row">
        <MiniKpi label="ROAS" value={ratio(t.roas)} current={t.roas} previous={p.roas} title="Faturamento bruto ÷ ads" />
        <MiniKpi label="ROI" value={pct(t.roi)} current={t.roi} previous={p.roi} title="Lucro ÷ (ads + despesas)" />
        <MiniKpi label="CPA" value={t.cpa === null ? '—' : m(t.cpa)} current={t.cpa} previous={p.cpa} inverse title="Ads ÷ nº de vendas" />
        <MiniKpi label="Vendas" value={num(t.units)} current={t.units} previous={p.units} />
        <MiniKpi label="Ticket médio" value={t.aov === null ? '—' : m(t.aov)} current={t.aov} previous={p.aov} />
        <MiniKpi label="Investimento em ads" value={m(t.ads)} current={t.ads} previous={p.ads} inverse />
        <MiniKpi label="Receita líquida" value={m(t.net)} current={t.net} previous={p.net} title="Bruto − taxas − reembolsos" />
        <MiniKpi label="Taxa de reembolso" value={pct(t.refundRate)} current={t.refundRate} previous={p.refundRate} inverse />
      </div>

      <div className="grid cols-flow mb">
        <div className="card">
          <div className="card-head">
            <div className="card-title">
              <span className="icon-box">
                <Icon name="flow" size={17} />
              </span>
              <h2>Fluxo financeiro</h2>
            </div>
            <div className="segmented" role="tablist" aria-label="Intervalo">
              {RANGES.map((r) => (
                <button key={r.key} role="tab" aria-selected={period.preset === r.key} className={period.preset === r.key ? 'on' : ''} onClick={() => setPreset(r.key)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <FlowChart {...data.flow} currency={cur} />
        </div>
        <div className="card">
          <div className="card-head">
            <div className="card-title">
              <span className="icon-box">
                <Icon name="pie" size={17} />
              </span>
              <h2>Composição dos custos</h2>
            </div>
          </div>
          <DonutChart
            currency={cur}
            total={costs}
            change={prevCosts ? (costs - prevCosts) / prevCosts : null}
            slices={[
              { name: 'Tráfego', value: t.ads, color: 'var(--series-1)' },
              { name: 'Despesas', value: t.expenses, color: 'var(--series-2)' },
              { name: 'Taxas', value: t.fees, color: 'var(--series-3)' },
              { name: 'Reembolsos', value: t.refunds, color: 'var(--series-4)' },
              { name: 'Impostos', value: t.tax, color: 'var(--series-5)' },
            ]}
          />
        </div>
      </div>

      <div className="mb">
        <Transactions db={db} filter={f} currency={cur} />
      </div>

      <div className="card mb">
        <div className="card-head">
          <div className="card-title">
            <span className="icon-box">
              <Icon name="products" size={17} />
            </span>
            <h2>Desempenho por produto</h2>
          </div>
          <Link to="/relatorios" className="small">
            Ver relatórios →
          </Link>
        </div>
        <div className="table-wrap framed">
          <BreakdownTable
            rows={data.byProduct}
            dim="productId"
            currency={cur}
            nameOf={productName}
            targetCpa={(id) => db.products.find((x) => x.id === id)?.targetCpa || undefined}
          />
        </div>
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
          <h2>Por país</h2>
          <BreakdownTable rows={data.byCountry} dim="country" currency={cur} limit={7} compact />
        </div>
      </div>

      <div className="grid cols-2">
        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <h2>Investimento por fonte de tráfego</h2>
            <BreakdownTable rows={data.bySource} dim="source" currency={cur} />
          </div>
          <div className="card">
            <h2>Caixa & capital</h2>
            <table>
              <tbody>
                <tr><td>Aportes no período</td><td className="num pos">{m(capital.aportes)}</td></tr>
                <tr><td>Retiradas no período</td><td className="num neg">{m(capital.retiradas)}</td></tr>
                <tr><td>Investimentos no período</td><td className="num neg">{m(capital.investimentos)}</td></tr>
                <tr><td>Lucro acumulado (total)</td><td className="num">{m(capital.accumulatedProfit)}</td></tr>
              </tbody>
              <tfoot>
                <tr><td>Caixa estimado em {shortDate(period.to)}</td><td className={`num ${capital.cash < 0 ? 'neg' : ''}`}>{m(capital.cash)}</td></tr>
              </tfoot>
            </table>
          </div>
        </div>
        <div className="card">
          <h2>Despesas por categoria</h2>
          {data.categories.length ? (
            <table>
              <tbody>
                {data.categories.map((c) => (
                  <tr key={c.category}>
                    <td>{c.category}</td>
                    <td style={{ width: '35%' }}>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(c.amount / totalCat) * 100}%`, background: 'var(--series-2)' }} />
                      </div>
                    </td>
                    <td className="num muted">{pct(c.amount / totalCat, 0)}</td>
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
