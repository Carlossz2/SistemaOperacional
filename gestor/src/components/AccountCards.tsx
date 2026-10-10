import { useEffect, useState } from 'react';
import { getIdleMinutes, isHosted, setIdleMinutes, signOut } from './CloudGate';
import { getCloudConfig, setMode } from '../lib/cloud/config';
import { importToCloud, supabase, useSyncStatus } from '../lib/cloud/sync';
import { isCloudActive, LOCAL_KEY, normalize } from '../lib/store';
import { Icon } from './Icon';

/** Conta do administrador: sair, verificação em duas etapas e bloqueio por inatividade. */
export function SecurityCard() {
  const [email, setEmail] = useState('');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ error?: boolean; text: string } | null>(null);
  const [idle, setIdle] = useState(getIdleMinutes());

  const load = async () => {
    const sb = supabase();
    const { data } = await sb.auth.getUser();
    setEmail(data.user?.email ?? '');
    const { data: f } = await sb.auth.mfa.listFactors();
    setFactorId(f?.totp.find((x) => x.status === 'verified')?.id ?? null);
  };
  useEffect(() => {
    void load();
  }, []);

  const start = async () => {
    setMsg(null);
    const sb = supabase();
    // limpa tentativas anteriores não concluídas
    const { data: existing } = await sb.auth.mfa.listFactors();
    for (const f of existing?.all ?? []) if (f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Gestor DR ${new Date().toLocaleDateString('pt-BR')}` });
    if (error || !data || data.type !== 'totp') return setMsg({ error: true, text: error?.message ?? 'Falha ao iniciar' });
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };
  const confirmEnroll = async () => {
    if (!enroll) return;
    const { error } = await supabase().auth.mfa.challengeAndVerify({ factorId: enroll.id, code: code.replace(/\D/g, '') });
    if (error) return setMsg({ error: true, text: 'Código inválido. Confira o horário do celular e tente de novo.' });
    setEnroll(null);
    setCode('');
    setMsg({ text: 'Verificação em duas etapas ativada. A partir de agora o código será pedido em todo login.' });
    void load();
  };
  const disable = async () => {
    if (!factorId || !confirm('Desativar a verificação em duas etapas? Sua conta ficará protegida apenas pela senha.')) return;
    const { error } = await supabase().auth.mfa.unenroll({ factorId });
    setMsg(error ? { error: true, text: error.message } : { text: 'Verificação em duas etapas desativada.' });
    void load();
  };

  return (
    <div className="card mb">
      <div className="card-head">
        <div className="card-title">
          <span className="icon-box"><Icon name="lock" size={17} /></span>
          <h2>Conta e segurança</h2>
        </div>
        <button onClick={() => void signOut()}>
          <Icon name="logout" size={15} /> Sair
        </button>
      </div>
      <p className="small" style={{ marginTop: 0 }}>
        Administrador: <b>{email}</b>. Esta é a única conta com acesso — novos cadastros são bloqueados pelo banco de dados.
      </p>
      <div className="form-grid">
        <div>
          <b className="small">Verificação em duas etapas (2FA)</b>
          <p className="muted small" style={{ margin: '4px 0 8px' }}>
            {factorId
              ? '✓ Ativa. Sem o código do app autenticador, ninguém acessa os dados — nem com a sua senha.'
              : 'Recomendado. Exige um código do celular (Google Authenticator, Authy…) além da senha.'}
          </p>
          {factorId ? (
            <button className="danger" onClick={disable}>Desativar 2FA</button>
          ) : enroll ? null : (
            <button className="primary" onClick={start}>Ativar 2FA</button>
          )}
        </div>
        <label className="field">
          Sair automaticamente após inatividade
          <select
            value={idle}
            onChange={(e) => {
              setIdle(Number(e.target.value));
              setIdleMinutes(Number(e.target.value));
            }}
          >
            {[15, 30, 60, 120, 240, 480].map((m) => (
              <option key={m} value={m}>{m < 60 ? `${m} minutos` : `${m / 60} hora${m > 60 ? 's' : ''}`}</option>
            ))}
          </select>
          <span className="muted small">Vale para este aparelho.</span>
        </label>
      </div>
      {enroll && (
        <div className="card" style={{ background: 'var(--surface-2)', marginTop: 12 }}>
          <p className="small" style={{ marginTop: 0 }}>
            1. Escaneie o QR code no app autenticador (ou digite a chave). 2. Digite o código de 6 dígitos para confirmar.
          </p>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <img src={enroll.qr} alt="QR code do autenticador" width={160} height={160} style={{ background: '#fff', borderRadius: 8, padding: 6 }} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <p className="muted small">Chave manual:</p>
              <code className="small" style={{ wordBreak: 'break-all' }}>{enroll.secret}</code>
              <div className="url-box" style={{ marginTop: 10 }}>
                <input inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} aria-label="Código do autenticador" />
                <button className="primary" disabled={code.replace(/\D/g, '').length !== 6} onClick={confirmEnroll}>Confirmar</button>
                <button className="ghost" onClick={() => setEnroll(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {msg && <p className={msg.error ? 'form-error' : 'muted small'}>{msg.text}</p>}
    </div>
  );
}

function localData() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const db = normalize(JSON.parse(raw));
    const n = db.products.length + db.sales.length + db.ads.length + db.expenses.length + db.capital.length;
    return n ? { db, n } : null;
  } catch {
    return null;
  }
}

/** Status do banco na nuvem e envio dos dados que estavam só neste navegador. */
export function CloudCard() {
  const st = useSyncStatus();
  const cloud = isCloudActive();
  const local = localData();
  const [progress, setProgress] = useState('');

  if (!cloud) {
    return (
      <div className="card mb">
        <div className="card-title" style={{ marginBottom: 8 }}>
          <span className="icon-box"><Icon name="cloud" size={17} /></span>
          <h2 style={{ margin: 0 }}>Nuvem (Supabase)</h2>
        </div>
        <p className="muted small">
          Hoje os dados estão só neste navegador. Conecte o Supabase para ter login, acesso de qualquer aparelho, integrações com plataformas e Meta,
          e guardar tudo com segurança no longo prazo.
        </p>
        <button
          className="primary"
          onClick={() => {
            localStorage.removeItem('gestor-dr:mode');
            location.reload();
          }}
        >
          Conectar ao Supabase
        </button>
      </div>
    );
  }

  const migrate = async () => {
    if (!local) return;
    if (!confirm(`Enviar ${local.n} registro(s) deste navegador para a nuvem? Registros com o mesmo ID serão atualizados.`)) return;
    try {
      const n = await importToCloud(local.db, setProgress);
      localStorage.setItem(`${LOCAL_KEY}:migrado-${Date.now()}`, localStorage.getItem(LOCAL_KEY) ?? '');
      localStorage.removeItem(LOCAL_KEY);
      setProgress(`✓ ${n} registro(s) enviados para a nuvem.`);
    } catch (err) {
      setProgress(`Erro: ${(err as Error).message}. Nada foi apagado deste navegador; tente de novo.`);
    }
  };

  return (
    <div className="card mb">
      <div className="card-title" style={{ marginBottom: 8 }}>
        <span className="icon-box"><Icon name="cloud" size={17} /></span>
        <h2 style={{ margin: 0 }}>Nuvem (Supabase)</h2>
      </div>
      <p className="small" style={{ marginTop: 0 }}>
        <span className="badge">
          <i style={{ background: st.state === 'saved' ? 'var(--good-text)' : st.state === 'error' ? 'var(--bad-text)' : 'var(--series-2)' }} />
          {st.state === 'saved'
            ? 'Tudo salvo na nuvem'
            : st.state === 'offline'
              ? 'Sem conexão — alterações guardadas para enviar'
              : st.state === 'error'
                ? 'Erro ao salvar'
                : 'Sincronizando…'}
          {st.pending ? ` · ${st.pending} pendente(s)` : ''}
          {st.lastSyncedAt ? ` · última confirmação ${new Date(st.lastSyncedAt).toLocaleTimeString('pt-BR')}` : ''}
        </span>
      </p>
      {st.message && <p className={st.state === 'error' ? 'form-error' : 'muted small'}>{st.message}</p>}
      <p className="muted small">Projeto: {getCloudConfig()?.url}</p>
      {local && (
        <div className="callout" style={{ textAlign: 'left' }}>
          <b>Há {local.n} registro(s) salvos só neste navegador</b> (de antes de conectar a nuvem).
          <div className="toolbar" style={{ margin: '10px 0 0' }}>
            <button className="primary" onClick={migrate}>
              <Icon name="upload" size={15} /> Enviar para a nuvem
            </button>
          </div>
        </div>
      )}
      {progress && <p className="muted small">{progress}</p>}
      {!isHosted() && (
        <button
          className="ghost small"
          onClick={() => {
            if (!confirm('Desconectar deste banco neste navegador? Os dados continuam na nuvem.')) return;
            void signOut().then(() => {
              setMode('local');
              location.reload();
            });
          }}
        >
          Usar sem nuvem neste navegador
        </button>
      )}
    </div>
  );
}
