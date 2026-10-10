import { useRef, useState } from 'react';
import { emptyDb, getDb, isCloudActive, normalize, replaceDb, updateSettings, useDb } from '../lib/store';
import { CloudCard, SecurityCard } from '../components/AccountCards';
import { exportFull, importToCloud } from '../lib/cloud/sync';
import { download, fetchRates } from '../lib/io';
import { today } from '../lib/dates';
import { Icon } from '../components/Icon';
import { DecimalInput } from '../components/DecimalInput';
import { isIOS, promptInstall, usePwa } from '../lib/pwa';

function ListEditor({ label, values, onChange }: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(values.join('\n'));
  return (
    <label className="field">
      {label}
      <textarea
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(text.split('\n').map((s) => s.trim()).filter(Boolean))}
      />
      <span className="muted small">Um por linha. Salva ao sair do campo.</span>
    </label>
  );
}

export function Settings() {
  const db = useDb();
  const s = db.settings;
  const fileRef = useRef<HTMLInputElement>(null);
  const [newCur, setNewCur] = useState('');
  const [status, setStatus] = useState('');
  const pwa = usePwa();

  const counts = `${db.products.length} produtos · ${db.sales.length} receitas · ${db.ads.length} tráfego · ${db.expenses.length} despesas · ${db.capital.length} capital`;

  const cloud = isCloudActive();
  const importFile = async (file: File) => {
    let data;
    try {
      data = normalize(JSON.parse(await file.text()));
    } catch {
      return alert('Arquivo inválido. Use um backup .json exportado por este sistema.');
    }
    if (cloud) {
      if (!confirm(`Importar o backup para a nuvem?\n\nRegistros com o mesmo ID são atualizados; os demais são mantidos. Vendas automáticas não são alteradas.`)) return;
      try {
        const n = await importToCloud(data, setStatus);
        setStatus(`Backup importado: ${n} registro(s).`);
      } catch (err) {
        setStatus(`Erro ao importar: ${(err as Error).message}`);
      }
      return;
    }
    if (confirm(`Substituir TODOS os dados atuais pelo backup?\n\nBackup: ${data.sales.length} receitas, ${data.ads.length} lançamentos de tráfego.`)) {
      replaceDb(data);
      setStatus('Backup restaurado.');
    }
  };
  const exportBackup = async () => {
    if (!cloud) return download(`gestor-dr-backup-${today()}.json`, JSON.stringify(getDb(), null, 2));
    setStatus('Gerando backup completo (inclui vendas recebidas por webhook)…');
    try {
      const full = await exportFull();
      download(`gestor-dr-backup-${today()}.json`, JSON.stringify(full, null, 2));
      setStatus('Backup completo exportado.');
    } catch (err) {
      setStatus(`Erro ao exportar: ${(err as Error).message}`);
    }
  };

  const updateRates = async () => {
    setStatus('Buscando cotações…');
    try {
      const rates = await fetchRates(s.baseCurrency, Object.keys(s.rates));
      updateSettings({ rates: { ...s.rates, ...rates } });
      setStatus(`Cotações atualizadas em ${new Date().toLocaleString('pt-BR')}. Novos lançamentos usarão estes valores.`);
    } catch (err) {
      setStatus(`Não foi possível buscar cotações (${(err as Error).message}). Edite manualmente.`);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Configurações</h1>
          <p className="muted">Moedas, impostos, listas e backup.</p>
        </div>
      </div>
      {status && <div className="card mb small">{status}</div>}
      {cloud && <SecurityCard />}
      <CloudCard />

      <div className="card mb">
        <div className="card-head">
          <div className="card-title">
            <span className="icon-box">
              <Icon name="download" size={17} />
            </span>
            <h2>Instalar como aplicativo</h2>
          </div>
          {pwa.canInstall && (
            <button className="primary" onClick={promptInstall}>
              <Icon name="download" size={15} /> Instalar Gestor DR
            </button>
          )}
        </div>
        {pwa.installed ? (
          <p className="muted small" style={{ margin: 0 }}>Você já está usando o app instalado. Ele abre em janela própria e funciona offline.</p>
        ) : pwa.canInstall ? (
          <p className="muted small" style={{ margin: 0 }}>
            Instala no computador ou celular com ícone próprio, abre em janela própria e funciona offline.
          </p>
        ) : isIOS() ? (
          <p className="muted small" style={{ margin: 0 }}>
            No iPhone/iPad: abra este endereço no <b>Safari</b>, toque em <b>Compartilhar</b> (quadrado com seta) e depois em{' '}
            <b>Adicionar à Tela de Início</b>.
          </p>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            No Chrome ou Edge (computador e Android): clique no ícone de instalar na barra de endereço ou no menu ⋮ → <b>Instalar
            Gestor DR</b>. Se a opção não aparecer, abra o sistema pelo endereço publicado (GitHub Pages), não pela pré-visualização.
          </p>
        )}
      </div>

      <div className="grid cols-2 mb">
        <div className="card">
          <h2>Operação</h2>
          <div className="form-grid">
            <label className="field span-2">
              Nome da operação
              <input value={s.businessName} onChange={(e) => updateSettings({ businessName: e.target.value })} />
            </label>
            <label className="field span-2">
              Fuso horário das vendas (define o dia de cada venda recebida)
              <select value={s.timezone} onChange={(e) => updateSettings({ timezone: e.target.value })}>
                {['America/Sao_Paulo', 'America/Manaus', 'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Santiago', 'America/Argentina/Buenos_Aires', 'America/New_York', 'Europe/Lisbon', 'Europe/Madrid', 'UTC'].map((tz) => (
                  <option key={tz}>{tz}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Moeda base dos relatórios
              <input value={s.baseCurrency} disabled />
            </label>
            <label className="field">
              Imposto estimado (% sobre receita líquida)
              <DecimalInput value={s.taxRate} onChange={(taxRate) => updateSettings({ taxRate: Math.min(taxRate, 100) })} />
            </label>
          </div>
          <p className="muted small">
            Ex.: Simples Nacional Anexo III/V, ou 0 se você lança os impostos pagos como despesa (categoria “Impostos (pagos)”).
          </p>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Cotações padrão</h2>
            <button onClick={updateRates}><Icon name="refresh" size={16} /> Atualizar online</button>
          </div>
          <p className="muted small" style={{ marginTop: 0 }}>
            1 unidade da moeda = X {s.baseCurrency}. Cada lançamento guarda a cotação do dia — mudar aqui não altera o passado.
          </p>
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            {Object.entries(s.rates)
              .filter(([c]) => c !== s.baseCurrency)
              .map(([c, v]) => (
                <label key={c} className="field">
                  {c}
                  <DecimalInput
                    value={v}
                    onChange={(rate) => rate > 0 && updateSettings({ rates: { ...getDb().settings.rates, [c]: rate } })}
                  />
                </label>
              ))}
          </div>
          <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
            <input placeholder="Nova moeda (ex: JPY)" value={newCur} maxLength={3} onChange={(e) => setNewCur(e.target.value.toUpperCase())} />
            <button
              disabled={!/^[A-Z]{3}$/.test(newCur) || newCur in s.rates}
              onClick={() => {
                updateSettings({ rates: { ...s.rates, [newCur]: 1 } });
                setNewCur('');
              }}
            >
              <Icon name="plus" size={16} /> Adicionar
            </button>
          </div>
        </div>
      </div>

      <div className="card mb">
        <h2>Listas</h2>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <ListEditor label="Plataformas de venda" values={s.platforms} onChange={(platforms) => updateSettings({ platforms })} />
          <ListEditor label="Fontes de tráfego" values={s.adSources} onChange={(adSources) => updateSettings({ adSources })} />
          <ListEditor
            label="Categorias de despesa"
            values={s.expenseCategories}
            onChange={(expenseCategories) => updateSettings({ expenseCategories })}
          />
        </div>
      </div>

      <div className="card">
        <h2>Backup & dados</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          {cloud
            ? `Os dados ficam no seu banco Supabase (${counts}). Exporte um backup completo de tempos em tempos e guarde em local seguro.`
            : `Os dados ficam salvos neste navegador (${counts}). Exporte um backup regularmente e guarde em local seguro — ele também serve para levar os dados para outro computador.`}
        </p>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button className="primary" onClick={() => void exportBackup()}>
            <Icon name="download" size={16} /> Exportar backup
          </button>
          <button onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={16} /> Restaurar backup
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          {!cloud && (
            <button
              className="danger"
              onClick={() => confirm('Apagar TODOS os dados deste navegador? Exporte um backup antes.') && replaceDb(emptyDb())}
            >
              <Icon name="trash" size={16} /> Apagar tudo
            </button>
          )}
        </div>
      </div>
      <p className="muted small" style={{ marginTop: 16 }}>Versão do app: {__APP_VERSION__}</p>
    </>
  );
}
