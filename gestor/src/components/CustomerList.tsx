import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { ImportSales } from './ImportSales';
import { supabase } from '../lib/cloud/sync';
import { money, num, shortDate } from '../lib/format';
import { download, toCsv } from '../lib/io';
import { usePeriod } from '../lib/period';
import { useDb } from '../lib/store';

// Lista de clientes (cada venda importada das planilhas das plataformas), com filtros.

interface Tx {
  id: string;
  sale_date: string | null;
  platform_label: string;
  external_id: string;
  status: string;
  product_id: string | null;
  product_name: string | null;
  currency: string;
  rate: number;
  quantity: number;
  gross: number;
  country: string;
  buyer_email: string | null;
  buyer_name: string | null;
}

const STATUS: Record<string, { label: string; tone: string }> = {
  approved: { label: 'Aprovada', tone: 'ok' },
  refunded: { label: 'Reembolsada', tone: 'warn' },
  chargeback: { label: 'Chargeback', tone: 'warn' },
  pending: { label: 'Pendente', tone: 'info' },
  canceled: { label: 'Cancelada', tone: 'info' },
};
const PAGE = 100;
const NO_PRODUCT = '__none__';

export function CustomerList() {
  const db = useDb();
  const { period } = usePeriod();
  const cur = db.settings.baseCurrency;
  const [rows, setRows] = useState<Tx[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [importing, setImporting] = useState(false);
  const [q, setQ] = useState('');
  const [product, setProduct] = useState('');
  const [platform, setPlatform] = useState('');
  const [country, setCountry] = useState('');
  const [status, setStatus] = useState('');
  const [limit, setLimit] = useState(PAGE);

  // vendas do período (ao vivo + reserva a cada 60 s)
  useEffect(() => {
    const sb = supabase();
    const ch = sb
      .channel(`customers-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => setTick((t) => t + 1));
    ch.subscribe();
    const timer = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => {
      clearInterval(timer);
      void sb.removeChannel(ch);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const all: Tx[] = [];
      for (let from = 0; from < 50_000; from += 1000) {
        const { data, error: e } = await supabase()
          .from('transactions')
          .select('id, sale_date, platform_label, external_id, status, product_id, product_name, currency, rate, quantity, gross, country, buyer_email, buyer_name')
          .gte('sale_date', period.from)
          .lte('sale_date', period.to)
          .order('sale_date', { ascending: false })
          .order('created_at', { ascending: false })
          .range(from, from + 999);
        if (e) {
          if (alive) setError(e.message);
          break;
        }
        all.push(...((data ?? []) as Tx[]).map((r) => ({ ...r, rate: Number(r.rate), quantity: Number(r.quantity), gross: Number(r.gross) })));
        if (!data || data.length < 1000) break;
      }
      if (alive) {
        setRows(all);
        setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [period.from, period.to, tick]);

  const names = useMemo(() => new Map(db.products.map((p) => [p.id, p.name])), [db.products]);
  const productName = (r: Tx) => (r.product_id && names.get(r.product_id)) || r.product_name || 'Sem produto';
  const options = useMemo(() => {
    const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const products = new Map<string, string>();
    for (const r of rows) products.set(r.product_id ?? NO_PRODUCT, (r.product_id && names.get(r.product_id)) || r.product_name || 'Sem produto');
    return {
      products: [...products.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')),
      platforms: uniq(rows.map((r) => r.platform_label)),
      countries: uniq(rows.map((r) => r.country)),
    };
  }, [rows, names]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!product || (r.product_id ?? NO_PRODUCT) === product) &&
        (!platform || r.platform_label === platform) &&
        (!country || r.country === country) &&
        (!status || r.status === status) &&
        (!needle || `${r.buyer_name ?? ''} ${r.buyer_email ?? ''} ${r.external_id}`.toLowerCase().includes(needle)),
    );
  }, [rows, product, platform, country, status, q]);
  useEffect(() => setLimit(PAGE), [product, platform, country, status, q, period.from, period.to]);

  const sum = useMemo(() => {
    const approved = shown.filter((r) => r.status === 'approved');
    return {
      approved: approved.length,
      gross: approved.reduce((a, r) => a + r.gross * r.rate, 0),
      refunded: shown.filter((r) => r.status === 'refunded' || r.status === 'chargeback').length,
      customers: new Set(approved.map((r) => (r.buyer_email || r.buyer_name || r.external_id).toLowerCase())).size,
    };
  }, [shown]);
  const filtered = Boolean(product || platform || country || status || q.trim());

  const exportCsv = () =>
    download(
      `clientes-${period.from}-a-${period.to}.csv`,
      toCsv(
        shown.map((r) => ({
          Data: r.sale_date ?? '',
          Cliente: r.buyer_name ?? '',
          'E-mail': r.buyer_email ?? '',
          Produto: productName(r),
          Plataforma: r.platform_label,
          País: r.country,
          Moeda: r.currency,
          Valor: r.gross,
          Status: STATUS[r.status]?.label ?? r.status,
          Código: r.external_id,
        })),
      ),
      'text/csv;charset=utf-8',
    );

  return (
    <div className="card mb">
      <div className="card-head">
        <div className="card-title">
          <span className="icon-box"><Icon name="users" size={17} /></span>
          <h2>Clientes</h2>
          <span className="muted small">
            {num(sum.approved)} venda(s) aprovada(s) · {money(sum.gross, cur)} · {num(sum.customers)} cliente(s)
            {sum.refunded ? ` · ${num(sum.refunded)} reembolso(s)` : ''}
          </span>
        </div>
        <div className="head-actions">
          <button onClick={exportCsv} disabled={!shown.length}>
            <Icon name="download" size={15} /> CSV
          </button>
          <button className="primary" onClick={() => setImporting(true)}>
            <Icon name="upload" size={15} /> Importar lista de clientes
          </button>
        </div>
      </div>

      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={15} />
          <input placeholder="Nome, e-mail ou código" aria-label="Buscar cliente" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <select aria-label="Filtrar por produto" value={product} onChange={(e) => setProduct(e.target.value)}>
          <option value="">Todos os produtos</option>
          {options.products.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <select aria-label="Filtrar por plataforma" value={platform} onChange={(e) => setPlatform(e.target.value)}>
          <option value="">Todas as plataformas</option>
          {options.platforms.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select aria-label="Filtrar por país" value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">Todos os países</option>
          {options.countries.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select aria-label="Filtrar por status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        {filtered && (
          <button
            className="link"
            onClick={() => {
              setQ('');
              setProduct('');
              setPlatform('');
              setCountry('');
              setStatus('');
            }}
          >
            Limpar filtros
          </button>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Cliente</th>
              <th>Produto</th>
              <th>Plataforma</th>
              <th>País</th>
              <th className="num">Valor</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((r) => (
              <tr key={r.id}>
                <td>{r.sale_date ? shortDate(r.sale_date) : '—'}</td>
                <td>
                  {r.buyer_name || r.buyer_email || '—'}
                  {r.buyer_name && r.buyer_email && <div className="muted small">{r.buyer_email}</div>}
                </td>
                <td>{productName(r)}</td>
                <td>{r.platform_label}</td>
                <td><span className="pill">{r.country}</span></td>
                <td className="num">{money(r.gross, r.currency)}</td>
                <td>
                  <span className={`status ${STATUS[r.status]?.tone ?? 'info'}`}>{STATUS[r.status]?.label ?? r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loaded && !shown.length && (
          <div className="empty">
            {rows.length ? 'Nenhum cliente com esses filtros.' : 'Nenhuma venda importada no período. Clique em "Importar lista de clientes" e envie a planilha exportada da plataforma.'}
          </div>
        )}
      </div>
      {shown.length > limit && (
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <button onClick={() => setLimit(limit + PAGE)}>
            Mostrar mais ({num(shown.length - limit)} restante(s))
          </button>
        </div>
      )}

      {importing && (
        <ImportSales
          onClose={() => {
            setImporting(false);
            setTick((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}
