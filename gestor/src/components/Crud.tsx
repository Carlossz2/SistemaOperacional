import { useMemo, useState, type ReactNode } from 'react';
import type { Collection, Database } from '../lib/types';
import { defaultRate, remove, uid, upsert, useDb } from '../lib/store';
import { today } from '../lib/dates';
import { decimalInput, parseDecimal } from '../lib/format';
import { download, toCsv } from '../lib/io';
import { FilterBar, usePeriod } from '../lib/period';
import { Icon } from './Icon';

type Draft = Record<string, unknown>;

export interface Field {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'month' | 'select' | 'textarea' | 'checkbox' | 'currency';
  options?: (db: Database) => { value: string; label: string }[];
  /** Sugestões para campo de texto livre */
  suggestions?: (db: Database) => string[];
  required?: boolean;
  span2?: boolean;
  placeholder?: string;
  hint?: string;
  showIf?: (d: Draft) => boolean;
}

export interface Column<T> {
  label: string;
  render: (item: T, db: Database) => ReactNode;
  num?: boolean;
  csv?: (item: T, db: Database) => string | number;
}

interface Props<T extends { id: string }> {
  title: string;
  subtitle: string;
  collection: Collection;
  fields: Field[];
  columns: Column<T>[];
  blank: (db: Database) => Draft;
  /** Filtra a lista pelo período global (lançamentos com campo `date`) */
  byPeriod?: boolean;
  /** Linha de totais no rodapé (uma célula por coluna) */
  footer?: (items: T[], db: Database) => ReactNode[];
  search?: (item: T, db: Database) => string;
  emptyHint?: ReactNode;
  /** Retorna um motivo para bloquear a exclusão (ex.: produto com lançamentos) */
  blockDelete?: (item: T, db: Database) => string | null;
  /** Registro somente leitura (ex.: venda recebida por webhook): retorna o motivo */
  locked?: (item: T) => string | null;
}

export function Crud<T extends { id: string; date?: string }>(props: Props<T>) {
  const db = useDb();
  const { period } = usePeriod();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [q, setQ] = useState('');

  const all = db[props.collection] as unknown as T[];
  const items = useMemo(() => {
    let list = all;
    if (props.byPeriod) list = list.filter((x) => !x.date || (x.date >= period.from && x.date <= period.to));
    if (q.trim() && props.search) {
      const needle = q.trim().toLowerCase();
      list = list.filter((x) => props.search!(x, db).toLowerCase().includes(needle));
    }
    return [...list].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [all, props.byPeriod, props.search, period, q, db]);

  const open = (d: Draft) => setDraft(d);
  const exportCsv = () => {
    const rows = items.map((it) =>
      Object.fromEntries(props.columns.filter((c) => c.csv).map((c) => [c.label, c.csv!(it, db)])),
    );
    download(`${props.collection}-${today()}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  };
  const foot = props.footer?.(items, db);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{props.title}</h1>
          <p className="muted">{props.subtitle}</p>
        </div>
        <div className="toolbar" style={{ margin: 0 }}>
          <button onClick={exportCsv} disabled={!items.length}>
            <Icon name="download" size={16} /> CSV
          </button>
          <button className="primary" onClick={() => open({ ...props.blank(db), id: uid() })}>
            <Icon name="plus" size={16} /> Novo lançamento
          </button>
        </div>
      </div>

      {props.byPeriod && <FilterBar showDimensions={false} />}

      <div className="card">
        {props.search && (
          <div className="toolbar">
            <input placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
            <span className="muted small">{items.length} registro(s)</span>
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {props.columns.map((c) => (
                  <th key={c.label} className={c.num ? 'num' : ''}>
                    {c.label}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  {props.columns.map((c) => (
                    <td key={c.label} className={c.num ? 'num' : ''}>
                      {c.render(it, db)}
                    </td>
                  ))}
                  <td>
                    {props.locked?.(it) ? (
                      <div className="row-actions">
                        <span className="lock" title={props.locked(it)!}>
                          <Icon name="lock" size={15} />
                        </span>
                      </div>
                    ) : (
                    <div className="row-actions">
                      <button className="ghost" title="Editar" onClick={() => open({ ...it })}>
                        <Icon name="edit" size={16} />
                      </button>
                      {it.date !== undefined && (
                        <button className="ghost" title="Duplicar para hoje" onClick={() => open({ ...it, id: uid(), date: today() })}>
                          <Icon name="copy" size={16} />
                        </button>
                      )}
                      <button
                        className="ghost danger"
                        title="Excluir"
                        onClick={() => {
                          const reason = props.blockDelete?.(it, db);
                          if (reason) return alert(reason);
                          if (confirm('Excluir este registro?')) remove(props.collection, it.id);
                        }}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {foot && items.length > 0 && (
              <tfoot>
                <tr>
                  {foot.map((cell, i) => (
                    <td key={i} className={props.columns[i]?.num ? 'num' : ''}>
                      {cell}
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
          {!items.length && <div className="empty">{props.emptyHint ?? 'Nenhum registro no período.'}</div>}
        </div>
      </div>

      {draft && (
        <EntryForm
          title={all.some((x) => x.id === draft.id) ? 'Editar' : 'Novo lançamento'}
          fields={props.fields}
          draft={draft}
          db={db}
          onCancel={() => setDraft(null)}
          onSave={(d) => {
            upsert(props.collection, d as never);
            setDraft(null);
          }}
        />
      )}
    </>
  );
}

function EntryForm(p: {
  title: string;
  fields: Field[];
  draft: Draft;
  db: Database;
  onSave: (d: Draft) => void;
  onCancel: () => void;
}) {
  // Campos numéricos são editados como texto para aceitar vírgula decimal ("1.234,56")
  const numericKeys = [...p.fields.filter((f) => f.type === 'number').map((f) => f.key), 'rate'];
  const [d, setD] = useState<Draft>(() => {
    const init = { ...p.draft };
    for (const k of numericKeys) if (k in init) init[k] = decimalInput(init[k]);
    return init;
  });
  const [error, setError] = useState('');
  const set = (k: string, v: unknown) => setD((prev) => ({ ...prev, [k]: v }));
  const currencies = Object.keys(p.db.settings.rates);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const out: Draft = { ...d };
    for (const f of p.fields.filter((x) => x.type === 'number')) {
      const v = parseDecimal(out[f.key]);
      if (v === null && f.required) return setError(`Preencha "${f.label}".`);
      if (v !== null && (Number.isNaN(v) || v < 0)) return setError(`Valor inválido em "${f.label}". Use números, ex.: 1.234,56`);
      out[f.key] = v ?? 0;
    }
    if ('rate' in out) {
      const r = out.currency === p.db.settings.baseCurrency ? 1 : parseDecimal(out.rate);
      if (r === null || Number.isNaN(r) || r <= 0) return setError('Cotação inválida: informe quanto vale 1 unidade da moeda, ex.: 5,40');
      out.rate = r;
    }
    p.onSave(out);
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && p.onCancel()}>
      <form className="modal" onSubmit={submit}>
        <div className="modal-head">
          <h2 style={{ margin: 0 }}>{p.title}</h2>
          <button type="button" className="ghost" onClick={p.onCancel} aria-label="Fechar">
            <Icon name="close" />
          </button>
        </div>
        <div className="form-grid">
          {p.fields
            .filter((f) => !f.showIf || f.showIf(d))
            .map((f) => {
              const v = d[f.key];
              if (f.type === 'checkbox') {
                return (
                  <label key={f.key} className={`check ${f.span2 ? 'span-2' : ''}`}>
                    <input type="checkbox" checked={Boolean(v)} onChange={(e) => set(f.key, e.target.checked)} />
                    {f.label}
                  </label>
                );
              }
              if (f.type === 'currency') {
                const isBase = v === p.db.settings.baseCurrency;
                return (
                  <div key={f.key} className="span-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label className="field">
                      Moeda
                      <select
                        value={String(v)}
                        onChange={(e) =>
                          setD((prev) => ({ ...prev, currency: e.target.value, rate: decimalInput(defaultRate(e.target.value)) }))
                        }
                      >
                        {currencies.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Cotação (1 {String(v)} = ? {p.db.settings.baseCurrency})
                      <input
                        inputMode="decimal"
                        disabled={isBase}
                        value={isBase ? '1' : String(d.rate ?? '')}
                        onChange={(e) => set('rate', e.target.value)}
                      />
                    </label>
                  </div>
                );
              }
              const common = {
                id: `f-${f.key}`,
                required: f.required,
                placeholder: f.placeholder,
                value: v === undefined || v === null ? '' : String(v),
              };
              let input: ReactNode;
              if (f.type === 'select') {
                input = (
                  <select {...common} onChange={(e) => set(f.key, e.target.value)}>
                    {!f.required && <option value="">—</option>}
                    {f.options!(p.db).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                );
              } else if (f.type === 'textarea') {
                input = <textarea {...common} rows={2} onChange={(e) => set(f.key, e.target.value)} />;
              } else {
                const list = f.suggestions ? `dl-${f.key}` : undefined;
                input = (
                  <>
                    <input
                      {...common}
                      type={f.type === 'number' ? 'text' : f.type}
                      inputMode={f.type === 'number' ? 'decimal' : undefined}
                      autoComplete="off"
                      list={list}
                      onChange={(e) => set(f.key, e.target.value)}
                    />
                    {list && (
                      <datalist id={list}>
                        {f.suggestions!(p.db).map((s) => (
                          <option key={s} value={s} />
                        ))}
                      </datalist>
                    )}
                  </>
                );
              }
              return (
                <label key={f.key} className={`field ${f.span2 ? 'span-2' : ''}`} htmlFor={`f-${f.key}`}>
                  {f.label}
                  {input}
                  {f.hint && <span className="muted small">{f.hint}</span>}
                </label>
              );
            })}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-foot">
          <button type="button" onClick={p.onCancel}>
            Cancelar
          </button>
          <button type="submit" className="primary">
            Salvar
          </button>
        </div>
      </form>
    </div>
  );
}
