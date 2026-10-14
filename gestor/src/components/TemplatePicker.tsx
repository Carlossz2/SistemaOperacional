import { useState } from 'react';
import type { DashboardTemplate } from '../lib/types';
import { Icon } from './Icon';

// Templates prontos do Dashboard: mesmos números, visual diferente. A escolha fica salva nas configurações (sincroniza na nuvem).

const TEMPLATES: { key: DashboardTemplate; name: string; desc: string }[] = [
  { key: 'default', name: 'Padrão', desc: 'Cartões grandes, fluxo financeiro, composição dos custos e lucro por período.' },
  { key: 'market', name: 'Mercado financeiro', desc: 'Terminal de trading: letreiro de indicadores, velas do lucro acumulado, volume, livro do período e mapa de calor.' },
];

export function TemplatePicker({ value, onChange }: { value: DashboardTemplate; onChange: (t: DashboardTemplate) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name="layout" size={15} /> Templates
      </button>
      {open && (
        <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal modal-wide" role="dialog" aria-label="Templates do Dashboard">
            <div className="modal-head">
              <div>
                <h2 style={{ margin: 0 }}>Templates do Dashboard</h2>
                <p className="muted small" style={{ margin: '4px 0 0' }}>Os números são os mesmos; muda só o visual. Dá para trocar a qualquer momento.</p>
              </div>
              <button type="button" className="ghost" onClick={() => setOpen(false)} aria-label="Fechar">
                <Icon name="close" />
              </button>
            </div>
            <div className="tpl-grid">
              {TEMPLATES.map((x) => (
                <button
                  key={x.key}
                  type="button"
                  className={`tpl-card ${value === x.key ? 'on' : ''}`}
                  aria-pressed={value === x.key}
                  onClick={() => {
                    onChange(x.key);
                    setOpen(false);
                  }}
                >
                  <Preview kind={x.key} />
                  <span className="tpl-name">
                    {x.name} {value === x.key && <span className="pill">em uso</span>}
                  </span>
                  <span className="muted small">{x.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Miniatura desenhada (sem imagem): dá a ideia do layout de cada template. */
function Preview({ kind }: { kind: DashboardTemplate }) {
  if (kind === 'market') {
    const candles = [5, -3, 6, 4, -5, 7, 3, -2, 6, 8, -4, 5, 7];
    let level = 0;
    return (
      <svg className="tpl-preview market" viewBox="0 0 200 110" aria-hidden="true">
        <rect width="200" height="110" fill="#06090d" />
        <rect y="0" width="200" height="9" fill="#0d131a" />
        {[6, 46, 86, 126, 166].map((x, i) => (
          <rect key={x} x={x} y="3" width="28" height="3" rx="1" fill={i % 3 === 1 ? '#ea3943' : '#16c784'} opacity=".8" />
        ))}
        <rect x="6" y="14" width="124" height="90" rx="3" fill="#0b1016" />
        {candles.map((d, i) => {
          const open = level;
          level += d;
          const top = 82 - Math.max(open, level) * 1.4;
          const h = Math.max(2, Math.abs(d) * 1.4);
          const x = 12 + i * 9;
          return (
            <g key={i}>
              <line x1={x + 2.5} x2={x + 2.5} y1={top - 4} y2={top + h + 4} stroke={d > 0 ? '#16c784' : '#ea3943'} strokeWidth=".8" />
              <rect x={x} y={top} width="5" height={h} fill={d > 0 ? '#16c784' : '#ea3943'} />
            </g>
          );
        })}
        {candles.map((d, i) => (
          <rect key={'v' + i} x={12 + i * 9} y={100 - Math.abs(d)} width="5" height={Math.abs(d)} fill={d > 0 ? '#16c78466' : '#ea394366'} />
        ))}
        <rect x="134" y="14" width="60" height="44" rx="3" fill="#0b1016" />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x="134" y={18 + i * 8} width={50 - i * 9} height="5" fill={i < 2 ? '#16c78455' : '#ea394355'} />
        ))}
        <rect x="134" y="62" width="60" height="42" rx="3" fill="#0b1016" />
        <rect x="137" y="65" width="30" height="20" fill="#16c784aa" />
        <rect x="168" y="65" width="23" height="20" fill="#16c78466" />
        <rect x="137" y="86" width="20" height="15" fill="#ea3943aa" />
        <rect x="158" y="86" width="33" height="15" fill="#16c78444" />
      </svg>
    );
  }
  return (
    <svg className="tpl-preview" viewBox="0 0 200 110" aria-hidden="true">
      <rect width="200" height="110" fill="var(--page)" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x={6 + i * 48} y="6" width="44" height="26" rx="4" fill="var(--surface-2)" />
          <rect x={10 + i * 48} y="24" width="34" height="3" rx="1.5" fill={['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-5)'][i]} />
        </g>
      ))}
      <rect x="6" y="38" width="124" height="38" rx="4" fill="var(--surface-2)" />
      <path d="M10 68 L30 60 L50 63 L70 52 L90 55 L110 46 L126 48 L126 72 L10 72 Z" fill="var(--series-1)" opacity=".35" />
      <rect x="136" y="38" width="58" height="38" rx="4" fill="var(--surface-2)" />
      <circle cx="165" cy="57" r="12" fill="none" stroke="var(--series-2)" strokeWidth="5" strokeDasharray="40 36" />
      <rect x="6" y="82" width="188" height="22" rx="4" fill="var(--surface-2)" />
      {Array.from({ length: 16 }, (_, i) => (
        <rect key={i} x={12 + i * 11} y={i % 4 === 2 ? 93 : 88 - (i % 3) * 2} width="6" height={i % 4 === 2 ? 6 : 8 + (i % 3) * 2} fill={i % 4 === 2 ? 'var(--neg)' : 'var(--pos)'} />
      ))}
    </svg>
  );
}
