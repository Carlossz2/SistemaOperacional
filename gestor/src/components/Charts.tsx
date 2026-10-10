import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SeriesPoint } from '../lib/metrics';
import { money, monthLabel, shortDate } from '../lib/format';

// Cores por papel (tokens CSS), nunca hex solto: claro/escuro trocam num só lugar.
const C = {
  s1: 'var(--series-1)',
  s2: 'var(--series-2)',
  pos: 'var(--pos)',
  neg: 'var(--neg)',
  grid: 'var(--grid)',
  axis: 'var(--axis)',
  surface: 'var(--surface)',
};

interface Props {
  points: SeriesPoint[];
  granularity: 'day' | 'month';
  currency: string;
}

const label = (key: string, g: 'day' | 'month') => (g === 'day' ? shortDate(key).slice(0, 5) : monthLabel(key));

function axes(p: Props) {
  return [
    <CartesianGrid key="g" vertical={false} stroke={C.grid} />,
    <XAxis
      key="x"
      dataKey="key"
      tickFormatter={(k: string) => label(k, p.granularity)}
      tickLine={false}
      axisLine={{ stroke: C.axis }}
      minTickGap={18}
    />,
    <YAxis key="y" tickFormatter={(v: number) => money(v, p.currency, true)} tickLine={false} axisLine={false} width={72} />,
  ];
}

function Tip({
  active,
  payload,
  rows,
  p,
}: {
  active?: boolean;
  payload?: { payload: SeriesPoint }[];
  rows: { key: keyof SeriesPoint; label: string; color: string }[];
  p: Props;
}) {
  if (!active || !payload?.length) return null;
  const pt = payload[0].payload;
  return (
    <div className="tt">
      <div className="tt-title">{p.granularity === 'day' ? shortDate(pt.key) : monthLabel(pt.key)}</div>
      {rows.map((r) => (
        <div className="tt-row" key={r.key}>
          <span>
            <i className="swatch" style={{ background: r.color }} />
            {r.label}
          </span>
          <b>{money(pt[r.key] as number, p.currency)}</b>
        </div>
      ))}
    </div>
  );
}

/** Lucro por dia/mês: polaridade => azul (lucro) / vermelho (prejuízo), linha zero marcada. */
export function ProfitChart(p: Props) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={p.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        {axes(p)}
        <ReferenceLine y={0} stroke={C.axis} />
        <Tooltip
          cursor={{ fill: 'var(--surface-2)' }}
          content={(t) => (
            <Tip
              {...(t as object)}
              p={p}
              rows={[
                { key: 'net', label: 'Receita líquida', color: C.s1 },
                { key: 'ads', label: 'Ads', color: C.s2 },
                { key: 'expenses', label: 'Despesas', color: 'var(--muted)' },
                { key: 'tax', label: 'Impostos', color: 'var(--muted)' },
                { key: 'profit', label: 'Lucro', color: C.pos },
              ]}
            />
          )}
        />
        <Bar dataKey="profit" radius={[4, 4, 0, 0]} maxBarSize={28}>
          {p.points.map((pt) => (
            <Cell key={pt.key} fill={pt.profit >= 0 ? C.pos : C.neg} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Receita líquida × investimento em ads — mesma unidade, um único eixo. */
export function RevenueVsAdsChart(p: Props) {
  return (
    <>
      <div className="legend" style={{ marginBottom: 6 }}>
        <span>
          <i className="swatch" style={{ background: C.s1 }} />
          Receita líquida
        </span>
        <span>
          <i className="swatch" style={{ background: C.s2 }} />
          Investimento em ads
        </span>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={p.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          {axes(p)}
          <Tooltip
            cursor={{ stroke: C.axis }}
            content={(t) => (
              <Tip
                {...(t as object)}
                p={p}
                rows={[
                  { key: 'net', label: 'Receita líquida', color: C.s1 },
                  { key: 'ads', label: 'Ads', color: C.s2 },
                ]}
              />
            )}
          />
          <Line type="monotone" dataKey="net" stroke={C.s1} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: C.surface, strokeWidth: 2 }} />
          <Line type="monotone" dataKey="ads" stroke={C.s2} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: C.surface, strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </>
  );
}

export function CumulativeChart(p: Props) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={p.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        {axes(p)}
        <ReferenceLine y={0} stroke={C.axis} />
        <Tooltip
          cursor={{ stroke: C.axis }}
          content={(t) => <Tip {...(t as object)} p={p} rows={[{ key: 'cumulative', label: 'Lucro acumulado', color: C.s1 }]} />}
        />
        <Area type="monotone" dataKey="cumulative" stroke={C.s1} strokeWidth={2} fill={C.s1} fillOpacity={0.12} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
