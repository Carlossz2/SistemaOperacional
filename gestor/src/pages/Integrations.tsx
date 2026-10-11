import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ADAPTERS, type GenericMapping, type PlatformKey } from '../../../supabase/functions/_shared/adapters.ts';
import { getCloudConfig } from '../lib/cloud/config';
import { reloadAll, supabase } from '../lib/cloud/sync';
import { isCloudActive, useDb } from '../lib/store';
import { money } from '../lib/format';
import { today, addDays } from '../lib/dates';
import { Icon } from '../components/Icon';
import { DecimalInput } from '../components/DecimalInput';

export interface Integration {
  id: string;
  platform: PlatformKey | 'meta';
  name: string;
  token: string;
  enabled: boolean;
  default_product_id: string | null;
  config: Record<string, unknown>;
  last_event_at: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  created_at: string;
}
export interface SecretStatus {
  integration_id: string;
  has_secret: boolean;
  has_access_token: boolean;
}

export const SALES_PLATFORMS: PlatformKey[] = ['hotmart', 'cakto', 'lastlink', 'ggcheckout', 'perfectpay', 'generic'];
export const fmtDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const webhookUrl = (token: string) => `${getCloudConfig()?.url ?? ''}/functions/v1/webhook/${token}`;

export function useIntegrations() {
  const [list, setList] = useState<Integration[]>([]);
  const [secrets, setSecrets] = useState<Record<string, SecretStatus>>({});
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    const sb = supabase();
    const [{ data, error: e1 }, { data: st }] = await Promise.all([
      sb.from('integrations').select('*').order('created_at'),
      sb.rpc('integration_secret_status'),
    ]);
    if (e1) setError(e1.message);
    setList((data ?? []) as Integration[]);
    setSecrets(Object.fromEntries(((st ?? []) as SecretStatus[]).map((s) => [s.integration_id, s])));
    setLoaded(true);
  }, []);
  useEffect(() => {
    void reload();
    const sb = supabase();
    const ch = sb
      .channel(`integrations-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'integrations' }, () => void reload());
    ch.subscribe();
    // rede de segurança caso o tempo real caia
    const timer = setInterval(() => void reload(), 60_000);
    return () => {
      clearInterval(timer);
      void sb.removeChannel(ch);
    };
  }, [reload]);
  return { list, secrets, reload, error, loaded };
}

export function Integrations() {
  const [tab, setTab] = useState<'conexoes' | 'eventos' | 'vendas' | 'produtos'>('conexoes');
  if (!isCloudActive()) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>Integrações</h1>
            <p className="muted">Receba vendas por webhook e gastos da Meta automaticamente.</p>
          </div>
        </div>
        <div className="callout">
          <h2>Conecte o Supabase para usar integrações</h2>
          <p>
            Webhooks e a sincronização da Meta precisam de um servidor sempre ligado. Conecte seu projeto Supabase em{' '}
            <Link to="/configuracoes">Configurações</Link>.
          </p>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Integrações</h1>
          <p className="muted">Vendas por webhook (Hotmart, Cakto, Lastlink, GGCheckout, PerfectPay e outras) e gastos da Meta Ads.</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {(
          [
            ['conexoes', 'Conexões'],
            ['eventos', 'Eventos recebidos'],
            ['vendas', 'Vendas recebidas'],
            ['produtos', 'Produtos das plataformas'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'conexoes' && <Connections />}
      {tab === 'eventos' && <Events />}
      {tab === 'vendas' && <ReceivedSales />}
      {tab === 'produtos' && <Aliases />}
    </>
  );
}

// =================================================================== Conexões
function Connections() {
  const { list, secrets, reload, error } = useIntegrations();
  const [platform, setPlatform] = useState<PlatformKey>('hotmart');
  const [busy, setBusy] = useState(false);
  const sales = list.filter((i) => i.platform !== 'meta');
  const meta = list.filter((i) => i.platform === 'meta');

  const create = async (p: PlatformKey | 'meta') => {
    setBusy(true);
    const name = p === 'meta' ? 'Meta Ads' : p === 'generic' ? 'Nova plataforma' : ADAPTERS[p].label;
    const config = p === 'meta' ? { accountIds: [], rules: [], byCountry: true } : {};
    const { error: e } = await supabase().from('integrations').insert({ platform: p, name, config });
    setBusy(false);
    if (e) alert(e.message);
    await reload();
  };

  return (
    <>
      {error && <p className="form-error">{error}</p>}
      <div className="card mb">
        <div className="card-head">
          <div className="card-title">
            <span className="icon-box"><Icon name="plug" size={17} /></span>
            <h2>Plataformas de venda</h2>
          </div>
          <div className="head-actions">
            <select value={platform} onChange={(e) => setPlatform(e.target.value as PlatformKey)} aria-label="Plataforma">
              {SALES_PLATFORMS.map((p) => (
                <option key={p} value={p}>{ADAPTERS[p].label}</option>
              ))}
            </select>
            <button className="primary" disabled={busy} onClick={() => create(platform)}>
              <Icon name="plus" size={15} /> Adicionar
            </button>
          </div>
        </div>
        <p className="muted small" style={{ marginTop: 0 }}>
          Cada integração gera uma URL secreta. Cole essa URL no painel da plataforma, ative os eventos indicados e (recomendado) salve aqui o
          segredo/token da plataforma. Toda notificação recebida fica guardada em "Eventos recebidos".
        </p>
        {!sales.length && <div className="empty">Nenhuma plataforma conectada ainda.</div>}
        <div className="int-grid">
          {sales.map((i) => (
            <SalesIntegrationCard key={i.id} integ={i} secret={secrets[i.id]} onChange={reload} />
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="icon-box"><Icon name="ads" size={17} /></span>
            <h2>Meta Ads</h2>
          </div>
          {!meta.length && (
            <button className="primary" disabled={busy} onClick={() => create('meta')}>
              <Icon name="plus" size={15} /> Conectar Meta Ads
            </button>
          )}
        </div>
        {!meta.length && (
          <p className="muted small" style={{ margin: 0 }}>
            Puxa o gasto diário por campanha e país, de hora em hora, direto para "Tráfego pago".
          </p>
        )}
        {meta.map((i) => (
          <MetaCard key={i.id} integ={i} secret={secrets[i.id]} onChange={reload} />
        ))}
      </div>
    </>
  );
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="url-box">
      <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} aria-label="URL do webhook" />
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(value).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        <Icon name="copy" size={14} /> {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  );
}

function SecretField(p: { integId: string; label: string; has: boolean; kind: 'secret' | 'access_token'; onSaved: () => void }) {
  const { integId, label, has, kind } = p;
  const [value, setValue] = useState('');
  const [msg, setMsg] = useState('');
  const save = async (v: string) => {
    const { error } = await supabase().rpc('set_integration_secret', {
      p_integration_id: integId,
      p_secret: kind === 'secret' ? v : null,
      p_access_token: kind === 'access_token' ? v : null,
    });
    setMsg(error ? error.message : v ? 'Salvo com segurança' : 'Removido');
    setValue('');
    if (!error) p.onSaved();
  };
  return (
    <label className="field">
      {label}
      <div className="url-box">
        <input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder={has ? '•••••••• (salvo — digite para trocar)' : 'Cole aqui'} autoComplete="off" />
        <button disabled={!value.trim()} onClick={() => save(value.trim())}>Salvar</button>
        {has && (
          <button className="ghost danger" title="Remover" onClick={() => confirm('Remover o valor salvo?') && save('')}>
            <Icon name="trash" size={14} />
          </button>
        )}
      </div>
      <span className="muted small">{msg || (has ? 'Valor salvo (não é exibido por segurança).' : 'Nada salvo.')}</span>
    </label>
  );
}

export function SalesIntegrationCard({ integ, secret, onChange }: { integ: Integration; secret?: SecretStatus; onChange: () => void }) {
  const db = useDb();
  const adapter = ADAPTERS[integ.platform as PlatformKey];
  const cfg = integ.config as { feePercent?: number; defaultCountry?: string; amountsInCents?: boolean; mapping?: GenericMapping };
  const [name, setName] = useState(integ.name);
  const update = async (patch: Partial<Integration>) => {
    const { error } = await supabase().from('integrations').update(patch).eq('id', integ.id);
    if (error) alert(error.message);
    onChange();
  };
  const setCfg = (patch: Record<string, unknown>) => update({ config: { ...integ.config, ...patch } });

  return (
    <div className="card" style={{ background: 'var(--surface-2)' }}>
      <div className="card-head">
        <div>
          <b>{adapter.label}</b>
          {integ.platform === 'generic' && (
            <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== integ.name && update({ name })} style={{ marginLeft: 8, width: 160 }} aria-label="Nome" />
          )}
          <div className="badge" style={{ marginTop: 4 }}>
            <i style={{ background: integ.enabled ? 'var(--good-text)' : 'var(--muted)' }} />
            {integ.enabled ? 'Ativa' : 'Desativada'} · último evento: {fmtDateTime(integ.last_event_at)}
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={integ.enabled} onChange={(e) => update({ enabled: e.target.checked })} /> Ativa
        </label>
      </div>
      <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
        <label className="field">
          URL do webhook (cole na {adapter.label})
          <CopyField value={webhookUrl(integ.token)} />
        </label>
        <SecretField integId={integ.id} kind="secret" label={adapter.help.secretLabel} has={Boolean(secret?.has_secret)} onSaved={onChange} />
        <p className="muted small" style={{ margin: 0 }}>
          <b>Onde configurar:</b> {adapter.help.where}. <b>Eventos:</b> {adapter.help.events.join(', ')}.
        </p>
        <div className="form-grid">
          <label className="field">
            Taxa % (se a plataforma não informar)
            <DecimalInput value={cfg.feePercent ?? 0} onChange={(v) => setCfg({ feePercent: Math.min(v, 100) })} />
          </label>
          <label className="field">
            País padrão
            <input defaultValue={cfg.defaultCountry ?? 'BR'} maxLength={2} onBlur={(e) => setCfg({ defaultCountry: e.target.value.toUpperCase() || 'BR' })} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={Boolean(cfg.amountsInCents)} onChange={(e) => setCfg({ amountsInCents: e.target.checked })} />
          Valores chegam em centavos (ex.: 19700 = R$ 197,00)
        </label>
        {integ.platform === 'generic' && <GenericMappingEditor integ={integ} onSave={(mapping) => setCfg({ mapping })} />}
        <label className="field">
          Produto padrão (quando o evento não traz produto)
          <select value={integ.default_product_id ?? ''} onChange={(e) => update({ default_product_id: e.target.value || null })}>
            <option value="">— criar automaticamente pelo nome —</option>
            {db.products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <div className="toolbar" style={{ margin: 0 }}>
          <button
            onClick={async () => {
              if (!confirm('Gerar uma nova URL? A URL atual deixa de funcionar e você precisará atualizar na plataforma.')) return;
              const { error } = await supabase().rpc('rotate_integration_token', { p_integration_id: integ.id });
              if (error) alert(error.message);
              onChange();
            }}
          >
            <Icon name="refresh" size={14} /> Gerar nova URL
          </button>
          <button
            className="danger"
            onClick={async () => {
              if (!confirm(`Excluir a integração ${integ.name}? As vendas e eventos já recebidos continuam guardados.`)) return;
              const { error } = await supabase().from('integrations').delete().eq('id', integ.id);
              if (error) alert(error.message);
              onChange();
            }}
          >
            <Icon name="trash" size={14} /> Excluir
          </button>
        </div>
      </div>
    </div>
  );
}

const MAPPING_FIELDS: { key: keyof GenericMapping; label: string; required?: boolean }[] = [
  { key: 'externalId', label: 'ID da venda', required: true },
  { key: 'status', label: 'Status', required: true },
  { key: 'gross', label: 'Valor bruto', required: true },
  { key: 'fees', label: 'Taxas' },
  { key: 'net', label: 'Valor líquido' },
  { key: 'currency', label: 'Moeda' },
  { key: 'productId', label: 'ID do produto' },
  { key: 'productName', label: 'Nome do produto' },
  { key: 'country', label: 'País' },
  { key: 'date', label: 'Data da venda' },
  { key: 'email', label: 'E-mail do cliente' },
];

function GenericMappingEditor({ integ, onSave }: { integ: Integration; onSave: (m: GenericMapping) => void }) {
  const initial = (integ.config.mapping ?? {}) as Partial<GenericMapping>;
  const [m, setM] = useState<GenericMapping>({ externalId: '', status: '', gross: '', ...initial });
  const [statusMap, setStatusMap] = useState(JSON.stringify(initial.statusMap ?? {}, null, 0));
  const [preview, setPreview] = useState('');

  const parsedMap = () => {
    try {
      return JSON.parse(statusMap || '{}');
    } catch {
      return null;
    }
  };
  const test = async () => {
    const { data } = await supabase().from('webhook_events').select('payload').eq('integration_id', integ.id).order('id', { ascending: false }).limit(1);
    const payload = data?.[0]?.payload;
    if (!payload) return setPreview('Nenhum evento recebido ainda. Envie um teste pela plataforma e tente de novo.');
    const r = ADAPTERS.generic.parse(payload, { mapping: { ...m, statusMap: parsedMap() ?? {} } });
    setPreview(r.ignore ? `Seria ignorado: ${r.ignore}` : JSON.stringify(r.items, null, 2));
  };
  return (
    <details>
      <summary className="small" style={{ cursor: 'pointer' }}>Mapeamento de campos do JSON (obrigatório para "Outra plataforma")</summary>
      <p className="muted small">Informe o caminho de cada campo no JSON recebido, ex.: <code>data.amount</code> ou <code>items.0.name</code>.</p>
      <div className="form-grid">
        {MAPPING_FIELDS.map((f) => (
          <label key={f.key} className="field">
            {f.label}
            {f.required ? ' *' : ''}
            <input value={String(m[f.key] ?? '')} onChange={(e) => setM({ ...m, [f.key]: e.target.value })} />
          </label>
        ))}
        <label className="field span-2">
          Tradução de status (JSON), ex.: {'{"PAID":"approved","REFUNDED":"refunded"}'}
          <input value={statusMap} onChange={(e) => setStatusMap(e.target.value)} />
        </label>
      </div>
      <div className="toolbar" style={{ marginTop: 10 }}>
        <button
          className="primary"
          onClick={() => {
            const sm = parsedMap();
            if (sm === null) return alert('Tradução de status não é um JSON válido');
            onSave({ ...m, statusMap: sm });
          }}
        >
          Salvar mapeamento
        </button>
        <button onClick={test}>Testar com o último evento</button>
      </div>
      {preview && <pre className="code">{preview}</pre>}
    </details>
  );
}

export function MetaCard({ integ, secret, onChange }: { integ: Integration; secret?: SecretStatus; onChange: () => void }) {
  const db = useDb();
  const cfg = integ.config as { accountIds?: string[]; rules?: { contains: string; productId: string }[]; byCountry?: boolean; apiVersion?: string };
  const [accounts, setAccounts] = useState((cfg.accountIds ?? []).join('\n'));
  const [rules, setRules] = useState(cfg.rules ?? []);
  const [range, setRange] = useState('7');
  const [since, setSince] = useState(addDays(today(), -6));
  const [until, setUntil] = useState(today());
  const [syncMsg, setSyncMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const update = async (patch: Partial<Integration>) => {
    const { error } = await supabase().from('integrations').update(patch).eq('id', integ.id);
    if (error) alert(error.message);
    onChange();
  };
  const saveConfig = () =>
    update({
      config: {
        ...integ.config,
        accountIds: accounts.split(/[\s,;]+/).map((a) => a.trim()).filter(Boolean),
        rules: rules.filter((r) => r.contains.trim() && r.productId),
      },
    });

  const sync = async () => {
    setBusy(true);
    setSyncMsg('Sincronizando com a Meta…');
    const s = range === 'custom' ? since : addDays(today(), -(Number(range) - 1));
    const u = range === 'custom' ? until : today();
    const { data, error } = await supabase().functions.invoke('meta-sync', { body: { integrationId: integ.id, since: s, until: u } });
    setBusy(false);
    if (error) setSyncMsg(`Erro: ${error.message}`);
    else setSyncMsg((data?.results ?? []).map((r: { ok: boolean; message: string }) => `${r.ok ? '✓' : '✗'} ${r.message}`).join(' · ') || 'Nada a sincronizar');
    onChange();
    void reloadAll().catch(() => undefined);
  };

  return (
    <div className="form-grid">
      <SecretField integId={integ.id} kind="access_token" label="Token de acesso (permissão ads_read)" has={Boolean(secret?.has_access_token)} onSaved={onChange} />
      <label className="field">
        Contas de anúncio (uma por linha, ex.: act_1234567890)
        <textarea rows={3} value={accounts} onChange={(e) => setAccounts(e.target.value)} onBlur={saveConfig} />
      </label>
      <div className="span-2">
        <p className="muted small" style={{ margin: '0 0 6px' }}>
          <b>Campanha → produto:</b> se o nome da campanha contém o texto, o gasto vai para o produto. Sem regra, usa o produto padrão.
        </p>
        {rules.map((r, i) => (
          <div key={i} className="url-box" style={{ marginBottom: 6 }}>
            <input placeholder="trecho do nome da campanha, ex.: KETO" value={r.contains} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, contains: e.target.value } : x)))} onBlur={saveConfig} />
            <select value={r.productId} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, productId: e.target.value } : x)))} onBlur={saveConfig}>
              <option value="">Produto…</option>
              {db.products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button className="ghost danger" onClick={() => setRules(rules.filter((_, j) => j !== i))} aria-label="Remover regra">
              <Icon name="trash" size={14} />
            </button>
          </div>
        ))}
        <div className="toolbar" style={{ margin: 0 }}>
          <button onClick={() => setRules([...rules, { contains: '', productId: '' }])}><Icon name="plus" size={14} /> Regra</button>
          <button onClick={saveConfig}>Salvar regras</button>
        </div>
      </div>
      <label className="field">
        Produto padrão (campanhas sem regra)
        <select value={integ.default_product_id ?? ''} onChange={(e) => update({ default_product_id: e.target.value || null })}>
          <option value="">— sem produto —</option>
          {db.products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label className="check" style={{ alignSelf: 'end' }}>
        <input type="checkbox" checked={cfg.byCountry !== false} onChange={(e) => update({ config: { ...integ.config, byCountry: e.target.checked } })} />
        Separar gasto por país
      </label>
      <div className="span-2 toolbar" style={{ margin: 0 }}>
        <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Período da sincronização">
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="365">Últimos 12 meses</option>
          <option value="custom">Personalizado</option>
        </select>
        {range === 'custom' && (
          <>
            <input type="date" value={since} onChange={(e) => setSince(e.target.value)} aria-label="De" />
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} aria-label="Até" />
          </>
        )}
        <button className="primary" disabled={busy} onClick={sync}>
          <Icon name="refresh" size={14} /> Sincronizar agora
        </button>
        <label className="check">
          <input type="checkbox" checked={integ.enabled} onChange={(e) => update({ enabled: e.target.checked })} /> Sincronizar automaticamente (de hora em hora)
        </label>
      </div>
      <p className="span-2 muted small" style={{ margin: 0 }}>
        {syncMsg || (integ.last_sync_at ? `Última sincronização ${fmtDateTime(integ.last_sync_at)}: ${integ.last_sync_status ?? ''}` : 'Ainda não sincronizado.')}
      </p>
      <details className="span-2">
        <summary className="small" style={{ cursor: 'pointer' }}>Como gerar o token da Meta</summary>
        <ol className="small muted">
          <li>Em business.facebook.com → Configurações do negócio → Usuários do sistema, crie um usuário do sistema (Admin).</li>
          <li>Em "Atribuir ativos", dê acesso às suas contas de anúncio.</li>
          <li>Clique em "Gerar token", escolha seu app (crie um app do tipo Empresa em developers.facebook.com se precisar) e marque a permissão <b>ads_read</b>.</li>
          <li>Cole o token acima. Tokens de usuário do sistema não expiram.</li>
          <li>O ID da conta aparece no Gerenciador de Anúncios (act_ + números).</li>
        </ol>
      </details>
    </div>
  );
}

// =================================================================== Eventos
interface EventRow {
  id: number;
  received_at: string;
  platform: string;
  event_name: string | null;
  external_id: string | null;
  status: string;
  message: string | null;
  integration_id: string | null;
}
const STATUS_PT: Record<string, { label: string; tone: string }> = {
  processed: { label: 'Processado', tone: 'ok' },
  ignored: { label: 'Ignorado', tone: 'info' },
  error: { label: 'Erro', tone: 'warn' },
  unauthorized: { label: 'Segredo inválido', tone: 'warn' },
  received: { label: 'Recebido', tone: 'info' },
};

function Events() {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [status, setStatus] = useState('');
  const [limit, setLimit] = useState(50);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    let q = supabase()
      .from('webhook_events')
      .select('id, received_at, platform, event_name, external_id, status, message, integration_id')
      .order('id', { ascending: false })
      .limit(limit);
    if (status) q = q.eq('status', status);
    const { data } = await q;
    setRows((data ?? []) as EventRow[]);
  }, [status, limit]);

  useEffect(() => {
    void load();
    const sb = supabase();
    const ch = sb.channel('events-live').on('postgres_changes', { event: '*', schema: 'public', table: 'webhook_events' }, () => void load());
    ch.subscribe();
    return () => {
      void sb.removeChannel(ch);
    };
  }, [load]);

  const reprocess = async (body: Record<string, unknown>) => {
    setMsg('Reprocessando…');
    const { data, error } = await supabase().functions.invoke('reprocess', { body });
    setMsg(error ? `Erro: ${error.message}` : `Reprocessados: ${data.counts.processed} ok · ${data.counts.ignored} ignorados · ${data.counts.error} com erro`);
    void load();
    void reloadAll().catch(() => undefined);
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>Eventos recebidos</h2>
        <div className="head-actions">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Todos</option>
            {Object.entries(STATUS_PT).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <button onClick={() => reprocess({ statuses: ['error'] })}>
            <Icon name="refresh" size={14} /> Reprocessar com erro
          </button>
          <button onClick={() => void load()}>Atualizar</button>
        </div>
      </div>
      {msg && <p className="muted small">{msg}</p>}
      <div className="table-wrap framed">
        <table>
          <thead>
            <tr>
              <th>Recebido</th>
              <th>Plataforma</th>
              <th>Evento</th>
              <th>ID</th>
              <th>Status</th>
              <th>Resultado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{fmtDateTime(r.received_at)}</td>
                <td>{ADAPTERS[r.platform as PlatformKey]?.label ?? r.platform}</td>
                <td>{r.event_name ?? '—'}</td>
                <td className="muted">{r.external_id ?? '—'}</td>
                <td>
                  <span className={`status ${STATUS_PT[r.status]?.tone ?? 'info'}`}>{STATUS_PT[r.status]?.label ?? r.status}</span>
                </td>
                <td style={{ whiteSpace: 'normal', minWidth: 260, maxWidth: 520 }} className="small">{r.message ?? '—'}</td>
                <td>
                  <div className="row-actions">
                    <button
                      className="ghost"
                      title="Ver conteúdo recebido"
                      onClick={async () => {
                        const { data } = await supabase().from('webhook_events').select('payload, raw_body, headers').eq('id', r.id).single();
                        setDetail(data as Record<string, unknown>);
                      }}
                    >
                      <Icon name="eye" size={15} />
                    </button>
                    <button className="ghost" title="Reprocessar" onClick={() => reprocess({ ids: [r.id] })}>
                      <Icon name="refresh" size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">Nenhum evento recebido ainda. Envie um teste pela plataforma.</div>}
      </div>
      {rows.length >= limit && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button onClick={() => setLimit(limit + 100)}>Carregar mais</button>
        </div>
      )}
      {detail && (
        <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="modal" style={{ width: 'min(820px, 100%)' }}>
            <div className="modal-head">
              <h2 style={{ margin: 0 }}>Conteúdo recebido</h2>
              <button className="ghost" onClick={() => setDetail(null)} aria-label="Fechar"><Icon name="close" /></button>
            </div>
            <pre className="code">{JSON.stringify(detail.payload ?? detail.raw_body, null, 2)}</pre>
            <p className="muted small">Cabeçalhos (segredos mascarados):</p>
            <pre className="code" style={{ maxHeight: 200 }}>{JSON.stringify(detail.headers, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// =================================================================== Vendas recebidas
interface TxRow {
  id: string;
  sale_date: string | null;
  platform_label: string;
  external_id: string;
  status: string;
  product_name: string | null;
  currency: string;
  gross: number;
  fees: number;
  fees_estimated: boolean;
  country: string;
  buyer_email: string | null;
}
const TX_STATUS: Record<string, { label: string; tone: string }> = {
  approved: { label: 'Aprovada', tone: 'ok' },
  refunded: { label: 'Reembolsada', tone: 'warn' },
  chargeback: { label: 'Chargeback', tone: 'warn' },
  pending: { label: 'Pendente', tone: 'info' },
  canceled: { label: 'Cancelada', tone: 'info' },
};

/** Vendas individuais recebidas por webhook (ao vivo). Com `period`, só as do período. */
export function ReceivedSales({ period }: { period?: { from: string; to: string } }) {
  const [rows, setRows] = useState<TxRow[]>([]);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(50);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const sb = supabase();
    const ch = sb
      .channel(`tx-live-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'webhook_events' }, () => setTick((t) => t + 1));
    ch.subscribe();
    const timer = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => {
      clearInterval(timer);
      void sb.removeChannel(ch);
    };
  }, []);
  useEffect(() => {
    let query = supabase()
      .from('transactions')
      .select('id, sale_date, platform_label, external_id, status, product_name, currency, gross, fees, fees_estimated, country, buyer_email')
      .order('sale_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (status) query = query.eq('status', status);
    if (period) query = query.gte('sale_date', period.from).lte('sale_date', period.to);
    if (q.trim()) query = query.or(`external_id.ilike.%${q.trim()}%,buyer_email.ilike.%${q.trim()}%,product_name.ilike.%${q.trim()}%`);
    void query.then(({ data }) => setRows((data ?? []) as TxRow[]));
  }, [status, q, limit, period?.from, period?.to, tick]);

  return (
    <div className="card mb">
      <div className="card-head">
        <h2>Vendas recebidas por webhook</h2>
        <div className="head-actions">
          <label className="search">
            <Icon name="search" size={15} />
            <input placeholder="ID, e-mail ou produto" value={q} onChange={(e) => setQ(e.target.value.replace(/[,()]/g, ''))} />
          </label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Todos</option>
            {Object.entries(TX_STATUS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="table-wrap framed">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Plataforma</th>
              <th>Produto</th>
              <th>ID</th>
              <th>País</th>
              <th>Cliente</th>
              <th className="num">Bruto</th>
              <th className="num">Taxas</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.sale_date ? r.sale_date.split('-').reverse().join('/') : '—'}</td>
                <td>{r.platform_label}</td>
                <td>{r.product_name || '—'}</td>
                <td className="muted">{r.external_id}</td>
                <td>{r.country}</td>
                <td className="muted">{r.buyer_email ?? '—'}</td>
                <td className="num">{money(Number(r.gross), r.currency)}</td>
                <td className="num" title={r.fees_estimated ? 'Estimada pelo % configurado' : undefined}>
                  {money(Number(r.fees), r.currency)}
                  {r.fees_estimated ? '*' : ''}
                </td>
                <td>
                  <span className={`status ${TX_STATUS[r.status]?.tone ?? 'info'}`}>{TX_STATUS[r.status]?.label ?? r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">Nenhuma venda recebida ainda.</div>}
      </div>
      <p className="muted small">* taxa estimada pelo % configurado na integração (a plataforma não informou).</p>
      {rows.length >= limit && (
        <div style={{ textAlign: 'center' }}>
          <button onClick={() => setLimit(limit + 100)}>Carregar mais</button>
        </div>
      )}
    </div>
  );
}

// =================================================================== Produtos das plataformas
interface AliasRow {
  id: string;
  platform: string;
  external_id: string;
  external_name: string | null;
  product_id: string;
}

function Aliases() {
  const db = useDb();
  const [rows, setRows] = useState<AliasRow[]>([]);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    const { data } = await supabase().from('product_aliases').select('id, platform, external_id, external_name, product_id').order('created_at');
    setRows((data ?? []) as AliasRow[]);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const productName = useMemo(() => new Map(db.products.map((p) => [p.id, p.name])), [db.products]);

  return (
    <div className="card">
      <h2>Produtos das plataformas</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Cada produto vendido numa plataforma é ligado a um produto do Gestor (criado automaticamente na primeira venda). Para juntar ofertas — ex.: o
        mesmo produto na Hotmart e na Cakto — escolha o mesmo produto aqui. As vendas já recebidas são movidas na hora.
      </p>
      {msg && <p className="muted small">{msg}</p>}
      <div className="table-wrap framed">
        <table>
          <thead>
            <tr>
              <th>Plataforma</th>
              <th>Produto na plataforma</th>
              <th>ID externo</th>
              <th>Produto na CADIGITAL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{ADAPTERS[r.platform.split(':')[0] as PlatformKey]?.label ?? r.platform}</td>
                <td>{r.external_name || '—'}</td>
                <td className="muted">{r.external_id}</td>
                <td>
                  <select
                    value={r.product_id}
                    onChange={async (e) => {
                      const { error } = await supabase().from('product_aliases').update({ product_id: e.target.value }).eq('id', r.id);
                      setMsg(error ? error.message : `Vendas de "${r.external_name ?? r.external_id}" movidas para "${productName.get(e.target.value)}".`);
                      void load();
                      void reloadAll().catch(() => undefined);
                    }}
                  >
                    {db.products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">Os produtos aparecem aqui quando a primeira venda de cada um chegar.</div>}
      </div>
    </div>
  );
}
