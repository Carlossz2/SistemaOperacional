import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Crud, EntryForm, type Field } from '../components/Crud';
import { BankPanel } from '../components/BankPanel';
import { CustomerList } from '../components/CustomerList';
import { TrafficPanel, type TrafficFilter } from '../components/TrafficPanel';
import type { AdSpend, CapitalMove, Database, Expense, ExpenseStatus, Product, Sale } from '../lib/types';
import { ExpenseStatusCell, ExpenseStatusFilter } from '../components/ExpenseStatus';
import { chargedIn, EXPENSE_STATUS, statusOf } from '../lib/expenseStatus';
import { adBase, campaignNames, campaignOf, saleGross, saleNet, toBase } from '../lib/metrics';
import { money, num, shortDate } from '../lib/format';
import { today } from '../lib/dates';
import { isCloudActive, uid, upsert, useDb } from '../lib/store';

// Produtos pausados continuam na lista (no fim) para não trocar o produto ao editar lançamentos antigos
const productOptions = (db: Database) =>
  [...db.products]
    .sort((a, b) => Number(b.active) - Number(a.active))
    .map((p) => ({ value: p.id, label: p.active ? p.name : `${p.name} (pausado)` }));
const productName = (db: Database, id?: string) => (id ? db.products.find((p) => p.id === id)?.name ?? '—' : 'Sem produto');
const COUNTRIES = ['BR', 'US', 'MX', 'CO', 'AR', 'CL', 'PE', 'EC', 'ES', 'PT', 'CA', 'GB', 'AU', 'DE', 'FR', 'IT'];
const countries = (db: Database) => [...new Set([...COUNTRIES, ...db.sales.map((s) => s.country), ...db.ads.map((a) => a.country)])];
const sum = <T,>(xs: T[], fn: (x: T) => number) => xs.reduce((a, x) => a + fn(x), 0);
const base = (db: Database) => db.settings.baseCurrency;
const orig = (v: number, cur: string) => money(v, cur);

const NeedProduct = () => {
  const db = useDb();
  if (db.products.length) return <>Nenhum lançamento no período.</>;
  return (
    <>
      Cadastre primeiro um <Link to="/produtos">produto/oferta</Link> para lançar receitas e tráfego.
    </>
  );
};

const currencyFields: Field[] = [{ key: 'currency', label: 'Moeda', type: 'currency' }];

const saleFields: Field[] = [
  { key: 'date', label: 'Data', type: 'date', required: true },
  { key: 'productId', label: 'Produto / oferta', type: 'select', required: true, options: productOptions },
  { key: 'platform', label: 'Plataforma', type: 'text', required: true, suggestions: (db) => db.settings.platforms },
  { key: 'country', label: 'País', type: 'text', required: true, suggestions: countries, placeholder: 'BR, MX, US…' },
  ...currencyFields,
  { key: 'quantity', label: 'Nº de vendas', type: 'number', required: true },
  { key: 'gross', label: 'Faturamento bruto', type: 'number', required: true, hint: 'Valor total pago pelos clientes' },
  { key: 'fees', label: 'Taxas (plataforma, gateway, afiliados)', type: 'number' },
  { key: 'refunds', label: 'Reembolsos + chargebacks', type: 'number' },
  { key: 'campaign', label: 'Campanha (opcional)', type: 'text', span2: true, suggestions: (db) => campaignNames(db), hint: 'Use o mesmo nome da campanha no Meta para ver o ROI dela em Tráfego pago' },
  { key: 'notes', label: 'Observações', type: 'textarea', span2: true },
];

const blankSale = (db: Database, over: Partial<Sale> = {}) => ({
  date: today(),
  productId: db.products.find((p) => p.active)?.id ?? '',
  platform: db.settings.platforms[0] ?? '',
  country: 'BR',
  currency: base(db),
  rate: 1,
  quantity: 1,
  gross: '',
  fees: '',
  refunds: '',
  ...over,
});

export function SalesPage() {
  const cloud = isCloudActive();
  return (
    <Crud<Sale>
      title="Receitas"
      subtitle={
        cloud
          ? 'Importe a lista de clientes de cada plataforma (CSV ou Excel exportado do painel). As vendas entram no faturamento, no lucro e nos relatórios.'
          : 'Lance as vendas do período. Para importar a lista de clientes das plataformas, conecte o Supabase em Configurações.'
      }
      collection="sales"
      byPeriod
      header={cloud ? <CustomerList /> : undefined}
      // as vendas importadas já aparecem na lista de clientes; aqui ficam só os lançamentos manuais
      filter={cloud ? (s) => s.origin !== 'auto' : undefined}
      tableTitle={cloud ? 'Lançamentos manuais (histórico e ajustes)' : undefined}
      fields={saleFields}
      emptyHint={<NeedProduct />}
      blank={(db) => blankSale(db)}
      search={(s, db) => `${productName(db, s.productId)} ${s.platform} ${s.country} ${s.campaign ?? ''} ${s.notes ?? ''}`}
      columns={[
        { label: 'Data', render: (s) => shortDate(s.date), csv: (s) => s.date },
        { label: 'Produto', render: (s, db) => productName(db, s.productId), csv: (s, db) => productName(db, s.productId) },
        { label: 'Plataforma', render: (s) => s.platform, csv: (s) => s.platform },
        { label: 'País', render: (s) => <span className="pill">{s.country}</span>, csv: (s) => s.country },
        { label: 'Campanha', render: (s) => campaignOf(s) || '—', csv: (s) => campaignOf(s) },
        { label: 'Vendas', num: true, render: (s) => num(s.quantity), csv: (s) => s.quantity },
        { label: 'Bruto (moeda)', num: true, render: (s) => orig(s.gross, s.currency), csv: (s) => `${s.gross} ${s.currency}` },
        { label: 'Bruto', num: true, render: (s, db) => money(saleGross(s), base(db)), csv: (s) => saleGross(s) },
        { label: 'Líquido', num: true, render: (s, db) => money(saleNet(s), base(db)), csv: (s) => saleNet(s) },
      ]}
      footer={(items, db) => [
        'Total',
        '',
        '',
        '',
        '',
        num(sum(items, (s) => s.quantity)),
        '',
        money(sum(items, saleGross), base(db)),
        money(sum(items, saleNet), base(db)),
      ]}
    />
  );
}

export function AdsPage() {
  const db = useDb();
  const [filter, setFilter] = useState<TrafficFilter>({ productId: '', campaign: '' });
  const [sale, setSale] = useState<Record<string, unknown> | null>(null);
  const match = useCallback(
    (a: AdSpend) => (!filter.productId || a.productId === filter.productId) && (!filter.campaign || campaignOf(a) === filter.campaign),
    [filter],
  );
  const addSale = () => {
    if (!db.products.length) return alert('Cadastre primeiro um produto/oferta em Produtos.');
    const over: Partial<Sale> = {};
    if (filter.productId) over.productId = filter.productId;
    if (filter.campaign) over.campaign = filter.campaign;
    setSale({ ...blankSale(db, over), id: uid() });
  };
  return (
    <>
    <Crud<AdSpend>
      title="Tráfego pago"
      subtitle="Gasto em anúncios × vendas reais: lucro, ROAS, CPA e ROI por produto e campanha. Os gastos da Meta entram sozinhos, de hora em hora (🔒)."
      collection="ads"
      locked={(a) => (a.origin === 'meta' ? 'Sincronizado da Meta Ads. Para mudar o produto, ajuste as regras em Integrações e sincronize de novo.' : null)}
      byPeriod
      header={<TrafficPanel filter={filter} onFilter={setFilter} onAddSale={addSale} />}
      filter={filter.productId || filter.campaign ? match : undefined}
      emptyHint={<NeedProduct />}
      fields={[
        { key: 'date', label: 'Data', type: 'date', required: true },
        { key: 'productId', label: 'Produto / oferta', type: 'select', required: true, options: productOptions },
        { key: 'source', label: 'Fonte de tráfego', type: 'text', required: true, suggestions: (db) => db.settings.adSources },
        { key: 'country', label: 'País', type: 'text', required: true, suggestions: countries },
        { key: 'campaign', label: 'Campanha / conta (opcional)', type: 'text', span2: true },
        ...currencyFields,
        { key: 'amount', label: 'Valor investido', type: 'number', required: true, hint: 'Inclua o IOF/imposto do cartão se quiser o custo real' },
        { key: 'notes', label: 'Observações', type: 'textarea', span2: true },
      ]}
      blank={(db) => ({
        date: today(),
        productId: db.products.find((p) => p.active)?.id ?? '',
        source: db.settings.adSources[0] ?? '',
        country: 'BR',
        currency: base(db),
        rate: 1,
        amount: '',
      })}
      search={(a, db) => `${productName(db, a.productId)} ${a.source} ${a.country} ${a.campaign ?? ''}`}
      columns={[
        { label: 'Data', render: (a) => shortDate(a.date), csv: (a) => a.date },
        { label: 'Produto', render: (a, db) => productName(db, a.productId), csv: (a, db) => productName(db, a.productId) },
        { label: 'Fonte', render: (a) => a.source, csv: (a) => a.source },
        { label: 'Campanha', render: (a) => a.campaign || '—', csv: (a) => a.campaign ?? '' },
        { label: 'País', render: (a) => <span className="pill">{a.country}</span>, csv: (a) => a.country },
        { label: 'Valor (moeda)', num: true, render: (a) => orig(a.amount, a.currency), csv: (a) => `${a.amount} ${a.currency}` },
        { label: 'Valor', num: true, render: (a, db) => money(adBase(a), base(db)), csv: (a) => adBase(a) },
      ]}
      footer={(items, db) => ['Total', '', '', '', '', '', money(sum(items, adBase), base(db))]}
    />
    {sale && (
      <EntryForm
        title="Venda manual"
        fields={saleFields}
        draft={sale}
        db={db}
        onCancel={() => setSale(null)}
        onSave={(d) => {
          upsert('sales', d as never);
          setSale(null);
        }}
      />
    )}
    </>
  );
}

export function ExpensesPage() {
  const db = useDb();
  const [status, setStatus] = useState<ExpenseStatus | ''>('');
  const [category, setCategory] = useState('');
  const month = today().slice(0, 7);
  // categorias da lista + as que já estão em uso (mesmo se removidas da lista)
  const categories = [...new Set([...db.settings.expenseCategories, ...db.expenses.map((e) => e.category)])];
  return (
    <Crud<Expense>
      title="Despesas"
      subtitle="Custos da operação: ferramentas, equipe, criativos, contabilidade… Marque como mensal para assinaturas e salários. Clique no status para pausar, cancelar ou reativar."
      collection="expenses"
      header={
        <div className="toolbar" style={{ alignItems: 'flex-start' }}>
          <ExpenseStatusFilter items={db.expenses} value={status} onChange={setStatus} />
          <select aria-label="Filtrar por categoria" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Todas as categorias</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c} ({db.expenses.filter((e) => e.category === c).length})
              </option>
            ))}
          </select>
        </div>
      }
      filter={status || category ? (e) => (!status || statusOf(e, month) === status) && (!category || e.category === category) : undefined}
      search={(e, db) => `${e.description} ${e.category} ${productName(db, e.productId)}`}
      fields={[
        { key: 'date', label: 'Data (1ª cobrança)', type: 'date', required: true },
        {
          key: 'category',
          label: 'Categoria',
          type: 'select',
          required: true,
          options: (db) => db.settings.expenseCategories.map((c) => ({ value: c, label: c })),
        },
        { key: 'description', label: 'Descrição', type: 'text', required: true, span2: true },
        ...currencyFields,
        { key: 'amount', label: 'Valor', type: 'number', required: true },
        {
          key: 'recurrence',
          label: 'Recorrência',
          type: 'select',
          required: true,
          options: () => [
            { value: 'none', label: 'Única' },
            { value: 'monthly', label: 'Mensal' },
          ],
        },
        { key: 'productId', label: 'Atribuir a um produto (opcional)', type: 'select', options: productOptions },
        { key: 'notes', label: 'Observações', type: 'textarea', span2: true },
      ]}
      blank={(db) => ({
        date: today(),
        category: db.settings.expenseCategories[0],
        description: '',
        currency: base(db),
        rate: 1,
        amount: '',
        recurrence: 'none',
      })}
      columns={[
        { label: 'Data', render: (e) => shortDate(e.date), csv: (e) => e.date },
        { label: 'Descrição', render: (e) => e.description, csv: (e) => e.description },
        { label: 'Categoria', render: (e) => e.category, csv: (e) => e.category },
        {
          label: 'Recorrência',
          render: (e) => (e.recurrence === 'monthly' ? <span className="pill">Mensal</span> : 'Única'),
          csv: (e) => (e.recurrence === 'monthly' ? 'Mensal' : 'Única'),
        },
        { label: 'Status', render: (e) => <ExpenseStatusCell expense={e} />, csv: (e) => EXPENSE_STATUS[statusOf(e, month)].label },
        { label: 'Produto', render: (e, db) => productName(db, e.productId), csv: (e, db) => productName(db, e.productId) },
        { label: 'Valor', num: true, render: (e, db) => money(toBase(e.amount, e.rate), base(db)), csv: (e) => toBase(e.amount, e.rate) },
      ]}
      footer={(items, db) => {
        // só as mensais que de fato cobram neste mês (pausadas e canceladas ficam de fora)
        const monthly = sum(
          items.filter((e) => e.recurrence === 'monthly' && statusOf(e, month) === 'active' && chargedIn(e, month)),
          (e) => toBase(e.amount, e.rate),
        );
        return ['Custo fixo mensal ativo', '', '', '', '', '', money(monthly, base(db))];
      }}
    />
  );
}

const KIND_LABEL: Record<CapitalMove['kind'], string> = {
  aporte: 'Aporte (entrada)',
  retirada: 'Retirada / pró-labore',
  investimento: 'Investimento (ativo)',
};

export function CapitalPage() {
  return (
    <Crud<CapitalMove>
      title="Caixa & capital"
      subtitle="Saldo e extrato da conta Mercado Pago (automático) e o capital da empresa: aportes, retiradas (pró-labore, lucros) e investimentos. Capital não entra no lucro, só no caixa."
      collection="capital"
      byPeriod
      header={<BankPanel />}
      fields={[
        { key: 'date', label: 'Data', type: 'date', required: true },
        {
          key: 'kind',
          label: 'Tipo',
          type: 'select',
          required: true,
          options: () => Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label })),
        },
        { key: 'description', label: 'Descrição', type: 'text', required: true, span2: true },
        ...currencyFields,
        { key: 'amount', label: 'Valor', type: 'number', required: true },
        { key: 'notes', label: 'Observações', type: 'textarea', span2: true },
      ]}
      blank={(db) => ({ date: today(), kind: 'aporte', description: '', currency: base(db), rate: 1, amount: '' })}
      search={(c) => `${c.description} ${KIND_LABEL[c.kind]}`}
      columns={[
        { label: 'Data', render: (c) => shortDate(c.date), csv: (c) => c.date },
        { label: 'Tipo', render: (c) => <span className="pill">{KIND_LABEL[c.kind]}</span>, csv: (c) => KIND_LABEL[c.kind] },
        { label: 'Descrição', render: (c) => c.description, csv: (c) => c.description },
        {
          label: 'Valor',
          num: true,
          render: (c, db) => {
            const v = toBase(c.amount, c.rate);
            return (
              <span style={{ color: c.kind === 'aporte' ? 'var(--good-text)' : 'var(--bad-text)' }}>
                {c.kind === 'aporte' ? '+' : '−'} {money(v, base(db))}
              </span>
            );
          },
          csv: (c) => (c.kind === 'aporte' ? 1 : -1) * toBase(c.amount, c.rate),
        },
      ]}
    />
  );
}

const KIND_PRODUCT: Record<Product['kind'], string> = {
  front: 'Front-end',
  upsell: 'Upsell',
  downsell: 'Downsell',
  orderbump: 'Order bump',
  recorrente: 'Recorrência',
  outro: 'Outro',
};

const MARKETS: Record<string, string> = {
  BR: 'BR — Brasil',
  LATAM: 'LATAM — América Latina',
  GLOBAL: 'GLOBAL — Mundo',
};

/** Opções de mercado; mantém um valor antigo fora da lista e força a escolha quando vazio. */
function marketOptions(current: string) {
  const opts: { value: string; label: string; disabled?: boolean }[] = Object.entries(MARKETS).map(([value, label]) => ({ value, label }));
  if (!current) opts.unshift({ value: '', label: 'Selecione o mercado…', disabled: true });
  else if (!MARKETS[current]) opts.push({ value: current, label: `${current} (antigo)` });
  return opts;
}

export function ProductsPage() {
  return (
    <Crud<Product>
      title="Produtos & ofertas"
      subtitle="Cada oferta que você escala. Receitas, tráfego e despesas são atribuídos a ela."
      collection="products"
      search={(p) => `${p.name} ${p.market}`}
      blockDelete={(p, db) => {
        const n =
          db.sales.filter((x) => x.productId === p.id).length +
          db.ads.filter((x) => x.productId === p.id).length +
          db.expenses.filter((x) => x.productId === p.id).length;
        return n
          ? `"${p.name}" tem ${n} lançamento(s) vinculado(s). Para manter o histórico correto, edite o produto e desmarque "Ativo" em vez de excluir.`
          : null;
      }}
      emptyHint="Cadastre sua primeira oferta para começar."
      fields={[
        { key: 'name', label: 'Nome', type: 'text', required: true, span2: true },
        { key: 'market', label: 'Mercado', type: 'select', required: true, options: (_db, d) => marketOptions(String(d.market ?? '')) },
        {
          key: 'kind',
          label: 'Tipo',
          type: 'select',
          required: true,
          options: () => Object.entries(KIND_PRODUCT).map(([value, label]) => ({ value, label })),
        },
        { key: 'targetCpa', label: 'CPA máximo (moeda base)', type: 'number', hint: 'Usado para alertar no dashboard' },
        { key: 'active', label: 'Ativo', type: 'checkbox' },
      ]}
      blank={() => ({ name: '', market: 'BR', kind: 'front', active: true, targetCpa: '' })}
      columns={[
        { label: 'Nome', render: (p) => p.name, csv: (p) => p.name },
        { label: 'Mercado', render: (p) => <span className="pill">{p.market || '—'}</span>, csv: (p) => p.market },
        { label: 'Tipo', render: (p) => KIND_PRODUCT[p.kind], csv: (p) => KIND_PRODUCT[p.kind] },
        { label: 'CPA máx.', num: true, render: (p, db) => (p.targetCpa ? money(p.targetCpa, base(db)) : '—'), csv: (p) => p.targetCpa ?? '' },
        { label: 'Status', render: (p) => (p.active ? 'Ativo' : 'Pausado'), csv: (p) => (p.active ? 'Ativo' : 'Pausado') },
      ]}
    />
  );
}
