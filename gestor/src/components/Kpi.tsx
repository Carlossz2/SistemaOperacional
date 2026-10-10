import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: string;
  current: number | null;
  previous: number | null;
  /** true quando subir é ruim (gasto, CPA, reembolso) */
  inverse?: boolean;
  negative?: boolean;
  hero?: boolean;
  title?: string;
  extra?: ReactNode;
}

export function Kpi(p: Props) {
  let delta: ReactNode = <span className="delta flat">sem comparação</span>;
  if (p.current !== null && p.previous !== null && p.previous !== 0) {
    const change = (p.current - p.previous) / Math.abs(p.previous);
    const up = change > 0.0005;
    const down = change < -0.0005;
    const good = p.inverse ? down : up;
    const cls = !up && !down ? 'flat' : good ? 'up' : 'down';
    const arrow = up ? '▲' : down ? '▼' : '●';
    delta = (
      <span className={`delta ${cls}`} title="Variação vs. período anterior de mesma duração">
        {arrow} {Math.abs(change * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs. anterior
      </span>
    );
  }
  return (
    <div className={`card kpi ${p.hero ? 'hero' : ''}`} title={p.title}>
      <div className="kpi-label">{p.label}</div>
      <div className={`kpi-value ${p.negative ? 'neg' : ''}`}>{p.value}</div>
      {delta}
      {p.extra}
    </div>
  );
}
