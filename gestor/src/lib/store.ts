import { useSyncExternalStore } from 'react';
import type { Collection, Database, Settings } from './types';

// Estado do app em memória + persistência.
// Modo local: grava no localStorage. Modo nuvem: cada alteração vira uma operação que o
// módulo cloud/sync envia ao Supabase (com fila offline). As telas não precisam saber qual é.

export const LOCAL_KEY = 'gestor-dr:db';
const KEY = LOCAL_KEY;

export type WriteOp =
  | { collection: Collection; kind: 'upsert'; id: string; item: unknown }
  | { collection: Collection; kind: 'delete'; id: string }
  | { collection: 'settings'; kind: 'upsert'; id: 'settings'; item: Settings };

/** Quando definido (modo nuvem), recebe cada alteração em vez de gravar no localStorage. */
let writeHook: ((op: WriteOp) => void) | null = null;

export function setWriteHook(hook: ((op: WriteOp) => void) | null) {
  writeHook = hook;
}

export const DEFAULT_SETTINGS: Settings = {
  baseCurrency: 'BRL',
  rates: { BRL: 1, USD: 5.4, EUR: 5.9, GBP: 6.9, MXN: 0.3, COP: 0.0013, ARS: 0.0045, CLP: 0.0057, PEN: 1.45 },
  taxRate: 6,
  businessName: 'Minha Operação',
  timezone: 'America/Sao_Paulo',
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

export function loadLocal(): Database {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : emptyDb();
  } catch {
    return emptyDb();
  }
}

let db: Database = emptyDb();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function commit(next: Database, op?: WriteOp) {
  db = next;
  if (writeHook) {
    if (op) writeHook(op);
  } else {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch (err) {
      console.error('Falha ao salvar no navegador', err);
      alert('Não foi possível salvar os dados no navegador. Exporte um backup em Configurações.');
    }
  }
  notify();
}

/** Troca o estado sem gerar operações (carregamento inicial, dados vindos da nuvem). */
export function setDb(next: Database) {
  db = next;
  notify();
}

/** Inicia o modo local (dados do localStorage). */
export function startLocal() {
  writeHook = null;
  db = loadLocal();
  notify();
}

// Sincroniza entre abas abertas (modo local)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && !writeHook) {
      db = loadLocal();
      notify();
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
  commit({ ...db, [collection]: next }, { collection, kind: 'upsert', id: item.id, item });
}

export function remove(collection: Collection, id: string) {
  commit({ ...db, [collection]: (db[collection] as { id: string }[]).filter((x) => x.id !== id) }, { collection, kind: 'delete', id });
}

export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...db.settings, ...patch };
  commit({ ...db, settings }, { collection: 'settings', kind: 'upsert', id: 'settings', item: settings });
}

/** Substitui tudo (somente modo local: restaurar backup / apagar tudo). */
export function replaceDb(next: Database) {
  if (writeHook) throw new Error('No modo nuvem use a importação, que envia registro a registro.');
  commit(normalize(next));
}

export const isCloudActive = () => writeHook !== null;

/** Cotação padrão de uma moeda para a moeda base. */
export function defaultRate(currency: string): number {
  if (currency === db.settings.baseCurrency) return 1;
  return db.settings.rates[currency] ?? 1;
}
