import { useRef, useState } from 'react';
import { emptyDb, getDb, normalize, replaceDb, updateSettings, useDb } from '../lib/store';
import { download, fetchRates } from '../lib/io';
import { demoDb } from '../lib/demo';
import { today } from '../lib/dates';
import { Icon } from '../components/Icon';

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

  const counts = `${db.products.length} produtos · ${db.sales.length} receitas · ${db.ads.length} tráfego · ${db.expenses.length} despesas · ${db.capital.length} capital`;

  const importFile = async (file: File) => {
    try {
      const data = normalize(JSON.parse(await file.text()));
      if (confirm(`Substituir TODOS os dados atuais pelo backup?\n\nBackup: ${data.sales.length} receitas, ${data.ads.length} lançamentos de tráfego.`)) {
        replaceDb(data);
        setStatus('Backup restaurado.');
      }
    } catch {
      alert('Arquivo inválido. Use um backup .json exportado por este sistema.');
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

      <div className="grid cols-2 mb">
        <div className="card">
          <h2>Operação</h2>
          <div className="form-grid">
            <label className="field span-2">
              Nome da operação
              <input value={s.businessName} onChange={(e) => updateSettings({ businessName: e.target.value })} />
            </label>
            <label className="field">
              Moeda base dos relatórios
              <input value={s.baseCurrency} disabled />
            </label>
            <label className="field">
              Imposto estimado (% sobre receita líquida)
              <input
                type="number"
                step="0.1"
                min="0"
                value={s.taxRate}
                onChange={(e) => updateSettings({ taxRate: Number(e.target.value) || 0 })}
              />
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
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={v}
                    onChange={(e) => updateSettings({ rates: { ...s.rates, [c]: Number(e.target.value) } })}
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
          Os dados ficam salvos neste navegador ({counts}). Exporte um backup regularmente e guarde em local seguro —
          ele também serve para levar os dados para outro computador.
        </p>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button className="primary" onClick={() => download(`gestor-dr-backup-${today()}.json`, JSON.stringify(getDb(), null, 2))}>
            <Icon name="download" size={16} /> Exportar backup
          </button>
          <button onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={16} /> Restaurar backup
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          <button onClick={() => confirm('Substituir os dados atuais por dados de demonstração?') && replaceDb(demoDb())}>
            Carregar demonstração
          </button>
          <button
            className="danger"
            onClick={() => confirm('Apagar TODOS os dados deste navegador? Exporte um backup antes.') && replaceDb(emptyDb())}
          >
            <Icon name="trash" size={16} /> Apagar tudo
          </button>
        </div>
      </div>
    </>
  );
}
