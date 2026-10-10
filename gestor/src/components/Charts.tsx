import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SeriesPoint } from '../lib/metrics';
import { money, monthLabel, pct, shortDate } from '../lib/format';

// Cores por papel (tokens CSS), nunca hex solto: claro/escuro trocam num só lugar.
const C = {
  rev: 'var(--series-1)',
  cost: 'var(--series-2)',
  pos: 'var(--pos)',
  neg: 'var(--neg)',
  grid: 'var(--grid)',
  surface: 'var(--surface)',
  cursor: 'var(--axis)',
};

interface Props {
  points: SeriesPoint[];
  granularity: 'day' | 'month';
  currency: string;
}

const tickLabel = (key: string, g: 'day' | 'month') => (g === 'day' ? shortDate(key).slice(0, 5) : monthLabel(key));
const fullLabel = (key: string, g: 'day' | 'month') => (g === 'day' ? shortDate(key) : monthLabel(key));
const costOf = (p: SeriesPoint) => p.ads + p.expenses + p.tax;

function axes(p: Props) {
  return [
    <CartesianGrid key="g" vertical={false} stroke={C.grid} />,
    <XAxis
      key="x"
      dataKey="key"
      tickFormatter={(k: string) => (p.points.length > 120 ? monthLabel(k.slice(0, 7)) : tickLabel(k, p.granularity))}
      tickLine={false}
      axisLine={false}
      minTickGap={p.points.length > 120 ? 40 : 24}
      dy={8}
    />,
    <YAxis key="y" tickFormatter={(v: number) => money(v, p.currency, true)} tickLine={false} axisLine={false} width={74} />,
  ];
}

interface TipRow {
  label: string;
  color: string;
  value: number;
}

function TipCard({ date, big, bigLabel, rows, currency }: { date: string; big: number; bigLabel: string; rows: TipRow[]; currency: string }) {
  return (
    <div className="tt">
      <div className="tt-date">
        {date} · {bigLabel}
      </div>
      <div className={`tt-big ${big < 0 ? 'neg-text' : ''}`}>{money(big, currency)}</div>
      {rows.map((r) => (
        <div className="tt-row" key={r.label}>
          <span>
            <i className="swatch" style={{ background: r.color }} />
            {r.label}
          </span>
          <span className="pill">{money(r.value, currency, true)}</span>
        </div>
      ))}
    </div>
  );
}

/** Fluxo financeiro: receita líquida × custos (ads + despesas + impostos), mesma unidade, um eixo. */
export function FlowChart(p: Props) {
  const data = p.points.map((pt) => ({ ...pt, costs: costOf(pt) }));
  return (
    <>
      <div className="chart-area">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data} margin={{ top: 10, right: 6, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.rev} stopOpacity={0.28} />
                <stop offset="100%" stopColor={C.rev} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gCost" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.cost} stopOpacity={0.22} />
                <stop offset="100%" stopColor={C.cost} stopOpacity={0} />
              </linearGradient>
            </defs>
            {axes(p)}
            <Tooltip
              cursor={{ stroke: C.cursor, strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const pt = payload[0].payload as SeriesPoint & { costs: number };
                return (
                  <TipCard
                    date={fullLabel(pt.key, p.granularity)}
                    bigLabel="lucro"
                    big={pt.profit}
                    currency={p.currency}
                    rows={[
                      { label: 'Receita líquida', color: C.rev, value: pt.net },
                      { label: 'Custos', color: C.cost, value: pt.costs },
                    ]}
                  />
                );
              }}
            />
            <Area
              type={p.points.length > 120 ? 'linear' : 'monotone'}
              dataKey="net"
              stroke={C.rev}
              strokeWidth={p.points.length > 120 ? 1.5 : 2}
              fill="url(#gRev)"
              activeDot={{ r: 5, stroke: C.surface, strokeWidth: 2, fill: C.rev }}
            />
            <Area
              type={p.points.length > 120 ? 'linear' : 'monotone'}
              dataKey="costs"
              stroke={C.cost}
              strokeWidth={p.points.length > 120 ? 1.5 : 2}
              fill="url(#gCost)"
              activeDot={{ r: 5, stroke: C.surface, strokeWidth: 2, fill: C.cost }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="legend" style={{ marginTop: 8 }}>
        <span>
          <i className="swatch" style={{ background: C.rev }} />
          Receita líquida
        </span>
        <span>
          <i className="swatch" style={{ background: C.cost }} />
          Custos (ads + despesas + impostos)
        </span>
      </div>
    </>
  );
}

/** Lucro por dia/mês: polaridade => teal (lucro) / vermelho (prejuízo), linha zero marcada. */
export function ProfitChart(p: Props) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={p.points} margin={{ top: 8, right: 6, left: 0, bottom: 4 }}>
        {axes(p)}
        <ReferenceLine y={0} stroke={C.cursor} />
        <Tooltip
          cursor={{ fill: 'var(--surface-2)' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const pt = payload[0].payload as SeriesPoint;
            return (
              <TipCard
                date={fullLabel(pt.key, p.granularity)}
                bigLabel={pt.profit >= 0 ? 'lucro' : 'prejuízo'}
                big={pt.profit}
                currency={p.currency}
                rows={[
                  { label: 'Receita líquida', color: C.rev, value: pt.net },
                  { label: 'Ads', color: 'var(--series-2)', value: pt.ads },
                  { label: 'Despesas', color: 'var(--series-3)', value: pt.expenses },
                  { label: 'Impostos', color: 'var(--series-5)', value: pt.tax },
                ]}
              />
            );
          }}
        />
        <Bar dataKey="profit" radius={[4, 4, 4, 4]} maxBarSize={22}>
          {p.points.map((pt) => (
            <Cell key={pt.key} fill={pt.profit >= 0 ? C.pos : C.neg} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface Slice {
  name: string;
  value: number;
  color: string;
}

/** Rosca de composição de custos. Centro: total e variação vs. período anterior. */
export function DonutChart({ slices, currency, total, change }: { slices: Slice[]; currency: string; total: number; change: number | null }) {
  const [active, setActive] = useState<number | null>(null);
  const data = slices.filter((s) => s.value > 0);
  const sum = data.reduce((a, s) => a + s.value, 0) || 1;
  const hovered = active !== null ? data[active] : null;
  return (
    <>
      <div className="donut-wrap">
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="66%"
              outerRadius="94%"
              paddingAngle={2}
              cornerRadius={6}
              stroke="none"
              startAngle={90}
              endAngle={-270}
              onMouseEnter={(_, i) => setActive(i)}
              onMouseLeave={() => setActive(null)}
              isAnimationActive={false}
            >
              {data.map((s, i) => (
                <Cell key={s.name} fill={s.color} fillOpacity={active === null || active === i ? 1 : 0.35} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center">
          {hovered ? (
            <>
              <span className="pill">{hovered.name}</span>
              <div className="donut-big">{money(hovered.value, currency, true)}</div>
              <div className="donut-sub">{pct(hovered.value / sum)} dos custos</div>
            </>
          ) : (
            <>
              <span className="pill">{money(total, currency, true)}</span>
              <div className="donut-big">
                {change === null ? 'Custos' : `${pct(Math.abs(change))} ${change >= 0 ? 'maior' : 'menor'}`}
              </div>
              <div className="donut-sub">{change === null ? 'no período' : 'que o período anterior'}</div>
            </>
          )}
        </div>
      </div>
      <div className="legend center" style={{ marginTop: 6 }}>
        {slices.map((s) => (
          <span key={s.name}>
            <i className="swatch" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </>
  );
}
