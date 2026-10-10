import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getCloudConfig, getMode, saveCloudConfig, setMode, validateConfig, envConfig } from '../lib/cloud/config';
import { currentUserId, startCloud, stopCloud, supabase } from '../lib/cloud/sync';
import { startLocal } from '../lib/store';
import { Icon } from './Icon';

const IDLE_KEY = 'gestor-dr:idle-minutes';
export const getIdleMinutes = () => {
  try {
    return Number(localStorage.getItem(IDLE_KEY)) || 60;
  } catch {
    return 60;
  }
};
export const setIdleMinutes = (m: number) => {
  try {
    localStorage.setItem(IDLE_KEY, String(m));
  } catch {
    /* ignora */
  }
};
const IDLE_FLAG = 'gestor-dr:idle-logout';
let lastActivity = Date.now();

/** Sistema hospedado com a conexão embutida: não oferece modo local nem troca de banco. */
export const isHosted = () => envConfig() !== null;

/** Encerra a sessão com segurança (limpa o cache local de dados). */
export async function signOut(reason?: 'idle') {
  if (reason === 'idle') sessionStorage.setItem(IDLE_FLAG, '1');
  const uid = currentUserId();
  stopCloud();
  if (uid) {
    try {
      localStorage.removeItem(`gestor-dr:cache:${uid}`);
    } catch {
      /* ignora */
    }
  }
  await supabase().auth.signOut().catch(() => undefined);
}

type Access = 'checking' | 'mfa' | 'denied' | 'ok';

/**
 * Porta de entrada do sistema:
 *  sem configuração -> conectar banco · sem sessão -> login · 2FA pendente -> código ·
 *  não é o administrador -> acesso negado · senão -> app.
 */
export function CloudGate({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState(isHosted() ? 'cloud' : getMode());
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [access, setAccess] = useState<Access>('checking');
  const [recheck, setRecheck] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (mode === 'local') {
      stopCloud();
      startLocal();
      setReady(true);
      return;
    }
    if (mode !== 'cloud') return;
    const sb = supabase();
    let alive = true;
    sb.auth.getSession().then(({ data }) => alive && setSession(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [mode]);

  // Verifica 2FA e se a conta é a do administrador
  useEffect(() => {
    if (mode !== 'cloud' || !session) return;
    let alive = true;
    (async () => {
      const sb = supabase();
      const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!alive) return;
      if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') return setAccess('mfa');
      const { data: ok, error } = await sb.rpc('gestor_access_ok');
      if (!alive) return;
      // sem rede: deixa entrar com o cache local; o banco continua protegendo os dados
      setAccess(error ? 'ok' : ok === true ? 'ok' : 'denied');
    })();
    return () => {
      alive = false;
    };
  }, [mode, session?.access_token, recheck]);

  useEffect(() => {
    if (mode !== 'cloud' || session === undefined) return;
    if (!session || access !== 'ok') {
      if (!session) {
        stopCloud();
        setAccess('checking');
      }
      setReady(false);
      return;
    }
    void startCloud(session.user.id).then(() => setReady(true));
    const t = setTimeout(() => setReady(true), 1500);
    return () => clearTimeout(t);
  }, [mode, session, access]);

  // Saída automática por inatividade (o relógio não é zerado pela renovação automática do login)
  const signedIn = Boolean(session) && access === 'ok';
  useEffect(() => {
    if (mode !== 'cloud' || !signedIn) return;
    lastActivity = Date.now();
    const touch = () => (lastActivity = Date.now());
    const events = ['mousemove', 'keydown', 'pointerdown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const check = () => {
      if (Date.now() - lastActivity > getIdleMinutes() * 60_000) void signOut('idle');
    };
    const timer = setInterval(check, 30_000);
    // ao voltar para a aba (ou o celular desbloquear), confere na hora
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [mode, signedIn]);

  if (!mode) return <Setup onDone={(m) => setModeState(m)} />;
  if (mode === 'cloud' && session === null)
    return (
      <Login
        onUseLocal={
          isHosted()
            ? undefined
            : () => {
                setMode('local');
                setModeState('local');
              }
        }
      />
    );
  if (mode === 'cloud' && session && access === 'mfa') return <MfaChallenge onDone={() => setRecheck((n) => n + 1)} />;
  if (mode === 'cloud' && session && access === 'denied') return <Denied />;
  if (!ready) return <Splash />;
  return <>{children}</>;
}

function MfaChallenge({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const sb = supabase();
    const { data } = await sb.auth.mfa.listFactors();
    const factor = data?.totp.find((f) => f.status === 'verified');
    if (!factor) {
      setBusy(false);
      return setError('Nenhum autenticador encontrado.');
    }
    const { error: err } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.replace(/\D/g, '') });
    setBusy(false);
    if (err) return setError('Código inválido ou expirado. Confira o horário do celular e tente de novo.');
    onDone();
  };
  return (
    <Shell title="Verificação em duas etapas" subtitle="Digite o código de 6 dígitos do seu app autenticador (Google Authenticator, Authy, 1Password…).">
      <form onSubmit={submit} className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
        <label className="field">
          Código
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="000000"
            style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center' }}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary" disabled={busy || code.replace(/\D/g, '').length !== 6} style={{ justifyContent: 'center' }}>
          {busy ? 'Verificando…' : 'Verificar'}
        </button>
      </form>
      <hr className="sep" />
      <button className="ghost small" style={{ width: '100%', justifyContent: 'center' }} onClick={() => void signOut()}>
        Sair
      </button>
    </Shell>
  );
}

function Denied() {
  return (
    <Shell title="Acesso negado" subtitle="Esta conta não é a conta de administrador deste sistema.">
      <button className="primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => void signOut()}>
        Sair
      </button>
    </Shell>
  );
}

function Splash() {
  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <span className="brand-logo" style={{ margin: '0 auto 14px', width: 40, height: 40 }}>
          <Icon name="logo" size={20} />
        </span>
        <p className="muted">Carregando seus dados…</p>
      </div>
    </div>
  );
}

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <span className="brand-logo">
            <Icon name="logo" size={16} />
          </span>
          <b>Gestor DR</b>
        </div>
        <h1>{title}</h1>
        <p className="muted" style={{ margin: '6px 0 18px' }}>
          {subtitle}
        </p>
        {children}
      </div>
    </div>
  );
}

export function Setup({ onDone }: { onDone: (m: 'cloud' | 'local') => void }) {
  const current = getCloudConfig() ?? envConfig();
  const [url, setUrl] = useState(current?.url ?? '');
  const [key, setKey] = useState(current?.anonKey ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    const cfg = { url, anonKey: key };
    const invalid = validateConfig(cfg);
    if (invalid) return setError(invalid);
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${url.trim().replace(/\/$/, '')}/auth/v1/settings`, { headers: { apikey: key.trim() } });
      if (res.status === 401 || res.status === 403) throw new Error('Chave recusada pelo Supabase. Confira a chave pública (anon).');
      if (!res.ok && res.status !== 404) throw new Error(`O Supabase respondeu ${res.status}. Confira a URL.`);
      saveCloudConfig(cfg);
      onDone('cloud');
    } catch (err) {
      setError(err instanceof TypeError ? 'Não foi possível acessar esta URL. Confira se está correta.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Conectar ao seu banco de dados" subtitle="Seus dados ficam guardados no seu projeto Supabase, com acesso de qualquer aparelho.">
      <form onSubmit={connect} className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
        <label className="field">
          URL do projeto
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxxxxxx.supabase.co" autoComplete="off" />
        </label>
        <label className="field">
          Chave pública (anon / publishable)
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="eyJhbGciOi… ou sb_publishable_…" autoComplete="off" />
          <span className="muted small">Supabase → Project Settings → API. Nunca use a chave secreta (service_role) aqui.</span>
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary" disabled={busy} style={{ justifyContent: 'center' }}>
          {busy ? 'Conectando…' : 'Conectar'}
        </button>
      </form>
      <hr className="sep" />
      <button
        className="ghost"
        style={{ width: '100%', justifyContent: 'center' }}
        onClick={() => {
          setMode('local');
          onDone('local');
        }}
      >
        Usar só neste navegador (sem nuvem, sem integrações)
      </button>
    </Shell>
  );
}

function Login({ onUseLocal }: { onUseLocal?: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [mode, setLoginMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [hasAdmin, setHasAdmin] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<{ error?: boolean; text: string } | null>(() =>
    sessionStorage.getItem(IDLE_FLAG) ? { text: 'Sessão encerrada por inatividade. Entre novamente.' } : null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    sessionStorage.removeItem(IDLE_FLAG);
    supabase()
      .rpc('gestor_has_admin')
      .then(({ data, error }) => {
        const exists = error ? true : data === true;
        setHasAdmin(exists);
        if (!exists) setLoginMode('signup');
      });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const auth = supabase().auth;
    try {
      if (mode === 'reset') {
        const { error } = await auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
        if (error) throw error;
        setMsg({ text: 'Se o e-mail existir, você receberá um link para criar uma nova senha.' });
      } else if (mode === 'signup') {
        if (password.length < 12) throw new Error('Use uma senha com pelo menos 12 caracteres.');
        if (password !== password2) throw new Error('As senhas não conferem.');
        const { data, error } = await auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) setMsg({ text: 'Conta criada. Confirme pelo link enviado ao seu e-mail e depois entre.' });
      } else {
        const { error } = await auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      const m = (err as Error).message;
      setMsg({
        error: true,
        text: /invalid login/i.test(m)
          ? 'E-mail ou senha incorretos.'
          : /already registered|already exists/i.test(m)
            ? 'Este e-mail já tem conta. Use "Entrar".'
            : /signups? not allowed|disabled|database error saving new user/i.test(m)
              ? 'Cadastro bloqueado: este sistema já tem um administrador.'
              : /rate limit|too many/i.test(m)
                ? 'Muitas tentativas. Aguarde alguns minutos.'
                : m,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title={mode === 'signup' ? 'Criar conta de administrador' : mode === 'reset' ? 'Recuperar senha' : 'Entrar'}
      subtitle={
        mode === 'signup'
          ? 'Primeiro acesso: esta será a única conta com acesso ao sistema. Depois dela, novos cadastros ficam bloqueados.'
          : 'Área restrita ao administrador.'
      }
    >
      <form onSubmit={submit} className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
        <label className="field">
          E-mail
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        {mode !== 'reset' && (
          <label className="field">
            Senha
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </label>
        )}
        {mode === 'signup' && (
          <label className="field">
            Repita a senha
            <input type="password" required value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
            <span className="muted small">Mínimo de 12 caracteres. Use um gerenciador de senhas.</span>
          </label>
        )}
        {msg && <p className={msg.error ? 'form-error' : 'muted small'}>{msg.text}</p>}
        <button className="primary" disabled={busy} style={{ justifyContent: 'center' }}>
          {busy ? 'Aguarde…' : mode === 'signup' ? 'Criar conta' : mode === 'reset' ? 'Enviar link' : 'Entrar'}
        </button>
      </form>
      <div className="auth-links">
        {mode !== 'login' && hasAdmin !== false && <button className="ghost" onClick={() => setLoginMode('login')}>Voltar para o login</button>}
        {mode === 'login' && <button className="ghost" onClick={() => setLoginMode('reset')}>Esqueci a senha</button>}
      </div>
      {onUseLocal && (
        <>
          <hr className="sep" />
          <button className="ghost small" style={{ width: '100%', justifyContent: 'center' }} onClick={onUseLocal}>
            Usar só neste navegador
          </button>
        </>
      )}
    </Shell>
  );
}
