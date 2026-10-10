import { useSyncExternalStore } from 'react';
import type { Collection, Database, Settings } from './types';

// Os dados ficam no navegador (localStorage). A camada é isolada aqui para que,
// no futuro, a troca por um backend (ex: Supabase) não afete as telas.

const KEY = 'gestor-dr:db';

export const DEFAULT_SETTINGS: Settings = {
  baseCurrency: 'BRL',
  rates: { BRL: 1, USD: 5.4, EUR: 5.9, GBP: 6.9, MXN: 0.3, COP: 0.0013, ARS: 0.0045, CLP: 0.0057, PEN: 1.45 },
  taxRate: 6,
  businessName: 'Minha Operação',
  platforms: ['Hotmart', 'Kiwify', 'Eduzz', 'Monetizze', 'Braip', 'ClickBank', 'Digistore24', 'BuyGoods', 'Stripe', 'PayPal'],
  adSources: ['Meta Ads', 'Google Ads', 'YouTube Ads', 'TikTok Ads', 'Taboola', 'Outbrain', 'Native', 'Bing Ads'],
  expenseCategories: [
    'Ferramentas / SaaS',
    'Equipe / Freelancers',
    'Copy / Criativos',
    'Hospedagem / Domínios',
    'Contabilidade',
    'Impostos (pagos)',
    'Contingência (perfis, BMs)',
    'Educação',
    'Bancárias / Câmbio',
    'Outros',
  ],
};

export function emptyDb(): Database {
  return { version: 1, settings: structuredClone(DEFAULT_SETTINGS), products: [], sales: [], ads: [], expenses: [], capital: [] };
}

/** Garante que um JSON vindo de backup/storage tenha todos os campos esperados. */
export function normalize(raw: unknown): Database {
  const base = emptyDb();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Database>;
  const arr = <T,>(x: T[] | undefined) => (Array.isArray(x) ? x : []);
  return {
    version: 1,
    settings: { ...base.settings, ...(r.settings || {}), rates: { ...base.settings.rates, ...(r.settings?.rates || {}) } },
    products: arr(r.products),
    sales: arr(r.sales),
    ads: arr(r.ads),
    expenses: arr(r.expenses),
    capital: arr(r.capital),
  };
}

function load(): Database {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : emptyDb();
  } catch {
    return emptyDb();
  }
}

let db: Database = load();
const listeners = new Set<() => void>();

function commit(next: Database) {
  db = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (err) {
    console.error('Falha ao salvar no navegador', err);
    alert('Não foi possível salvar os dados no navegador. Exporte um backup em Configurações.');
  }
  listeners.forEach((l) => l());
}

// Sincroniza entre abas abertas
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      db = load();
      listeners.forEach((l) => l());
    }
  });
}

export function useDb(): Database {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => db,
  );
}

export const getDb = () => db;

export function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

type Item<C extends Collection> = Database[C][number];

export function upsert<C extends Collection>(collection: C, item: Item<C>) {
  const list = db[collection] as Item<C>[];
  const exists = list.some((x) => x.id === item.id);
  const next = exists ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
  commit({ ...db, [collection]: next });
}

export function remove(collection: Collection, id: string) {
  commit({ ...db, [collection]: (db[collection] as { id: string }[]).filter((x) => x.id !== id) });
}

export function updateSettings(patch: Partial<Settings>) {
  commit({ ...db, settings: { ...db.settings, ...patch } });
}

export function replaceDb(next: Database) {
  commit(normalize(next));
}

/** Cotação padrão de uma moeda para a moeda base. */
export function defaultRate(currency: string): number {
  if (currency === db.settings.baseCurrency) return 1;
  return db.settings.rates[currency] ?? 1;
}
