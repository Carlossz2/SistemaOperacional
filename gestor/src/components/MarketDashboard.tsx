import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Database } from '../lib/types';
import type { Period } from '../lib/dates';
import { breakdown, timeSeries, type Filter, type Totals } from '../lib/metrics';
import { candleGroup, candles, type Candle } from '../lib/market';
import { money, monthLabel, num, pct, ratio, shortDate } from '../lib/format';

// Template "Mercado financeiro": o Dashboard como um terminal de trading.
// Mesmos números do template padrão, só a apresentação muda.

interface Props {
  db: Database;
  f: Filter;
  period: Period;
  t: Totals;
  p: Totals;
  cash: number | null;
  prevCash: number | null;
  currency: string;
}

const pctChange = (cur: number | null, prev: number | null) => (cur === null || prev === null || prev === 0 ? null : (cur - prev) / Math.abs(prev));
const fmtChange = (c: number | null) => (c === null ? '—' : `${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
/** up/down = cor; para custos (inverse) subir é ruim */
const tone = (c: number | null, inverse = false) => (c === null || Math.abs(c) < 0.0005 ? 'flat' : (c > 0) !== inverse ? 'up' : 'down');
const arrow = (c: number | null) => (c === null || Math.abs(c) < 0.0005 ? '■' : c > 0 ? '▲' : '▼');

export function MarketDashboard({ db, f, period, t, p, cash, prevCash, currency }: Props) {
  // "Todo o período" não tem período anterior para comparar
  const cmp = period.preset !== 'all';
  const change = (cur: number | null, prev: number | null) => (cmp ? pctChange(cur, prev) : null);
  const m = (v: number) => money(v, currency);
  const mc = (v: number) => money(v, currency, true);
  const group = candleGroup(f.from, f.to);
  const bars = useMemo(() => candles(timeSeries(db, f, Number.POSITIVE_INFINITY).points, group), [db, f, group]);
  const products = useMemo(() => {
    const name = new Map(db.products.map((x) => [x.id, x.name]));
    return breakdown(db, f, 'productId')
      .filter((r) => r.gross > 0 || r.ads > 0)
      .sort((a, b) => b.gross + b.ads - (a.gross + a.ads))
      .slice(0, 12)
      .map((r) => ({ ...r, name: name.get(r.key) ?? 'Sem produto' }));
  }, [db, f]);

  const high = Math.max(0, ...bars.map((b) => b.high));
  const low = Math.min(0, ...bars.map((b) => b.low));
  const profitChange = change(t.profit, p.profit);
  const costs = t.fees + t.refunds + t.ads + t.expenses + t.tax;
  const prevCosts = p.fees + p.refunds + p.ads + p.expenses + p.tax;

  const ticker: { sym: string; label: string; value: string; c: number | null; inverse?: boolean }[] = [
    { sym: 'FAT', label: 'Faturamento bruto', value: mc(t.gross), c: change(t.gross, p.gross) },
    { sym: 'LCR', label: 'Lucro líquido', value: mc(t.profit), c: profitChange },
    { sym: 'ROAS', label: 'ROAS', value: ratio(t.roas), c: change(t.roas, p.roas) },
    { sym: 'ROI', label: 'ROI', value: pct(t.roi), c: change(t.roi, p.roi) },
    { sym: 'CPA', label: 'CPA', value: t.cpa === null ? '—' : mc(t.cpa), c: change(t.cpa, p.cpa), inverse: true },
    { sym: 'VND', label: 'Vendas', value: num(t.units), c: change(t.units, p.units) },
    { sym: 'TKT', label: 'Ticket médio', value: t.aov === null ? '—' : mc(t.aov), c: change(t.aov, p.aov) },
    { sym: 'ADS', label: 'Investimento em ads', value: mc(t.ads), c: change(t.ads, p.ads), inverse: true },
    { sym: 'MRG', label: 'Margem líquida', value: pct(t.margin), c: change(t.margin, p.margin) },
    { sym: 'CXA', label: 'Caixa', value: cash === null ? '—' : mc(cash), c: change(cash, prevCash) },
  ];

  return (
    <div className="tpl-market" data-testid="market-template">
      <TerminalBar business={db.settings.businessName} period={period} currency={currency} />

      <div className="mk-tape" aria-label="Indicadores do período">
        <div className="mk-tape-track">
          {[0, 1].map((copy) => (
            <div className="mk-tape-set" key={copy} aria-hidden={copy === 1}>
              {ticker.map((x) => (
                <span className="mk-tick" key={x.sym} title={`${x.label} · variação vs. período anterior`}>
                  <b>{x.sym}</b> <span className="mk-num">{x.value}</span>{' '}
                  <span className={`mk-chg ${tone(x.c, x.inverse)}`}>
                    {arrow(x.c)} {fmtChange(x.c)}
                  </span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="mk-grid">
        <section className="mk-panel mk-chart">
          <div className="mk-quote">
            <div>
              <div className="mk-label">LUCRO LÍQUIDO · {db.settings.businessName.toUpperCase()}</div>
              <div className={`mk-price ${t.profit < 0 ? 'down' : 'up'}`}>{m(t.profit)}</div>
              {cmp ? (
                <div className={`mk-chg ${tone(profitChange)}`}>
                  {arrow(profitChange)} {t.profit - p.profit >= 0 ? '+' : '−'}
                  {m(Math.abs(t.profit - p.profit))} ({fmtChange(profitChange)}) <span className="mk-dim">vs. período anterior</span>
                </div>
              ) : (
                <div className="mk-chg mk-dim">Todo o período · sem comparação</div>
              )}
            </div>
            <dl className="mk-stats">
              <div><dt>Máxima</dt><dd className="mk-num">{mc(high)}</dd></div>
              <div><dt>Mínima</dt><dd className="mk-num">{mc(low)}</dd></div>
              <div><dt>Volume (bruto)</dt><dd className="mk-num">{mc(t.gross)}</dd></div>
              <div><dt>Margem</dt><dd className="mk-num">{pct(t.margin)}</dd></div>
            </dl>
          </div>
          <div className="mk-legend">
            <span><i className="mk-sw up" />Vela de alta (lucro)</span>
            <span><i className="mk-sw down" />Vela de baixa (prejuízo)</span>
            <span><i className="mk-sw ma" />Média móvel (7)</span>
            <span className="mk-dim">Cada vela = 1 {group === 'day' ? 'dia' : group === 'week' ? 'semana' : 'mês'} do lucro acumulado</span>
          </div>
          <CandleChart bars={bars} group={group} currency={currency} />
          <VolumeChart bars={bars} group={group} currency={currency} />
        </section>

        <section className="mk-panel mk-book">
          <h2 className="mk-title">Livro do período</h2>
          <Book
            currency={currency}
            gross={t.gross}
            rows={[
              { side: 'in', label: 'Faturamento bruto', value: t.gross },
              { side: 'in', label: 'Receita líquida', value: t.net },
              { side: 'out', label: 'Tráfego pago', value: t.ads },
              { side: 'out', label: 'Despesas', value: t.expenses },
              { side: 'out', label: 'Taxas das plataformas', value: t.fees },
              { side: 'out', label: 'Reembolsos', value: t.refunds },
              { side: 'out', label: 'Imposto da Meta', value: t.adTax },
              { side: 'out', label: 'Imposto do CNPJ', value: t.taxCompany },
            ]}
          />
          <div className="mk-spread">
            <span>Custos totais</span>
            <span className="mk-num down">{m(costs)}</span>
          </div>
          <div className="mk-spread">
            <span>Resultado</span>
            <span className={`mk-num ${t.profit < 0 ? 'down' : 'up'}`}>{m(t.profit)}</span>
          </div>
          <p className="mk-note">
            <span className="mk-dim">Custos vs. período anterior: </span>
            <span className={`mk-num mk-chg ${tone(change(costs, prevCosts), true)}`}>
              {arrow(change(costs, prevCosts))} {fmtChange(change(costs, prevCosts))}
            </span>
          </p>
        </section>

        <section className="mk-panel mk-watch">
          <h2 className="mk-title">Painel de indicadores</h2>
          <table className="mk-table">
            <thead>
              <tr>
                <th>Indicador</th>
                <th className="num">Atual</th>
                <th className="num">Anterior</th>
                <th className="num">Var.</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'ROAS', cur: t.roas, prev: p.roas, fmt: (v: number) => ratio(v) },
                { label: 'ROI', cur: t.roi, prev: p.roi, fmt: (v: number) => pct(v) },
                { label: 'CPA', cur: t.cpa, prev: p.cpa, fmt: mc, inverse: true },
                { label: 'Vendas', cur: t.units, prev: p.units, fmt: (v: number) => num(v) },
                { label: 'Ticket médio', cur: t.aov, prev: p.aov, fmt: mc },
                { label: 'Margem líquida', cur: t.margin, prev: p.margin, fmt: (v: number) => pct(v) },
                { label: 'Taxa de reembolso', cur: t.refundRate, prev: p.refundRate, fmt: (v: number) => pct(v), inverse: true },
                { label: 'Investimento em ads', cur: t.ads, prev: p.ads, fmt: mc, inverse: true },
                { label: 'Imposto da Meta', cur: t.adTax, prev: p.adTax, fmt: mc, inverse: true },
                { label: 'Imposto do CNPJ', cur: t.taxCompany, prev: p.taxCompany, fmt: mc, inverse: true },
                { label: 'Caixa', cur: cash, prev: prevCash, fmt: mc },
              ].map((r) => {
                const c = change(r.cur, r.prev);
                return (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td className="num mk-num">{r.cur === null ? '—' : r.fmt(r.cur)}</td>
                    <td className="num mk-num mk-dim">{!cmp || r.prev === null ? '—' : r.fmt(r.prev)}</td>
                    <td className={`num mk-num mk-chg ${tone(c, r.inverse)}`}>
                      {arrow(c)} {fmtChange(c)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="mk-panel mk-heat">
          <h2 className="mk-title">Mapa de calor · produtos</h2>
          {!products.length ? (
            <p className="mk-dim">Sem vendas ou gastos no período.</p>
          ) : (
            <div className="mk-tiles">
              {products.map((r) => {
                const roi = r.roi ?? (r.profit >= 0 ? 0 : -1);
                const strength = Math.round(18 + Math.min(1, Math.abs(roi)) * 62);
                return (
                  <div
                    key={r.key || 'none'}
                    className={`mk-tile ${r.profit < 0 ? 'down' : 'up'}`}
                    style={{ flexGrow: Math.max(1, r.gross + r.ads), ['--k' as string]: `${strength}%` }}
                    title={`${r.name}: bruto ${m(r.gross)} · ads ${m(r.ads)} · lucro ${m(r.profit)} · ROI ${pct(r.roi)}`}
                  >
                    <b>{r.name}</b>
                    <span className="mk-num">{mc(r.profit)}</span>
                    <span className="mk-num">ROI {pct(r.roi, 0)}</span>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mk-dim mk-note">Tamanho = movimento (faturamento + ads). Cor = lucro ou prejuízo; mais forte = ROI maior.</p>
        </section>
      </div>
    </div>
  );
}

function TerminalBar({ business, period, currency }: { business: string; period: Period; currency: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="mk-bar">
      <span className="mk-brand">
        {business.toUpperCase()} <span className="mk-dim">▸ TERMINAL</span>
      </span>
      <span className="mk-live">
        <i /> AO VIVO
      </span>
      <span className="mk-dim mk-num">
        {shortDate(period.from)} – {shortDate(period.to)} · {currency} · {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  );
}

/** Rótulo do eixo a partir da chave da vela (dia, segunda-feira da semana ou AAAA-MM). */
const tick = (key: string, g: 'day' | 'week' | 'month') => (g === 'month' ? monthLabel(key) : shortDate(key).slice(0, 5));

/** Vela: pavio do mínimo ao máximo e corpo da abertura ao fechamento. */
function CandleShape(props: { x?: number; y?: number; width?: number; height?: number; payload?: Candle }) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  if (!payload) return null;
  const top = Math.min(y, y + height);
  const h = Math.abs(height);
  const span = payload.high - payload.low;
  const k = span ? h / span : 0;
  const bodyTop = top + (payload.high - Math.max(payload.open, payload.close)) * k;
  const bodyH = Math.max(1.5, Math.abs(payload.close - payload.open) * k);
  const cx = x + width / 2;
  const color = payload.up ? 'var(--mk-up)' : 'var(--mk-down)';
  const w = Math.max(2, Math.min(width, 18));
  return (
    <g>
      <line x1={cx} x2={cx} y1={top} y2={top + Math.max(h, 1.5)} stroke={color} strokeWidth={1} />
      <rect x={cx - w / 2} y={bodyTop} width={w} height={bodyH} fill={color} rx={1} />
    </g>
  );
}

function CandleTip({ active, payload, currency, group }: { active?: boolean; payload?: { payload: Candle }[]; currency: string; group: 'day' | 'week' | 'month' }) {
  if (!active || !payload?.length) return null;
  const c = payload[0].payload;
  const m = (v: number) => money(v, currency);
  return (
    <div className="mk-tt">
      <div className="mk-dim">{group === 'month' ? monthLabel(c.key) : c.from === c.to ? shortDate(c.from) : `${shortDate(c.from)} – ${shortDate(c.to)}`}</div>
      <div className={`mk-num ${c.up ? 'up' : 'down'}`} style={{ fontSize: 15, fontWeight: 700 }}>
        {c.profit >= 0 ? '+' : ''}
        {m(c.profit)}
      </div>
      <dl>
        <dt>Abertura</dt><dd>{m(c.open)}</dd>
        <dt>Máxima</dt><dd>{m(c.high)}</dd>
        <dt>Mínima</dt><dd>{m(c.low)}</dd>
        <dt>Fechamento</dt><dd>{m(c.close)}</dd>
        <dt>Volume (bruto)</dt><dd>{m(c.volume)}</dd>
      </dl>
    </div>
  );
}

function CandleChart({ bars, group, currency }: { bars: Candle[]; group: 'day' | 'week' | 'month'; currency: string }) {
  if (!bars.length) return <div className="mk-empty">Sem dados no período.</div>;
  return (
    <div className="mk-candles" role="img" aria-label="Gráfico de velas do lucro acumulado">
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={bars} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
          <CartesianGrid stroke="var(--mk-grid)" strokeDasharray="2 4" />
          <XAxis dataKey="key" tickFormatter={(k: string) => tick(k, group)} tickLine={false} axisLine={false} minTickGap={28} dy={6} hide />
          <YAxis orientation="right" tickFormatter={(v: number) => money(v, currency, true)} tickLine={false} axisLine={false} width={76} domain={['auto', 'auto']} />
          <ReferenceLine y={0} stroke="var(--mk-dim)" strokeDasharray="4 4" />
          <Tooltip content={<CandleTip currency={currency} group={group} />} cursor={{ stroke: 'var(--mk-dim)', strokeDasharray: '3 3' }} isAnimationActive={false} />
          <Bar dataKey="range" shape={<CandleShape />} isAnimationActive={false} />
          <Line dataKey="ma" stroke="var(--mk-accent)" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function VolumeChart({ bars, group, currency }: { bars: Candle[]; group: 'day' | 'week' | 'month'; currency: string }) {
  if (!bars.length) return null;
  return (
    <ResponsiveContainer width="100%" height={86}>
      <BarChart data={bars} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
        <XAxis dataKey="key" tickFormatter={(k: string) => tick(k, group)} tickLine={false} axisLine={false} minTickGap={28} dy={4} />
        <YAxis orientation="right" tickFormatter={(v: number) => money(v, currency, true)} tickLine={false} axisLine={false} width={76} tickCount={2} />
        <Tooltip content={<CandleTip currency={currency} group={group} />} cursor={{ fill: 'var(--mk-grid)' }} isAnimationActive={false} />
        <Bar dataKey="volume" isAnimationActive={false}>
          {bars.map((b) => (
            <Cell key={b.key} fill={b.up ? 'var(--mk-up-soft)' : 'var(--mk-down-soft)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function Book({ rows, gross, currency }: { rows: { side: 'in' | 'out'; label: string; value: number }[]; gross: number; currency: string }) {
  return (
    <table className="mk-table mk-booktable">
      <tbody>
        {rows.map((r) => {
          const share = gross ? Math.min(1, r.value / gross) : 0;
          return (
            <tr key={r.label} className={r.side === 'in' ? 'up' : 'down'}>
              <td style={{ ['--w' as string]: `${share * 100}%` }} className="mk-depth">
                {r.side === 'in' ? '▲' : '▼'} {r.label}
              </td>
              <td className="num mk-num">{money(r.value, currency)}</td>
              <td className="num mk-num mk-dim">{gross ? pct(r.value / gross, 0) : '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
