import { useMemo, useState } from 'react';
import type { Database } from '../lib/types';
import { adBase, expandExpenses, saleNet, saleRefunds, toBase, type Filter } from '../lib/metrics';
import { money } from '../lib/format';
import { Icon } from './Icon';

type Kind = 'receita' | 'trafego' | 'despesa' | 'capital';

interface Tx {
  id: string;
  code: string;
  description: string;
  date: string;
  kind: Kind;
  category: string;
  color: string;
  amount: number; // + entrada, − saída (moeda base)
  status: { label: string; tone: 'ok' | 'warn' | 'info' };
}

const KIND_COLOR: Record<Kind, string> = {
  receita: 'var(--series-1)',
  trafego: 'var(--series-2)',
  despesa: 'var(--series-3)',
  capital: 'var(--series-5)',
};
const KIND_LABEL: Record<Kind, string> = { receita: 'Receitas', trafego: 'Tráfego', despesa: 'Despesas', capital: 'Capital' };

const code = (prefix: string, id: string) => `${prefix}-${id.replace(/-/g, '').slice(0, 5).toUpperCase()}`;
const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/\./g, '').replace(/ de /g, ' ');

function collect(db: Database, f: Filter): Tx[] {
  const name = (id?: string) => db.products.find((p) => p.id === id)?.name ?? '—';
  const okP = (id?: string) => !f.productId || id === f.productId;
  const okC = (c?: string) => !f.country || c === f.country;
  const inR = (d: string) => d >= f.from && d <= f.to;
  const out: Tx[] = [];
  for (const s of db.sales) {
    if (!inR(s.date) || !okP(s.productId) || !okC(s.country)) continue;
    const refunded = saleRefunds(s) > 0;
    out.push({
      id: s.id,
      code: code('VEN', s.id),
      description: `${s.quantity}× ${name(s.productId)} · ${s.platform} ${s.country}`,
      date: s.date,
      kind: 'receita',
      category: 'Receita',
      color: KIND_COLOR.receita,
      amount: saleNet(s),
      status: refunded ? { label: 'Com reembolso', tone: 'warn' } : { label: 'Aprovada', tone: 'ok' },
    });
  }
  for (const a of db.ads) {
    if (!inR(a.date) || !okP(a.productId) || !okC(a.country)) continue;
    out.push({
      id: a.id,
      code: code('ADS', a.id),
      description: `${a.source} · ${a.campaign || name(a.productId)} ${a.country}`,
      date: a.date,
      kind: 'trafego',
      category: 'Tráfego pago',
      color: KIND_COLOR.trafego,
      amount: -adBase(a),
      status: { label: 'Pago', tone: 'ok' },
    });
  }
  if (!f.country) {
    for (const o of expandExpenses(db.expenses, f.from, f.to)) {
      if (f.productId && o.expense.productId !== f.productId) continue;
      out.push({
        id: `${o.expense.id}:${o.date}`,
        code: code('DSP', o.expense.id),
        description: o.expense.description,
        date: o.date,
        kind: 'despesa',
        category: o.expense.category,
        color: KIND_COLOR.despesa,
        amount: -o.amount,
        status: o.expense.recurrence === 'monthly' ? { label: 'Recorrente', tone: 'info' } : { label: 'Pago', tone: 'ok' },
      });
    }
    if (!f.productId) {
      for (const c of db.capital) {
        if (!inR(c.date)) continue;
        const v = toBase(c.amount, c.rate);
        out.push({
          id: c.id,
          code: code('CAP', c.id),
          description: c.description,
          date: c.date,
          kind: 'capital',
          category: c.kind === 'aporte' ? 'Aporte' : c.kind === 'retirada' ? 'Retirada' : 'Investimento',
          color: KIND_COLOR.capital,
          amount: c.kind === 'aporte' ? v : -v,
          status: { label: 'Concluído', tone: 'ok' },
        });
      }
    }
  }
  return out;
}

type SortKey = 'date' | 'amount' | 'code' | 'category';

export function Transactions({ db, filter, currency }: { db: Database; filter: Filter; currency: string }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind | ''>('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'date', dir: -1 });
  const [limit, setLimit] = useState(8);

  const all = useMemo(() => collect(db, filter), [db, filter]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((t) => !kind || t.kind === kind)
      .filter((t) => !needle || `${t.code} ${t.description} ${t.category}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        const va = a[sort.key];
        const vb = b[sort.key];
        const cmp = typeof va === 'number' ? va - (vb as number) : String(va).localeCompare(String(vb));
        return cmp * sort.dir || b.date.localeCompare(a.date);
      });
  }, [all, q, kind, sort]);

  const th = (key: SortKey, label: string, num = false) => (
    <th
      className={`sortable ${num ? 'num' : ''}`}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
    >
      {label}
      <span className="sort">{sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : '⇅'}</span>
    </th>
  );

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">
          <span className="icon-box">
            <Icon name="clock" size={17} />
          </span>
          <h2>Transações recentes</h2>
        </div>
        <div className="head-actions">
          <label className="search">
            <Icon name="search" size={15} />
            <input placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar transações" />
          </label>
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind | '')} aria-label="Filtrar tipo">
            <option value="">Todos os tipos</option>
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="table-wrap framed">
        <table>
          <thead>
            <tr>
              {th('code', 'ID')}
              <th>Descrição</th>
              {th('date', 'Data')}
              {th('category', 'Categoria')}
              {th('amount', 'Valor', true)}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((t) => (
              <tr key={t.id}>
                <td className="muted">{t.code}</td>
                <td style={{ fontWeight: 500 }}>{t.description}</td>
                <td>{fmtDate(t.date)}</td>
                <td>
                  <i className="dot" style={{ background: t.color }} />
                  {t.category}
                </td>
                <td className={`num ${t.amount >= 0 ? 'pos' : 'neg'}`}>
                  {t.amount >= 0 ? '+' : '−'}
                  {money(Math.abs(t.amount), currency)}
                </td>
                <td>
                  <span className={`status ${t.status.tone}`}>{t.status.label}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">Nenhuma transação no período.</div>}
      </div>
      {rows.length > limit && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button onClick={() => setLimit((l) => l + 20)}>Mostrar mais ({rows.length - limit})</button>
        </div>
      )}
    </div>
  );
}
