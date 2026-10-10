import type { CSSProperties, ReactNode } from 'react';
import { Icon } from './Icon';

/** Variação vs. período anterior. `inverse`: subir é ruim (custos, CPA, reembolso). */
export function Delta({ current, previous, inverse }: { current: number | null; previous: number | null; inverse?: boolean }) {
  if (current === null || previous === null || previous === 0) return <span className="delta flat">sem comparação</span>;
  const change = (current - previous) / Math.abs(previous);
  const up = change > 0.0005;
  const down = change < -0.0005;
  if (!up && !down) return <span className="delta flat">estável</span>;
  const good = inverse ? down : up;
  return (
    <span className={`delta ${good ? 'up' : 'down'}`} title="Variação vs. período anterior de mesma duração">
      <b>{up ? '↑' : '↓'} {up ? '+' : '−'}{Math.abs(change * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</b>
      <span className="muted">vs. anterior</span>
    </span>
  );
}

const TICKS = 48;

interface HeroProps {
  label: string;
  value: string;
  icon: string;
  /** Cor do cartão (variável CSS de série) */
  color: string;
  /** Fração 0–1 mostrada na barra segmentada */
  fill: number;
  /** O que a barra representa, ex.: "88% vira receita líquida" */
  fillLabel: string;
  current: number | null;
  previous: number | null;
  inverse?: boolean;
  negative?: boolean;
  title?: string;
}

/** Cartão principal: valor grande, barra segmentada com significado e variação. */
export function HeroKpi(p: HeroProps) {
  const on = Math.round(Math.max(0, Math.min(1, p.fill)) * TICKS);
  return (
    <div className="card hero" style={{ '--c': p.color } as CSSProperties} title={p.title}>
      <div className="hero-top">
        <span className="hero-label">{p.label}</span>
        <span className="icon-box">
          <Icon name={p.icon} size={17} />
        </span>
      </div>
      <div className={`hero-value ${p.negative ? 'neg' : ''}`}>{p.value}</div>
      <div className="ticks" role="img" aria-label={p.fillLabel}>
        {Array.from({ length: TICKS }, (_, i) => (
          <i key={i} className={i < on ? 'on' : ''} />
        ))}
      </div>
      <div className="hero-foot">
        <Delta current={p.current} previous={p.previous} inverse={p.inverse} />
        <span className="share">{p.fillLabel}</span>
      </div>
    </div>
  );
}

interface MiniProps {
  label: string;
  value: string;
  current: number | null;
  previous: number | null;
  inverse?: boolean;
  negative?: boolean;
  title?: string;
  extra?: ReactNode;
}

export function MiniKpi(p: MiniProps) {
  return (
    <div className="card mini" title={p.title}>
      <div className="mini-label">{p.label}</div>
      <div className={`mini-value ${p.negative ? 'neg' : ''}`}>{p.value}</div>
      {p.extra ?? <Delta current={p.current} previous={p.previous} inverse={p.inverse} />}
    </div>
  );
}
