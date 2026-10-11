// Sincronização da conta Mercado Pago (servidor). Usada pela função bank-sync (app) e pelo
// agendador de hora em hora (que já chama meta-sync).
import { MercadoPago, parseCsv, toMovements } from './mercadopago.ts';
import { type Admin, userSettings } from './server.ts';
import { dayIn } from './util.ts';

export interface BankIntegration {
  id: string;
  user_id: string;
  enabled: boolean;
  config: { imported?: string[]; lastRequestAt?: string; lastRequest?: { since: string; until: string } } & Record<string, unknown>;
}

const DAY = 86_400_000;
const shift = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const MAX_FILES_PER_RUN = 12;

async function client(sb: Admin, integ: BankIntegration): Promise<MercadoPago> {
  const { data: sec } = await sb.from('integration_secrets').select('access_token').eq('integration_id', integ.id).maybeSingle();
  if (!sec?.access_token) throw new Error('Access Token do Mercado Pago não configurado.');
  return new MercadoPago(sec.access_token);
}

/** Baixa os relatórios prontos que ainda não foram importados e grava as movimentações. */
async function importReady(sb: Admin, integ: BankIntegration, mp: MercadoPago, timezone: string) {
  const imported = new Set(integ.config.imported ?? []);
  const files = (await mp.listReports())
    .filter((f) => f.file_name.toLowerCase().endsWith('.csv') && !imported.has(f.file_name))
    .sort((a, b) => (a.date_created ?? a.file_name).localeCompare(b.date_created ?? b.file_name))
    .slice(-MAX_FILES_PER_RUN);
  let rows = 0;
  let done = 0;
  let unknownColumns = false;
  for (const f of files) {
    const csv = await mp.download(f.file_name);
    if (csv === null) continue; // ainda gerando
    const parsed = toMovements(parseCsv(csv), { userId: integ.user_id, integrationId: integ.id, timezone });
    unknownColumns ||= parsed.unknownColumns;
    for (let i = 0; i < parsed.movements.length; i += 500) {
      const { error } = await sb.from('bank_movements').upsert(parsed.movements.slice(i, i + 500), { onConflict: 'user_id,external_id' });
      if (error) throw new Error(`Gravação: ${error.message}`);
    }
    rows += parsed.movements.length;
    imported.add(f.file_name);
    done++;
  }
  return { files: done, waiting: files.length - done, rows, unknownColumns, imported: [...imported].slice(-300) };
}

/** Pede (opcionalmente) um relatório novo e importa o que estiver pronto. Atualiza o status da integração. */
export async function syncBank(sb: Admin, integ: BankIntegration, opts: { since?: string; until?: string; request: boolean }): Promise<string> {
  const settings = await userSettings(sb, integ.user_id);
  try {
    const mp = await client(sb, integ);
    await mp.ensureConfig(settings.timezone);
    const config = { ...integ.config };
    let requested = '';
    if (opts.request && opts.since && opts.until) {
      await mp.requestReport(opts.since, opts.until);
      config.lastRequestAt = new Date().toISOString();
      config.lastRequest = { since: opts.since, until: opts.until };
      requested = `Relatório de ${opts.since} a ${opts.until} pedido ao Mercado Pago (fica pronto em alguns minutos e entra sozinho). `;
    }
    const r = await importReady(sb, { ...integ, config }, mp, settings.timezone);
    config.imported = r.imported;
    const parts = [
      requested,
      r.files ? `${r.rows} movimentação(ões) importada(s) de ${r.files} relatório(s).` : 'Nenhum relatório novo pronto ainda.',
      r.waiting ? ` ${r.waiting} ainda sendo gerado(s).` : '',
      r.unknownColumns ? ' Atenção: colunas do relatório não reconhecidas — nada importado desse arquivo.' : '',
    ];
    const message = parts.join('').trim();
    await sb
      .from('integrations')
      .update({ config, last_sync_at: new Date().toISOString(), last_sync_status: `${r.unknownColumns ? 'erro' : 'ok'}: ${message}` })
      .eq('id', integ.id);
    return message;
  } catch (err) {
    const message = (err as Error).message;
    await sb.from('integrations').update({ last_sync_at: new Date().toISOString(), last_sync_status: `erro: ${message}` }).eq('id', integ.id);
    throw err;
  }
}

/** Agendador: para cada conta ativa, pede os últimos 3 dias (no máximo 1×/hora) e importa o que estiver pronto. */
export async function bankCron(sb: Admin): Promise<{ id: string; ok: boolean; message: string }[]> {
  const { data } = await sb.from('integrations').select('id, user_id, enabled, config').eq('platform', 'mercadopago').eq('enabled', true);
  const out: { id: string; ok: boolean; message: string }[] = [];
  const today = dayIn(new Date().toISOString());
  for (const integ of (data ?? []) as BankIntegration[]) {
    const last = Date.parse(integ.config?.lastRequestAt ?? '') || 0;
    const request = Date.now() - last > 55 * 60_000;
    try {
      out.push({ id: integ.id, ok: true, message: await syncBank(sb, { ...integ, config: integ.config ?? {} }, { since: shift(today, -2), until: today, request }) });
    } catch (err) {
      out.push({ id: integ.id, ok: false, message: (err as Error).message });
    }
  }
  return out;
}

export { shift as shiftDay };
