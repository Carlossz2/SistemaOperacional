import { useMemo, useState } from 'react';
import { ADAPTERS, type PlatformKey } from '../../../supabase/functions/_shared/adapters.ts';
import { guessMapping, IMPORT_FIELDS, parseCsvTable, rowsToTxs, type FieldKey, type Mapping } from '../../../supabase/functions/_shared/sheet.ts';
import { Icon } from './Icon';
import { reloadAll, supabase } from '../lib/cloud/sync';
import { money, num, shortDate } from '../lib/format';
import { useDb } from '../lib/store';

const PLATFORMS: PlatformKey[] = ['hotmart', 'cakto', 'lastlink', 'ggcheckout', 'perfectpay'];
const CHUNK = 200;
const STATUS_PT: Record<string, string> = { approved: 'Aprovada', refunded: 'Reembolsada', chargeback: 'Chargeback', pending: 'Pendente', canceled: 'Cancelada' };
const STATUS_COUNT: Record<string, [string, string]> = {
  approved: ['aprovada', 'aprovadas'],
  refunded: ['reembolsada', 'reembolsadas'],
  chargeback: ['chargeback', 'chargebacks'],
  pending: ['pendente', 'pendentes'],
  canceled: ['cancelada', 'canceladas'],
};

type Cell = string | number | boolean | Date | null | undefined;

/** Lê CSV (UTF-8 ou Windows-1252) ou Excel (.xlsx) e devolve as linhas. */
async function readFile(file: File): Promise<Cell[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import('read-excel-file/browser');
    return (await readSheet(file)) as Cell[][];
  }
  if (/\.xls$/i.test(file.name)) throw new Error('Arquivo .xls (Excel antigo) não é suportado: salve como .xlsx ou .csv e envie de novo.');
  const buf = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('windows-1252').decode(buf);
  }
  const { headers, rows } = parseCsvTable(text);
  return [headers, ...rows];
}

/** Cabeçalho = linha (entre as 10 primeiras) que mais tem nomes de coluna reconhecidos. */
function headerRow(rows: Cell[][]): number {
  let best = 0;
  let score = -1;
  rows.slice(0, 10).forEach((r, i) => {
    const s = Object.keys(guessMapping(r)).length;
    if (s > score) {
      score = s;
      best = i;
    }
  });
  return best;
}

const show = (v: Cell) => (v instanceof Date ? v.toLocaleString('pt-BR') : v === null || v === undefined ? '' : String(v));

export function ImportSales({ onClose, defaultPlatform }: { onClose: () => void; defaultPlatform?: PlatformKey }) {
  const db = useDb();
  const [platform, setPlatform] = useState<PlatformKey>(defaultPlatform && (PLATFORMS.includes(defaultPlatform) || defaultPlatform === 'generic') ? defaultPlatform : 'hotmart');
  // "Outra plataforma": só o nome (Kiwify, Eduzz, Ticto…), sem precisar conectar
  const [otherName, setOtherName] = useState('');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<Cell[]>([]);
  const [rows, setRows] = useState<Cell[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [currency, setCurrency] = useState('BRL');
  const [assumeApproved, setAssumeApproved] = useState(true);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ imported: number; failed: { externalId: string; message: string }[] } | null>(null);
  const tz = db.settings.timezone || 'America/Sao_Paulo';

  const load = async (file: File) => {
    setError('');
    setResult(null);
    try {
      const all = (await readFile(file)).filter((r) => r.some((c) => show(c).trim() !== ''));
      const h = headerRow(all);
      if (all.length <= h + 1) throw new Error('Não encontrei vendas no arquivo.');
      setFileName(file.name);
      setHeaders(all[h]);
      setRows(all.slice(h + 1));
      setMapping(guessMapping(all[h]));
    } catch (err) {
      setError((err as Error).message);
      setRows([]);
    }
  };

  const preview = useMemo(() => (rows.length ? rowsToTxs(rows, mapping, { timezone: tz, currency, assumeApproved }) : null), [rows, mapping, tz, currency, assumeApproved]);
  const missing = IMPORT_FIELDS.filter((f) => f.required && mapping[f.key] === undefined).map((f) => f.label);
  const counts = useMemo(() => {
    const by: Record<string, number> = {};
    const gross: Record<string, number> = {};
    for (const i of preview?.items ?? []) {
      by[i.status] = (by[i.status] ?? 0) + 1;
      if (i.status === 'approved') gross[i.currency] = (gross[i.currency] ?? 0) + i.gross;
    }
    return { by, gross };
  }, [preview]);

  const run = async () => {
    if (!preview?.items.length) return;
    setError('');
    const items = preview.items;
    let imported = 0;
    const failed: { externalId: string; message: string }[] = [];
    setProgress({ done: 0, total: items.length });
    for (let i = 0; i < items.length; i += CHUNK) {
      const { data, error: e } = await supabase().functions.invoke('import-sales', {
        body: { platform, platformName: platform === 'generic' ? otherName.trim() : undefined, items: items.slice(i, i + CHUNK) },
      });
      if (e) {
        failed.push({ externalId: `lote ${i / CHUNK + 1}`, message: e.message });
      } else {
        imported += data.imported ?? 0;
        failed.push(...(data.failed ?? []));
      }
      setProgress({ done: Math.min(i + CHUNK, items.length), total: items.length });
    }
    setProgress(null);
    setResult({ imported, failed });
    void reloadAll().catch(() => undefined);
  };

  const setField = (key: FieldKey, v: string) => setMapping((m) => {
    const next = { ...m };
    if (v === '') delete next[key];
    else next[key] = Number(v);
    return next;
  });

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && !progress && onClose()}>
      <div className="modal modal-wide" role="dialog" aria-label="Importar lista de clientes">
        <div className="modal-head">
          <h2 style={{ margin: 0 }}>Importar lista de clientes / vendas</h2>
          <button type="button" className="ghost" onClick={onClose} aria-label="Fechar" disabled={Boolean(progress)}>
            <Icon name="close" />
          </button>
        </div>

        <div className="form-grid">
          <label className="field">
            Plataforma
            <select value={platform} onChange={(e) => setPlatform(e.target.value as PlatformKey)} disabled={Boolean(progress)}>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>{ADAPTERS[p].label}</option>
              ))}
              <option value="generic">Outra plataforma…</option>
            </select>
          </label>
          {platform === 'generic' && (
            <label className="field">
              Nome da plataforma
              <input value={otherName} onChange={(e) => setOtherName(e.target.value)} maxLength={40} placeholder="Ex.: Kiwify, Eduzz, Ticto" disabled={Boolean(progress)} />
            </label>
          )}
          <label className="field">
            Arquivo exportado (.csv ou .xlsx)
            <input type="file" accept=".csv,.txt,.xlsx" aria-label="Arquivo da planilha" disabled={Boolean(progress)} onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
          </label>
        </div>
        <p className="muted small" style={{ margin: '4px 0 12px' }}>
          Exporte o relatório de vendas no painel da plataforma (Hotmart: Vendas → Exportar; Cakto: Vendas/Pedidos → Exportar) e envie aqui.
          Vendas que já chegaram por webhook não duplicam, e uma venda reembolsada não volta a "aprovada".
        </p>
        {error && <p className="form-error">{error}</p>}

        {rows.length > 0 && preview && !result && (
          <>
            <h3 className="section-title">
              Colunas de "{fileName}" <span className="muted small">({num(rows.length)} linhas)</span>
            </h3>
            <div className="map-grid">
              {IMPORT_FIELDS.map((f) => (
                <label key={f.key} className="field">
                  <span>
                    {f.label}
                    {f.required && <b className="neg"> *</b>}
                  </span>
                  <select aria-label={f.label} value={mapping[f.key] ?? ''} onChange={(e) => setField(f.key, e.target.value)}>
                    <option value="">— não usar —</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {show(h) || `Coluna ${i + 1}`}
                        {rows[0]?.[i] !== undefined && show(rows[0][i]) ? ` (ex.: ${show(rows[0][i]).slice(0, 24)})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <label className="field">
                Moeda (se não houver coluna)
                <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {Object.keys(db.settings.rates).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            {mapping.status === undefined && (
              <label className="check" style={{ margin: '8px 0' }}>
                <input type="checkbox" checked={assumeApproved} onChange={(e) => setAssumeApproved(e.target.checked)} /> A planilha não tem status: considerar
                todas as vendas como aprovadas
              </label>
            )}

            {missing.length > 0 ? (
              <p className="form-error">Escolha a coluna de: {missing.join(', ')}.</p>
            ) : (
              <>
                <p className="small" style={{ margin: '12px 0 8px' }}>
                  <b>{num(preview.items.length)} venda(s) prontas</b>
                  {Object.entries(counts.by).map(([k, v]) => ` · ${num(v)} ${STATUS_COUNT[k]?.[v === 1 ? 0 : 1] ?? k}`).join('')}
                  {Object.keys(counts.gross).length > 0 && ` · aprovadas somam ${Object.entries(counts.gross).map(([c, v]) => money(v, c)).join(' + ')}`}
                  {preview.skipped.length > 0 && <span className="neg"> · {num(preview.skipped.length)} linha(s) ignorada(s)</span>}
                </p>
                {preview.skipped.length > 0 && (
                  <details className="small" style={{ marginBottom: 8 }}>
                    <summary style={{ cursor: 'pointer' }}>Ver linhas ignoradas</summary>
                    <ul className="muted">
                      {preview.skipped.slice(0, 20).map((s) => (
                        <li key={s.line}>Linha {s.line}: {s.reason}</li>
                      ))}
                      {preview.skipped.length > 20 && <li>… e mais {preview.skipped.length - 20}</li>}
                    </ul>
                  </details>
                )}
                <div className="table-wrap framed">
                  <table>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Código</th>
                        <th>Produto</th>
                        <th>Status</th>
                        <th className="num">Bruto</th>
                        <th className="num">Líquido / taxas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.items.slice(0, 6).map((i) => (
                        <tr key={i.externalId + i.productName}>
                          <td>{shortDate((i.approvedAt ?? i.occurredAt ?? '').slice(0, 10))}</td>
                          <td className="muted">{i.externalId}</td>
                          <td>{i.productName || i.productExternalId || '—'}</td>
                          <td>{STATUS_PT[i.status]}</td>
                          <td className="num">{money(i.gross, i.currency)}</td>
                          <td className="num muted">{i.net !== null ? money(i.net, i.currency) : i.fees !== null ? `taxa ${money(i.fees, i.currency)}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {result && (
          <div className="callout" style={{ marginTop: 12 }}>
            <h2>{num(result.imported)} venda(s) importada(s)</h2>
            <p>
              Já aparecem em Receitas, no Dashboard e nas outras abas.
              {result.failed.length > 0 && ` ${result.failed.length} não entraram: ${result.failed.slice(0, 3).map((f) => `${f.externalId} (${f.message})`).join('; ')}${result.failed.length > 3 ? '…' : ''}`}
            </p>
          </div>
        )}

        <div className="modal-foot" style={{ alignItems: 'center' }}>
          {progress && (
            <span className="muted small" role="status">
              Importando {num(progress.done)} de {num(progress.total)}…
            </span>
          )}
          <button type="button" onClick={onClose} disabled={Boolean(progress)}>
            {result ? 'Fechar' : 'Cancelar'}
          </button>
          {!result && (
            <button type="button" className="primary" onClick={run} disabled={Boolean(progress) || !preview?.items.length || missing.length > 0 || (platform === 'generic' && !otherName.trim())}>
              <Icon name="upload" size={15} /> Importar {preview?.items.length ? num(preview.items.length) : ''} venda(s)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
