import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { DecimalInput } from '../components/DecimalInput';
import { supabase } from '../lib/cloud/sync';
import { today } from '../lib/dates';
import { money, num, shortDate } from '../lib/format';
import { isCloudActive, useDb } from '../lib/store';
import { backupIndex, backupNames } from '../lib/docBackup';

// Documentos da empresa: arquivo no Storage privado (bucket "documents", pasta = usuário) + dados na tabela documents.

const BUCKET = 'documents';
const MAX_BYTES = 25 * 1024 * 1024;
const CATEGORIES = ['Comprovante', 'Nota fiscal', 'Contrato', 'Extrato bancário', 'Imposto / guia', 'Fatura de anúncios', 'Documento da empresa', 'Outro'];

interface Doc {
  id: string;
  name: string;
  category: string;
  date: string;
  amount: number | null;
  notes: string | null;
  path: string;
  size: number;
  mime: string;
  created_at: string;
  deleted_at: string | null;
}

const fmtSize = (b: number) => (b >= 1024 * 1024 ? `${num(b / 1024 / 1024, 1)} MB` : `${num(Math.max(1, Math.round(b / 1024)))} KB`);
const baseName = (f: string) => f.replace(/\.[^.]+$/, '');
/** Nome seguro para o caminho do arquivo (o nome original fica na tabela). */
const safeName = (f: string) =>
  f
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(-120) || 'arquivo';
const LAST_BACKUP = 'cadigital.docs.lastBackup';
const readLastBackup = () => {
  try {
    return localStorage.getItem(LAST_BACKUP) ?? '';
  } catch {
    return '';
  }
};
const kindIcon = (mime: string) => (mime.includes('pdf') ? 'PDF' : mime.startsWith('image/') ? 'IMG' : /sheet|excel|csv/.test(mime) ? 'XLS' : /word|document/.test(mime) ? 'DOC' : 'ARQ');

export function Documents() {
  if (!isCloudActive()) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>Documentos</h1>
            <p className="muted">PDFs, comprovantes, notas fiscais e contratos da empresa.</p>
          </div>
        </div>
        <div className="callout">
          <h2>Conecte o Supabase para guardar documentos</h2>
          <p>
            Os arquivos ficam no armazenamento privado da nuvem. Conecte em <Link to="/configuracoes">Configurações</Link>.
          </p>
        </div>
      </>
    );
  }
  return <CloudDocuments />;
}

function CloudDocuments() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [year, setYear] = useState('');
  const [editing, setEditing] = useState<Doc | null>(null);
  const [uploading, setUploading] = useState(false);
  const [trash, setTrash] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const all: Doc[] = [];
    for (let from = 0; from < 50_000; from += 1000) {
      const { data, error: e } = await supabase().from('documents').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }).range(from, from + 999);
      if (e) {
        setError(e.message);
        break;
      }
      all.push(...((data ?? []) as Doc[]));
      if (!data || data.length < 1000) break;
    }
    setDocs(all.map((d) => ({ ...d, amount: d.amount === null ? null : Number(d.amount), size: Number(d.size) })));
    setLoaded(true);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(() => docs.filter((d) => !d.deleted_at), [docs]);
  const trashed = useMemo(() => docs.filter((d) => d.deleted_at), [docs]);
  const shown = trash ? trashed : active;
  const years = useMemo(() => [...new Set(shown.map((d) => d.date.slice(0, 4)))].sort().reverse(), [shown]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return shown.filter(
      (d) => (!cat || d.category === cat) && (!year || d.date.startsWith(year)) && (!needle || `${d.name} ${d.notes ?? ''} ${d.path}`.toLowerCase().includes(needle)),
    );
  }, [shown, q, cat, year]);
  const totalSize = active.reduce((a, d) => a + d.size, 0);

  const open = async (d: Doc, download: boolean) => {
    // abre a aba já no clique (senão o bloqueador de pop-up barra) e aponta para o link de 60 s quando ficar pronto
    const tab = download ? null : window.open('', '_blank');
    if (tab) tab.opener = null;
    const { data, error: e } = await supabase().storage.from(BUCKET).createSignedUrl(d.path, 60, download ? { download: d.name + (d.path.match(/\.[^.]+$/)?.[0] ?? '') } : undefined);
    if (e || !data) {
      tab?.close();
      return alert(`Não foi possível abrir: ${e?.message ?? 'erro'}`);
    }
    if (tab) tab.location.href = data.signedUrl;
    else window.location.assign(data.signedUrl);
  };

  // nada é apagado de vez: "Excluir" manda para a lixeira (o banco nem permite apagar o documento ou o arquivo)
  const setDeleted = async (d: Doc, deleted: boolean) => {
    const { error: e } = await supabase().from('documents').update({ deleted_at: deleted ? new Date().toISOString() : null }).eq('id', d.id);
    if (e) return alert(e.message);
    setNotice(deleted ? `"${d.name}" foi para a lixeira. Dá para restaurar quando quiser.` : `"${d.name}" restaurado.`);
    await load();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Documentos</h1>
          <p className="muted">PDFs, comprovantes, notas fiscais, contratos e guias — guardados no armazenamento privado, só você acessa.</p>
        </div>
      </div>

      <BackupCard docs={docs} />

      <Upload busy={uploading} setBusy={setUploading} onDone={load} />

      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="icon-box"><Icon name="file" size={17} /></span>
            <h2>Arquivos</h2>
            <span className="muted small">
              {trash ? `${num(trashed.length)} na lixeira` : `${num(active.length)} documento(s) · ${fmtSize(totalSize)}`}
            </span>
          </div>
          <div className="head-actions">
            <button className={trash ? 'primary' : ''} onClick={() => setTrash(!trash)} aria-pressed={trash}>
              <Icon name="trash" size={15} /> {trash ? 'Voltar aos documentos' : `Lixeira (${num(trashed.length)})`}
            </button>
            <label className="search">
              <Icon name="search" size={15} />
              <input placeholder="Buscar documento" aria-label="Buscar documento" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <select aria-label="Categoria" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">Todas as categorias</option>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select aria-label="Ano" value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">Todos os anos</option>
              {years.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>
        {error && <p className="form-error">{error}</p>}
        {notice && (
          <p className="small" role="status">
            {notice}
          </p>
        )}
        {trash && <p className="muted small">Documentos na lixeira continuam guardados (arquivo e dados) e entram na cópia de segurança. Restaure quando quiser.</p>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Documento</th>
                <th>Categoria</th>
                <th className="num">Valor</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td>{shortDate(d.date)}</td>
                  <td>
                    <button className="link" onClick={() => void open(d, false)} title="Abrir">
                      <span className="file-badge">{kindIcon(d.mime)}</span> {d.name}
                    </button>
                    <div className="muted small">
                      {fmtSize(d.size)}
                      {d.notes ? ` · ${d.notes}` : ''}
                    </div>
                  </td>
                  <td><span className="pill">{d.category}</span></td>
                  <td className="num">{d.amount === null ? '—' : money(d.amount, 'BRL')}</td>
                  <td>
                    <div className="row-actions">
                      <button className="ghost" title="Baixar" aria-label={`Baixar ${d.name}`} onClick={() => void open(d, true)}>
                        <Icon name="download" size={16} />
                      </button>
                      {trash ? (
                        <button className="ghost" title="Restaurar" aria-label={`Restaurar ${d.name}`} onClick={() => void setDeleted(d, false)}>
                          <Icon name="refresh" size={16} />
                        </button>
                      ) : (
                        <>
                          <button className="ghost" title="Editar" aria-label={`Editar ${d.name}`} onClick={() => setEditing(d)}>
                            <Icon name="edit" size={16} />
                          </button>
                          <button className="ghost danger" title="Mover para a lixeira" aria-label={`Excluir ${d.name}`} onClick={() => void setDeleted(d, true)}>
                            <Icon name="trash" size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loaded && !rows.length && <div className="empty">{trash ? (trashed.length ? 'Nenhum documento com esse filtro.' : 'A lixeira está vazia.') : active.length ? 'Nenhum documento com esse filtro.' : 'Nenhum documento ainda. Envie o primeiro acima.'}</div>}
        </div>
      </div>

      {editing && <EditDoc doc={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </>
  );
}

/** Cópia de segurança: baixa todos os arquivos (inclusive da lixeira) num ZIP organizado por categoria, com índice. */
function BackupCard({ docs }: { docs: Doc[] }) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [last, setLast] = useState(readLastBackup);

  const run = async () => {
    if (!docs.length) return;
    setMsg('');
    const names = backupNames(docs);
    const files: Record<string, Uint8Array> = {};
    const missing = new Set<string>();
    for (let i = 0; i < docs.length; i++) {
      setBusy(`Baixando ${i + 1} de ${docs.length}…`);
      const { data, error } = await supabase().storage.from(BUCKET).download(docs[i].path);
      if (error || !data) missing.add(docs[i].path);
      else files[names[i]] = new Uint8Array(await data.arrayBuffer());
    }
    setBusy('Montando o ZIP…');
    const { zipSync, strToU8 } = await import('fflate');
    files['indice-documentos.csv'] = strToU8(backupIndex(docs, names, missing));
    const zip = zipSync(files, { level: 0 }); // PDF e imagem já vêm comprimidos: só empacota
    const url = URL.createObjectURL(new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `CADIGITAL-documentos-${today()}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setBusy('');
    if (missing.size) setMsg(`${missing.size} arquivo(s) não baixaram (marcados no índice). Tente de novo.`);
    else {
      const now = new Date().toISOString();
      try {
        localStorage.setItem(LAST_BACKUP, now);
      } catch {
        /* sem armazenamento local: só não lembra a data */
      }
      setLast(now);
      setMsg(`Cópia pronta: ${docs.length} documento(s). Guarde o ZIP no Google Drive ou num HD externo.`);
    }
  };

  const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000) : null;
  const late = docs.length > 0 && (days === null || days >= 7);
  return (
    <div className={`card mb ${late ? 'backup-late' : ''}`}>
      <div className="card-head" style={{ marginBottom: 0 }}>
        <div className="card-title">
          <span className="icon-box"><Icon name="shield" size={17} /></span>
          <div>
            <h2>Cópia de segurança</h2>
            <p className="muted small" style={{ margin: 0 }}>
              Nada é apagado de vez pelo sistema. Mesmo assim, guarde uma cópia fora daqui:{' '}
              {last ? `última cópia neste aparelho ${days === 0 ? 'hoje' : `há ${days} dia(s)`}` : 'nenhuma cópia baixada neste aparelho ainda'}
              {late ? ' — recomendado 1× por semana.' : '.'}
            </p>
          </div>
        </div>
        <button className="primary" onClick={() => void run()} disabled={!!busy || !docs.length}>
          <Icon name="download" size={15} /> {busy || 'Baixar tudo (ZIP)'}
        </button>
      </div>
      {msg && (
        <p className="small" role="status" style={{ margin: '10px 0 0' }}>
          {msg}
        </p>
      )}
    </div>
  );
}

function Upload({ busy, setBusy, onDone }: { busy: boolean; setBusy: (b: boolean) => void; onDone: () => Promise<void> }) {
  const db = useDb();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [category, setCategory] = useState('Comprovante');
  const [date, setDate] = useState(today());
  const [name, setName] = useState('');
  const [amount, setAmount] = useState(0);
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState('');
  const [drag, setDrag] = useState(false);

  const pick = (list: FileList | null) => {
    const arr = [...(list ?? [])];
    const big = arr.filter((f) => f.size > MAX_BYTES);
    setFiles(arr.filter((f) => f.size <= MAX_BYTES));
    setName(arr.length === 1 ? baseName(arr[0].name) : '');
    setMsg(big.length ? `Arquivo(s) acima de 25 MB ignorado(s): ${big.map((f) => f.name).join(', ')}` : '');
  };

  const send = async () => {
    if (!files.length) return;
    setBusy(true);
    setMsg('');
    const sb = supabase();
    const { data: u } = await sb.auth.getUser();
    const userId = u.user?.id;
    if (!userId) {
      setBusy(false);
      return setMsg('Faça login novamente.');
    }
    let ok = 0;
    const failed: string[] = [];
    for (const f of files) {
      const path = `${userId}/${crypto.randomUUID()}-${safeName(f.name)}`;
      const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
      if (up.error) {
        failed.push(`${f.name} (${up.error.message})`);
        continue;
      }
      const { error } = await sb.from('documents').insert({
        name: (files.length === 1 && name.trim()) || baseName(f.name),
        category,
        date,
        amount: files.length === 1 && amount > 0 ? amount : null,
        notes: notes.trim() || null,
        path,
        size: f.size,
        mime: f.type || '',
      });
      if (error) {
        await sb.storage.from(BUCKET).remove([path]); // não deixa arquivo órfão
        failed.push(`${f.name} (${error.message})`);
        continue;
      }
      ok++;
    }
    setBusy(false);
    setMsg(`${ok} arquivo(s) guardado(s).${failed.length ? ` Não enviados: ${failed.join('; ')}` : ''}`);
    if (ok) {
      setFiles([]);
      setName('');
      setAmount(0);
      setNotes('');
      if (input.current) input.current.value = '';
    }
    await onDone();
  };

  return (
    <div className="card mb">
      <div
        className={`dropzone ${drag ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          pick(e.dataTransfer.files);
        }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      >
        <Icon name="upload" size={22} />
        <div>
          <b>{files.length ? `${files.length} arquivo(s) selecionado(s)` : 'Arraste os arquivos aqui ou clique para escolher'}</b>
          <div className="muted small">
            {files.length ? files.map((f) => `${f.name} (${fmtSize(f.size)})`).join(' · ') : 'PDF, imagens, planilhas e outros — até 25 MB cada'}
          </div>
        </div>
        <input ref={input} type="file" multiple hidden aria-label="Escolher arquivos" onChange={(e) => pick(e.target.files)} />
      </div>
      {files.length > 0 && (
        <div className="form-grid" style={{ marginTop: 14 }}>
          {files.length === 1 && (
            <label className="field span-2">
              Nome do documento
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={300} />
            </label>
          )}
          <label className="field">
            Categoria
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Data do documento
            <input type="date" value={date} onChange={(e) => setDate(e.target.value || today())} />
          </label>
          {files.length === 1 && (
            <label className="field">
              Valor ({db.settings.baseCurrency}, opcional)
              <DecimalInput value={amount} onChange={setAmount} />
            </label>
          )}
          <label className="field">
            Observações (opcional)
            <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          </label>
          <div className="span-2 toolbar" style={{ margin: 0, justifyContent: 'flex-end' }}>
            <button onClick={() => pick(null)} disabled={busy}>Cancelar</button>
            <button className="primary" onClick={() => void send()} disabled={busy}>
              <Icon name="upload" size={15} /> {busy ? 'Enviando…' : `Guardar ${files.length} arquivo(s)`}
            </button>
          </div>
        </div>
      )}
      {msg && (
        <p className="small" role="status" style={{ margin: '10px 0 0' }}>
          {msg}
        </p>
      )}
    </div>
  );
}

function EditDoc({ doc, onClose, onSaved }: { doc: Doc; onClose: () => void; onSaved: () => Promise<void> }) {
  const [d, setD] = useState({ name: doc.name, category: doc.category, date: doc.date, amount: doc.amount ?? 0, notes: doc.notes ?? '' });
  const [err, setErr] = useState('');
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase()
      .from('documents')
      .update({ name: d.name.trim() || doc.name, category: d.category, date: d.date, amount: d.amount > 0 ? d.amount : null, notes: d.notes.trim() || null })
      .eq('id', doc.id);
    if (error) return setErr(error.message);
    await onSaved();
    onClose();
  };
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={save}>
        <div className="modal-head">
          <h2 style={{ margin: 0 }}>Editar documento</h2>
          <button type="button" className="ghost" onClick={onClose} aria-label="Fechar">
            <Icon name="close" />
          </button>
        </div>
        <div className="form-grid">
          <label className="field span-2">
            Nome
            <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} maxLength={300} required />
          </label>
          <label className="field">
            Categoria
            <select value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })}>
              {[...new Set([...CATEGORIES, doc.category])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Data
            <input type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value || doc.date })} />
          </label>
          <label className="field">
            Valor (opcional)
            <DecimalInput value={d.amount} onChange={(amount) => setD({ ...d, amount })} />
          </label>
          <label className="field">
            Observações
            <input value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} maxLength={2000} />
          </label>
        </div>
        {err && <p className="form-error">{err}</p>}
        <div className="modal-foot">
          <button type="button" onClick={onClose}>Cancelar</button>
          <button type="submit" className="primary">Salvar</button>
        </div>
      </form>
    </div>
  );
}
