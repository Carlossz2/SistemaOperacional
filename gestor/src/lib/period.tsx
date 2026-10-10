import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { PRESETS, resolvePreset, today, type Period, type PresetKey } from './dates';
import { earliestDate } from './metrics';
import { useDb } from './store';

// Período e filtros globais (compartilhados entre Dashboard e Relatórios).
// A preferência fica salva no navegador apenas por conveniência.

interface Filters {
  period: Period;
  productId: string;
  country: string;
}

interface Ctx extends Filters {
  setPreset: (k: PresetKey) => void;
  setCustom: (from: string, to: string) => void;
  setProductId: (id: string) => void;
  setCountry: (c: string) => void;
}

const PeriodCtx = createContext<Ctx | null>(null);
const PREF = 'gestor-dr:period';

function readPref(): { preset: PresetKey; from?: string; to?: string } {
  try {
    return JSON.parse(localStorage.getItem(PREF) || '') || { preset: '30d' };
  } catch {
    return { preset: '30d' };
  }
}

export function PeriodProvider({ children }: { children: ReactNode }) {
  const db = useDb();
  const [pref, setPref] = useState(readPref);
  const [productId, setProductId] = useState('');
  const [country, setCountry] = useState('');

  const period = useMemo<Period>(() => {
    if (pref.preset === 'custom' && pref.from && pref.to) return { preset: 'custom', from: pref.from, to: pref.to };
    return resolvePreset(pref.preset, today(), earliestDate(db));
  }, [pref, db]);

  const save = (p: typeof pref) => {
    setPref(p);
    try {
      localStorage.setItem(PREF, JSON.stringify(p));
    } catch {
      /* ignora: modo privado */
    }
  };

  return (
    <PeriodCtx.Provider
      value={{
        period,
        productId,
        country,
        setPreset: (preset) => save(preset === 'custom' ? { preset, from: period.from, to: period.to } : { preset }),
        setCustom: (from, to) => save({ preset: 'custom', from, to: to < from ? from : to }),
        setProductId,
        setCountry,
      }}
    >
      {children}
    </PeriodCtx.Provider>
  );
}

export function usePeriod() {
  const ctx = useContext(PeriodCtx);
  if (!ctx) throw new Error('usePeriod fora do PeriodProvider');
  return ctx;
}

export function FilterBar({ showDimensions = true, inline = false }: { showDimensions?: boolean; inline?: boolean }) {
  const db = useDb();
  const f = usePeriod();
  const countries = useMemo(
    () => [...new Set([...db.sales, ...db.ads].map((x) => x.country).filter(Boolean))].sort(),
    [db.sales, db.ads],
  );
  return (
    <div className="toolbar" style={inline ? { margin: 0 } : undefined}>
      <select aria-label="Período" value={f.period.preset} onChange={(e) => f.setPreset(e.target.value as PresetKey)}>
        {PRESETS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </select>
      {f.period.preset === 'custom' && (
        <>
          <input type="date" aria-label="De" value={f.period.from} onChange={(e) => f.setCustom(e.target.value, f.period.to)} />
          <span className="muted">até</span>
          <input type="date" aria-label="Até" value={f.period.to} onChange={(e) => f.setCustom(f.period.from, e.target.value)} />
        </>
      )}
      {showDimensions && (
        <>
          <select aria-label="Produto" value={f.productId} onChange={(e) => f.setProductId(e.target.value)}>
            <option value="">Todos os produtos</option>
            {db.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select aria-label="País" value={f.country} onChange={(e) => f.setCountry(e.target.value)}>
            <option value="">Todos os países</option>
            {countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </>
      )}
      {!inline && (f.country || f.productId) && (
        <span className="muted small">
          {f.country
            ? 'Filtro por país: despesas fixas não entram — lucro = margem de contribuição.'
            : 'Filtro por produto: entram só as despesas atribuídas ao produto.'}
        </span>
      )}
    </div>
  );
}

/** Aviso sobre como os filtros de produto/país afetam o lucro. */
export function FilterNote() {
  const f = usePeriod();
  if (!f.country && !f.productId) return null;
  return (
    <p className="muted small" style={{ margin: '-6px 0 14px' }}>
      {f.country
        ? 'Filtro por país: despesas fixas não entram — lucro = margem de contribuição.'
        : 'Filtro por produto: entram só as despesas atribuídas ao produto.'}
    </p>
  );
}
