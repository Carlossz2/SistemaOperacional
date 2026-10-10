// Onde os dados ficam: "cloud" (Supabase) ou "local" (só neste navegador).
// A conexão pode vir das variáveis de build (VITE_SUPABASE_URL/ANON_KEY) ou ser informada na tela inicial.

export type Mode = 'cloud' | 'local';

export interface CloudConfig {
  url: string;
  anonKey: string;
}

const CONFIG_KEY = 'gestor-dr:supabase';
const MODE_KEY = 'gestor-dr:mode';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function envConfig(): CloudConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && anonKey ? { url: normalizeUrl(url), anonKey: anonKey.trim() } : null;
}

export function getCloudConfig(): CloudConfig | null {
  const saved = read<CloudConfig>(CONFIG_KEY);
  return saved ? { ...saved, url: normalizeUrl(saved.url) } : envConfig();
}

/** Aceita a URL copiada de qualquer lugar do painel: fica só "https://<id>.supabase.co". */
export function normalizeUrl(raw: string): string {
  const s = raw.trim();
  try {
    return new URL(/^https?:\/\//.test(s) ? s : `https://${s}`).origin;
  } catch {
    return s.replace(/\/+$/, '');
  }
}

export function saveCloudConfig(cfg: CloudConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ url: normalizeUrl(cfg.url), anonKey: cfg.anonKey.trim() }));
  localStorage.setItem(MODE_KEY, JSON.stringify('cloud'));
}

export function getMode(): Mode | null {
  const saved = read<Mode>(MODE_KEY);
  if (saved === 'local') return 'local';
  if (getCloudConfig()) return 'cloud';
  return saved;
}

export function setMode(mode: Mode) {
  localStorage.setItem(MODE_KEY, JSON.stringify(mode));
}

export function forgetCloud() {
  localStorage.removeItem(CONFIG_KEY);
  localStorage.setItem(MODE_KEY, JSON.stringify('local'));
}

/** Valida o formato antes de tentar conectar. */
export function validateConfig(cfg: CloudConfig): string | null {
  if (!/^https?:\/\/[^\s/]+$/.test(normalizeUrl(cfg.url))) return 'Informe a URL do projeto (ex.: https://abcd.supabase.co)';
  if (cfg.anonKey.trim().length < 20) return 'Informe a chave pública (anon / publishable key)';
  if (/service_role|sb_secret_/.test(cfg.anonKey)) return 'Essa é a chave SECRETA. Use a chave pública (anon / publishable).';
  try {
    const payload = JSON.parse(atob(cfg.anonKey.split('.')[1] ?? ''));
    if (payload.role === 'service_role') return 'Essa é a chave SECRETA (service_role). Use a chave pública (anon).';
  } catch {
    /* chave no formato novo (sb_publishable_…) */
  }
  return null;
}
