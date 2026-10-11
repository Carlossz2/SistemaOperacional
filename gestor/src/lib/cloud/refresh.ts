// "Atualizar agora": puxa na hora o que normalmente chega sozinho de hora em hora
// (gasto da Meta e extrato do Mercado Pago) e recarrega todos os lançamentos do servidor.
import { addDays, today } from '../dates';
import { flush, reloadAll, supabase } from './sync';

interface IntegrationLite {
  id: string;
  platform: string;
  enabled: boolean;
  config: { lastRequestAt?: string } | null;
}

export interface RefreshResult {
  ok: boolean;
  /** Ex.: "Meta ✓ · Mercado Pago ✓" ou o motivo do erro */
  message: string;
}

/** Não pede relatório novo ao Mercado Pago mais de uma vez a cada 15 min (só importa os prontos). */
const MP_REQUEST_EVERY = 15 * 60_000;

export async function refreshNow(): Promise<RefreshResult> {
  const sb = supabase();
  await flush(); // envia antes o que estiver pendente
  const { data, error } = await sb.from('integrations').select('id, platform, enabled, config').in('platform', ['meta', 'mercadopago']);
  const parts: string[] = [];
  let ok = !error;
  const since = addDays(today(), -2);
  const until = today();
  const jobs = ((data ?? []) as IntegrationLite[]).map(async (i) => {
    const label = i.platform === 'meta' ? 'Meta' : 'Mercado Pago';
    const body =
      i.platform === 'meta'
        ? { integrationId: i.id, since, until }
        : {
            integrationId: i.id,
            since,
            until,
            action: Date.now() - (Date.parse(i.config?.lastRequestAt ?? '') || 0) > MP_REQUEST_EVERY ? 'sync' : 'import',
          };
    const res = await sb.functions.invoke(i.platform === 'meta' ? 'meta-sync' : 'bank-sync', { body });
    const failed = res.error || res.data?.ok === false;
    if (failed) ok = false;
    const why = res.error?.message ?? res.data?.results?.find((r: { ok: boolean }) => !r.ok)?.message;
    parts.push(failed ? `${label}: ${why ?? 'erro'}` : `${label} ✓`);
  });
  await Promise.all(jobs);
  await reloadAll();
  parts.sort((a, b) => Number(b.startsWith('Meta')) - Number(a.startsWith('Meta')));
  return { ok, message: parts.length ? parts.join(' · ') : 'Dados recarregados' };
}
