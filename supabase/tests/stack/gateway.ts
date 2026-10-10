// "Mini Supabase" para testes locais de ponta a ponta (NÃO é usado em produção).
// Expõe na porta 54321 as mesmas rotas que o app e as funções usam:
//   /rest/v1/*       -> PostgREST (porta 3000), com RLS de verdade via JWT
//   /auth/v1/*       -> login por e-mail/senha simplificado (gera JWTs como o Supabase Auth)
//   /functions/v1/*  -> Edge Functions deste repositório, rodando no mesmo processo
//   /fake-graph/*    -> imitação da Marketing API da Meta (para testar a sincronização)
//   /fake-fx         -> imitação da API de câmbio
import pg from 'npm:pg@8.13.1';

const PORT = Number(Deno.env.get('GATEWAY_PORT') ?? 54321);
const BASE = `http://localhost:${PORT}`;
const SECRET = Deno.env.get('JWT_SECRET') ?? 'super-secret-jwt-token-with-at-least-32-characters';
const PGRST = Deno.env.get('PGRST_URL') ?? 'http://localhost:3000';
const db = new pg.Pool({ connectionString: Deno.env.get('DATABASE_URL') ?? 'postgres://postgres@localhost/gestor_e2e' });

// ------------------------------------------------------------------ JWT HS256
const enc = new TextEncoder();
const b64url = (data: Uint8Array | string) =>
  btoa(typeof data === 'string' ? data : String.fromCharCode(...data)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const key = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

async function sign(payload: Record<string, unknown>): Promise<string> {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}
async function verify(token: string): Promise<Record<string, unknown> | null> {
  const [h, b, s] = token.split('.');
  if (!s) return null;
  const sig = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const ok = await crypto.subtle.verify('HMAC', key, sig, enc.encode(`${h}.${b}`));
  if (!ok) return null;
  const payload = JSON.parse(atob(b.replace(/-/g, '+').replace(/_/g, '/')));
  if (payload.exp && payload.exp < Date.now() / 1000) return null;
  return payload;
}

const now = () => Math.floor(Date.now() / 1000);
export const ANON_KEY = await sign({ role: 'anon', iss: 'supabase', iat: now(), exp: now() + 3600 * 24 * 365 });
export const SERVICE_KEY = await sign({ role: 'service_role', iss: 'supabase', iat: now(), exp: now() + 3600 * 24 * 365 });

// Variáveis que as Edge Functions esperam
Deno.env.set('SUPABASE_URL', BASE);
Deno.env.set('SUPABASE_ANON_KEY', ANON_KEY);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY);
Deno.env.set('META_GRAPH_BASE', `${BASE}/fake-graph`);
Deno.env.set('FX_API_URL', `${BASE}/fake-fx`);

const functions: Record<string, (req: Request) => Promise<Response>> = {
  webhook: (await import('../../functions/webhook/handler.ts')).handler,
  reprocess: (await import('../../functions/reprocess/handler.ts')).handler,
  'meta-sync': (await import('../../functions/meta-sync/handler.ts')).handler,
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Profile',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ------------------------------------------------------------------ auth
async function session(user: { id: string; email: string }) {
  const exp = now() + 3600;
  const access_token = await sign({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', iat: now(), exp });
  const u = { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() };
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: `rt-${user.id}`, user: u };
}

async function auth(req: Request, path: string): Promise<Response> {
  const url = new URL(req.url);
  if (path === 'signup' && req.method === 'POST') {
    const { email, password } = await req.json();
    const exists = await db.query('select 1 from auth.users where email = $1', [email]);
    if (exists.rowCount) return json({ code: 422, msg: 'User already registered', error_code: 'user_already_exists' }, 422);
    const id = crypto.randomUUID();
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
    await db.query('insert into test_auth.passwords (user_id, password) values ($1, $2)', [id, password]);
    return json(await session({ id, email }));
  }
  if (path === 'token' && req.method === 'POST') {
    const body = await req.json();
    if (url.searchParams.get('grant_type') === 'refresh_token') {
      const id = String(body.refresh_token).replace(/^rt-/, '');
      const r = await db.query('select id, email from auth.users where id = $1', [id]);
      return r.rowCount ? json(await session(r.rows[0])) : json({ error: 'invalid_grant' }, 400);
    }
    const r = await db.query(
      'select u.id, u.email from auth.users u join test_auth.passwords p on p.user_id = u.id where u.email = $1 and p.password = $2',
      [body.email, body.password],
    );
    if (!r.rowCount) return json({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400);
    return json(await session(r.rows[0]));
  }
  if (path === 'user') {
    const claims = await verify((req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''));
    if (!claims?.sub) return json({ msg: 'invalid JWT' }, 401);
    return json({ id: claims.sub, email: claims.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} });
  }
  if (path === 'logout') return new Response(null, { status: 204, headers: CORS });
  return json({ msg: 'not implemented' }, 404);
}

// ------------------------------------------------------------------ Meta e câmbio simulados
const fakeGraph = (req: Request): Response => {
  const url = new URL(req.url);
  const token = url.searchParams.get('access_token');
  if (token === 'expired') return json({ error: { code: 190, message: 'Session has expired' } }, 400);
  const page = Number(url.searchParams.get('page') ?? 0);
  const { since } = JSON.parse(url.searchParams.get('time_range') ?? '{}');
  const rows = [
    { campaign_id: 'c1', campaign_name: '[MX] Reconquista ABO', date_start: since, spend: '100.50', impressions: '5000', clicks: '120', country: 'MX', account_currency: 'USD' },
    { campaign_id: 'c2', campaign_name: 'KETO US', date_start: since, spend: '50', impressions: '2000', clicks: '40', country: 'US', account_currency: 'USD' },
  ];
  if (page === 0) {
    const next = new URL(url);
    next.searchParams.set('page', '1');
    return json({ data: [rows[0]], paging: { next: next.toString() } });
  }
  return json({ data: [rows[1]] });
};

// ------------------------------------------------------------------ servidor
Deno.serve({ port: PORT, onListen: () => console.log(`gateway em ${BASE}\nANON_KEY=${ANON_KEY}`) }, async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const [, area, ...rest] = url.pathname.split('/');
  try {
    if (area === 'rest') {
      const target = `${PGRST}/${rest.slice(1).join('/')}${url.search}`;
      const headers = new Headers(req.headers);
      if (!headers.get('authorization') && headers.get('apikey')) headers.set('authorization', `Bearer ${headers.get('apikey')}`);
      headers.delete('host');
      const res = await fetch(target, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer() });
      const out = new Headers(res.headers);
      Object.entries(CORS).forEach(([k, v]) => out.set(k, v));
      return new Response(res.body, { status: res.status, headers: out });
    }
    if (area === 'auth') return await auth(req, rest[1] ?? '');
    if (area === 'functions') {
      const fn = functions[rest[1]];
      if (!fn) return json({ error: 'função não existe' }, 404);
      const inner = new Request(`${BASE}/${rest.slice(1).join('/')}${url.search}`, req);
      return await fn(inner);
    }
    if (area === 'fake-graph') return fakeGraph(req);
    if (area === 'fake-fx') return json({ result: 'success', rates: { BRL: 1, USD: 0.2, EUR: 0.16, MXN: 3.4 } });
    return json({ error: 'rota desconhecida' }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: (err as Error).message }, 500);
  }
});
