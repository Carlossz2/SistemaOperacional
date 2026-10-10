// Sincronização com o Supabase.
//
// Garantias:
//  * Toda alteração entra numa fila persistida no navegador ANTES de ser enviada. Se a internet
//    cair ou o app fechar, a fila continua de onde parou na próxima abertura.
//  * A fila é enviada em ordem (produto antes da venda que o usa). Falhas temporárias são
//    repetidas com espera crescente; falhas definitivas (ex.: regra do banco) são mostradas e o
//    registro volta ao estado do servidor.
//  * Alterações feitas em outro aparelho / recebidas por webhook chegam em tempo real e, como
//    reserva, ao voltar para a aba.
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import type { Collection, Database, Settings } from '../types';
import { emptyDb, getDb, normalize, setDb, setWriteHook, type WriteOp } from '../store';
import { getCloudConfig } from './config';
import { fromRow, TABLE, toRow } from './mappers';

const COLLECTIONS: Collection[] = ['products', 'sales', 'ads', 'expenses', 'capital'];

// ------------------------------------------------------------------ cliente
let client: SupabaseClient | null = null;
let clientKey = '';

export function supabase(): SupabaseClient {
  const cfg = getCloudConfig();
  if (!cfg) throw new Error('Supabase não configurado');
  const k = `${cfg.url}|${cfg.anonKey}`;
  if (!client || clientKey !== k) {
    client = createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'gestor-dr:auth' },
    });
    clientKey = k;
  }
  return client;
}

// ------------------------------------------------------------------ status de salvamento
export type SyncState = 'idle' | 'loading' | 'saving' | 'saved' | 'offline' | 'error';
export interface SyncStatus {
  state: SyncState;
  pending: number;
  message?: string;
  lastSyncedAt?: number;
}

let status: SyncStatus = { state: 'idle', pending: 0 };
const statusListeners = new Set<() => void>();
function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  statusListeners.forEach((l) => l());
}
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      statusListeners.add(l);
      return () => statusListeners.delete(l);
    },
    () => status,
  );
}
export const getSyncStatus = () => status;

// ------------------------------------------------------------------ fila (outbox)
interface QueuedOp {
  seq: number;
  op: WriteOp;
}

let userId: string | null = null;
let queue: QueuedOp[] = [];
let seq = 0;
let flushing = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 2000;
let channel: RealtimeChannel | null = null;
let lastLoad = 0;
let cacheTimer: ReturnType<typeof setTimeout> | null = null;

const outboxKey = () => `gestor-dr:outbox:${userId}`;
const cacheKey = () => `gestor-dr:cache:${userId}`;

function persistQueue() {
  try {
    localStorage.setItem(outboxKey(), JSON.stringify(queue));
  } catch {
    /* sem espaço: a fila continua em memória */
  }
  setStatus({ pending: queue.length });
}

function scheduleCache() {
  if (cacheTimer) clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => {
    try {
      localStorage.setItem(cacheKey(), JSON.stringify(getDb()));
    } catch {
      /* cache é só conveniência para abrir offline */
    }
  }, 1500);
}

function enqueue(op: WriteOp) {
  // mantém a posição original da primeira operação do mesmo registro (preserva a ordem de dependência)
  const i = queue.findIndex((q) => q.op.collection === op.collection && q.op.id === op.id);
  if (i >= 0) queue[i] = { seq: queue[i].seq, op };
  else queue.push({ seq: ++seq, op });
  persistQueue();
  scheduleCache();
  void flush();
}

function rowFor(op: WriteOp): Record<string, unknown> {
  if (op.collection === 'settings') return { user_id: userId, data: op.item };
  if (op.kind !== 'upsert') return {};
  const mapper = toRow[op.collection] as (x: unknown) => Record<string, unknown>;
  return mapper(op.item);
}

async function send(op: WriteOp): Promise<{ error: { message: string; code?: string } | null; status: number }> {
  const sb = supabase();
  if (op.collection === 'settings') {
    const res = await sb.from('settings').upsert(rowFor(op), { onConflict: 'user_id' });
    return { error: res.error, status: res.status };
  }
  const table = TABLE[op.collection];
  if (op.kind === 'delete') {
    const res = await sb.from(table).delete().eq('id', op.id);
    return { error: res.error, status: res.status };
  }
  const res = await sb.from(table).upsert(rowFor(op), { onConflict: 'id' });
  return { error: res.error, status: res.status };
}

const transient = (statusCode: number) => statusCode === 0 || statusCode === 401 || statusCode === 408 || statusCode === 429 || statusCode >= 500;

function friendly(message: string, code?: string): string {
  if (code === '23503') return 'Este registro está ligado a outros (ex.: produto com vendas). Nada foi alterado no servidor.';
  if (code === '42501' || /row-level security/i.test(message)) return 'Sem permissão para alterar este registro (ex.: venda automática).';
  if (code === '23514') return 'Valor fora das regras do banco (ex.: número negativo).';
  return message;
}

export async function flush(): Promise<void> {
  if (flushing || !userId) return;
  flushing = true;
  try {
    while (queue.length && userId) {
      const head = queue[0];
      setStatus({ state: 'saving' });
      let result: Awaited<ReturnType<typeof send>>;
      try {
        result = await send(head.op);
      } catch (err) {
        result = { error: { message: (err as Error).message }, status: 0 };
      }
      if (!result.error) {
        // pode ter sido substituída enquanto enviava: só remove se ainda é a mesma
        if (queue[0] === head) queue.shift();
        persistQueue();
        retryDelay = 2000;
        continue;
      }
      if (transient(result.status)) {
        if (result.status === 401) await supabase().auth.refreshSession().catch(() => undefined);
        setStatus({ state: 'offline', message: 'Sem conexão com o servidor — as alterações estão guardadas e serão enviadas.' });
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => void flush(), retryDelay);
        retryDelay = Math.min(retryDelay * 2, 60_000);
        return;
      }
      // erro definitivo: descarta a operação e volta o registro ao estado do servidor
      queue.shift();
      persistQueue();
      setStatus({ state: 'error', message: friendly(result.error.message, result.error.code) });
      await reloadOne(head.op);
      continue;
    }
    if (status.state !== 'error') setStatus({ state: 'saved', message: undefined, lastSyncedAt: Date.now() });
  } finally {
    flushing = false;
  }
}

async function reloadOne(op: WriteOp) {
  const sb = supabase();
  if (op.collection === 'settings') {
    const { data } = await sb.from('settings').select('data').eq('user_id', userId!).maybeSingle();
    if (data) setDb({ ...getDb(), settings: normalize({ settings: data.data as Settings }).settings });
    return;
  }
  const { data } = await sb.from(TABLE[op.collection]).select('*').eq('id', op.id).maybeSingle();
  applyRow(op.collection, op.id, data ? (fromRow[op.collection] as (r: Record<string, unknown>) => unknown)(data) : null);
}

function applyRow(collection: Collection, id: string, item: unknown | null) {
  const cur = getDb();
  const list = cur[collection] as { id: string }[];
  const without = list.filter((x) => x.id !== id);
  setDb({ ...cur, [collection]: item ? [...without, item] : without });
  scheduleCache();
}

// ------------------------------------------------------------------ carregamento
async function fetchAll(table: string): Promise<Record<string, unknown>[]> {
  const sb = supabase();
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select('*').order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Aplica as operações ainda não enviadas por cima do que veio do servidor. */
function overlayQueue(base: Database): Database {
  let next = base;
  for (const { op } of queue) {
    if (op.collection === 'settings') {
      next = { ...next, settings: op.item };
      continue;
    }
    const list = (next[op.collection] as { id: string }[]).filter((x) => x.id !== op.id);
    next = { ...next, [op.collection]: op.kind === 'upsert' ? [...list, op.item] : list };
  }
  return next;
}

export async function reloadAll(): Promise<void> {
  if (!userId) return;
  setStatus({ state: status.pending ? status.state : 'loading' });
  const [settingsRes, ...lists] = await Promise.all([
    supabase().from('settings').select('data').eq('user_id', userId).maybeSingle(),
    ...COLLECTIONS.map((c) => fetchAll(TABLE[c])),
  ]);
  const base = emptyDb();
  if (!settingsRes.error && !settingsRes.data) {
    // primeiro acesso: grava as configurações padrão (cotações, fuso) para o servidor usar nos webhooks
    enqueue({ collection: 'settings', kind: 'upsert', id: 'settings', item: base.settings });
  }
  const loaded: Database = normalize({
    ...base,
    settings: (settingsRes.data?.data as Settings | undefined) ?? base.settings,
    ...Object.fromEntries(COLLECTIONS.map((c, i) => [c, lists[i].map((r) => (fromRow[c] as (r: Record<string, unknown>) => unknown)(r))])),
  });
  setDb(overlayQueue(loaded));
  lastLoad = Date.now();
  scheduleCache();
  if (!queue.length) setStatus({ state: 'saved', lastSyncedAt: Date.now(), message: undefined });
}

// ------------------------------------------------------------------ tempo real
function subscribe() {
  const sb = supabase();
  channel = sb.channel(`gestor-${userId}`);
  for (const c of COLLECTIONS) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: TABLE[c], filter: `user_id=eq.${userId}` }, (payload) => {
      const id = String((payload.new as { id?: string })?.id ?? (payload.old as { id?: string })?.id ?? '');
      if (!id || queue.some((q) => q.op.collection === c && q.op.id === id)) return; // alteração local pendente é mais nova
      if (payload.eventType === 'DELETE') applyRow(c, id, null);
      else applyRow(c, id, (fromRow[c] as (r: Record<string, unknown>) => unknown)(payload.new as Record<string, unknown>));
    });
  }
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'settings', filter: `user_id=eq.${userId}` }, (payload) => {
    if (queue.some((q) => q.op.collection === 'settings')) return;
    const data = (payload.new as { data?: Settings })?.data;
    if (data) setDb({ ...getDb(), settings: normalize({ settings: data }).settings });
  });
  channel.subscribe();
}

function onFocus() {
  if (document.visibilityState === 'visible' && Date.now() - lastLoad > 120_000) void reloadAll().catch(() => undefined);
}
function onOnline() {
  retryDelay = 2000;
  void flush();
}

// ------------------------------------------------------------------ ciclo de vida
export async function startCloud(uid: string): Promise<void> {
  if (userId === uid) return;
  stopCloud();
  userId = uid;
  try {
    queue = JSON.parse(localStorage.getItem(outboxKey()) || '[]');
  } catch {
    queue = [];
  }
  seq = queue.reduce((m, q) => Math.max(m, q.seq), 0);
  setWriteHook(enqueue);
  // abre na hora com o último estado conhecido (inclusive offline)
  try {
    const cached = localStorage.getItem(cacheKey());
    setDb(overlayQueue(cached ? normalize(JSON.parse(cached)) : emptyDb()));
  } catch {
    setDb(overlayQueue(emptyDb()));
  }
  setStatus({ pending: queue.length });
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onFocus);
  try {
    await reloadAll();
  } catch (err) {
    setStatus({ state: 'offline', message: `Sem conexão: mostrando os últimos dados salvos neste aparelho. (${(err as Error).message})` });
  }
  try {
    subscribe();
  } catch {
    /* tempo real é opcional: a aba recarrega ao voltar */
  }
  void flush();
}

export function stopCloud() {
  if (channel) void supabase().removeChannel(channel);
  channel = null;
  window.removeEventListener('online', onOnline);
  document.removeEventListener('visibilitychange', onFocus);
  if (retryTimer) clearTimeout(retryTimer);
  setWriteHook(null);
  userId = null;
  queue = [];
  setStatus({ state: 'idle', pending: 0, message: undefined });
}

export const currentUserId = () => userId;

/**
 * Envia um conjunto de dados (ex.: dados do modo local ou de um backup) para a nuvem.
 * Faz "upsert" em lotes na ordem certa; linhas automáticas são ignoradas.
 */
export async function importToCloud(data: Database, onProgress?: (msg: string) => void): Promise<number> {
  if (!userId) throw new Error('Faça login primeiro');
  const sb = supabase();
  let total = 0;
  const { error: sErr } = await sb.from('settings').upsert({ user_id: userId, data: data.settings }, { onConflict: 'user_id' });
  if (sErr) throw new Error(`Configurações: ${sErr.message}`);
  for (const c of COLLECTIONS) {
    const items = (data[c] as { origin?: string }[]).filter((x) => !x.origin || x.origin === 'manual');
    const rows = items.map((x) => (toRow[c] as (x: unknown) => Record<string, unknown>)(x));
    for (let i = 0; i < rows.length; i += 500) {
      onProgress?.(`Enviando ${c}: ${Math.min(i + 500, rows.length)}/${rows.length}`);
      const { error } = await sb.from(TABLE[c]).upsert(rows.slice(i, i + 500), { onConflict: 'id' });
      if (error) throw new Error(`${c}: ${friendly(error.message, error.code)}`);
    }
    total += rows.length;
  }
  await reloadAll();
  return total;
}

/** Backup completo da nuvem: dados do app + vendas individuais recebidas por webhook. */
export async function exportFull(): Promise<Record<string, unknown>> {
  const transactions = await fetchAll('transactions');
  const aliases = await fetchAll('product_aliases');
  return { ...getDb(), transactions, productAliases: aliases, exportedAt: new Date().toISOString() };
}
