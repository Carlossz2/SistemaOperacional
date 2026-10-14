// "Mini Supabase" para testes locais de ponta a ponta (NÃO é usado em produção).
// Expõe na porta 54321 as mesmas rotas que o app e as funções usam:
//   /rest/v1/*       -> PostgREST (porta 3000), com RLS de verdade via JWT
//   /auth/v1/*       -> login por e-mail/senha simplificado (gera JWTs como o Supabase Auth)
//   /functions/v1/*  -> Edge Functions deste repositório, rodando no mesmo processo
//   /fake-graph/*    -> imitação da Marketing API da Meta (para testar a sincronização)
//   /fake-fx         -> imitação da API de câmbio
//   /fake-mp/*       -> imitação da API de relatórios do Mercado Pago
//   /storage/v1/*    -> Storage (upload, link assinado, exclusão) com as políticas RLS reais
import pg from 'npm:pg@8.13.1';
import { mpReleaseCsv } from '../../functions/_shared/fixtures.ts';

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
Deno.env.set('MP_API_BASE', `${BASE}/fake-mp`);

const functions: Record<string, (req: Request) => Promise<Response>> = {
  webhook: (await import('../../functions/webhook/handler.ts')).handler,
  reprocess: (await import('../../functions/reprocess/handler.ts')).handler,
  'meta-sync': (await import('../../functions/meta-sync/handler.ts')).handler,
  'bank-sync': (await import('../../functions/bank-sync/handler.ts')).handler,
  'import-sales': (await import('../../functions/import-sales/handler.ts')).handler,
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Profile',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ------------------------------------------------------------------ auth (inclui 2FA simulado: código 123456)
async function factors(userId: string) {
  const r = await db.query('select id, friendly_name, factor_type, status, created_at from auth.mfa_factors where user_id = $1', [userId]);
  return r.rows.map((f) => ({ ...f, updated_at: f.created_at }));
}

async function session(user: { id: string; email: string }, aal: 'aal1' | 'aal2' = 'aal1') {
  const exp = now() + 3600;
  const access_token = await sign({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', aal, amr: [{ method: aal === 'aal2' ? 'totp' : 'password', timestamp: now() }], session_id: crypto.randomUUID(), iat: now(), exp });
  const u = { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, factors: await factors(user.id), created_at: new Date().toISOString() };
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: `rt-${user.id}-${aal}`, user: u };
}

async function claimsOf(req: Request) {
  return await verify((req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''));
}

async function auth(req: Request, path: string, sub: string[]): Promise<Response> {
  const url = new URL(req.url);
  if (path === 'signup' && req.method === 'POST') {
    const { email, password } = await req.json();
    const exists = await db.query('select 1 from auth.users where email = $1', [email]);
    if (exists.rowCount) return json({ code: 422, msg: 'User already registered', error_code: 'user_already_exists' }, 422);
    const id = crypto.randomUUID();
    try {
      await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
    } catch {
      // mesmo comportamento do Supabase Auth quando um gatilho do banco recusa o cadastro
      return json({ code: 500, error_code: 'unexpected_failure', msg: 'Database error saving new user' }, 500);
    }
    await db.query('insert into test_auth.passwords (user_id, password) values ($1, $2)', [id, password]);
    return json(await session({ id, email }));
  }
  if (path === 'token' && req.method === 'POST') {
    const body = await req.json();
    if (url.searchParams.get('grant_type') === 'refresh_token') {
      const [, id, aal] = String(body.refresh_token).match(/^rt-(.+)-(aal[12])$/) ?? [];
      const r = await db.query('select id, email from auth.users where id = $1', [id]);
      return r.rowCount ? json(await session(r.rows[0], aal as 'aal1' | 'aal2')) : json({ error: 'invalid_grant' }, 400);
    }
    const r = await db.query(
      'select u.id, u.email from auth.users u join test_auth.passwords p on p.user_id = u.id where u.email = $1 and p.password = $2',
      [body.email, body.password],
    );
    if (!r.rowCount) return json({ error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' }, 400);
    return json(await session(r.rows[0]));
  }
  if (path === 'settings') return json({ external: { email: true }, disable_signup: false });
  if (path === 'recover') return json({});
  const claims = await claimsOf(req);
  if (!claims?.sub) return json({ msg: 'invalid JWT' }, 401);
  const user = { id: String(claims.sub), email: String(claims.email) };
  if (path === 'user') {
    return json({ id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, factors: await factors(user.id) });
  }
  if (path === 'logout') return new Response(null, { status: 204, headers: CORS });
  if (path === 'factors') {
    const [factorId, action] = sub;
    if (!factorId && req.method === 'POST') {
      const body = await req.json();
      const r = await db.query("insert into auth.mfa_factors (user_id, friendly_name, factor_type, status) values ($1, $2, 'totp', 'unverified') returning id", [user.id, body.friendly_name ?? null]);
      const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><rect width='120' height='120' fill='white'/><text x='10' y='60'>QR</text></svg>";
      return json({ id: r.rows[0].id, type: 'totp', friendly_name: body.friendly_name, totp: { qr_code: `data:image/svg+xml;utf-8,${svg}`, secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/Gestor:teste?secret=JBSWY3DPEHPK3PXP' } });
    }
    if (factorId && action === 'challenge') return json({ id: crypto.randomUUID(), type: 'totp', expires_at: now() + 300 });
    if (factorId && action === 'verify') {
      const body = await req.json();
      if (body.code !== '123456') return json({ code: 422, error_code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered' }, 422);
      await db.query("update auth.mfa_factors set status = 'verified' where id = $1 and user_id = $2", [factorId, user.id]);
      return json(await session(user, 'aal2'));
    }
    if (factorId && req.method === 'DELETE') {
      await db.query('delete from auth.mfa_factors where id = $1 and user_id = $2', [factorId, user.id]);
      return json({ id: factorId });
    }
  }
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

// ------------------------------------------------------------------ Mercado Pago simulado
// Relatório de liberações: pedido → fica pronto ~1,5 s depois → baixado em CSV. Token válido: "mp-bom".
const mp = { config: false, reports: [] as { file_name: string; readyAt: number; date_created: string }[] };
const fakeMp = async (req: Request, path: string): Promise<Response> => {
  if (req.headers.get('authorization') !== 'Bearer mp-bom') return json({ message: 'invalid access token' }, 401);
  if (path === 'v1/account/release_report/config') {
    if (req.method === 'POST') {
      mp.config = true;
      return json({ file_name_prefix: 'cadigital' }, 201);
    }
    return mp.config ? json({ file_name_prefix: 'cadigital' }) : json({ message: 'not found' }, 404);
  }
  if (path === 'v1/account/release_report' && req.method === 'POST') {
    const n = mp.reports.length + 1;
    mp.reports.push({ file_name: `cadigital-${n}.csv`, readyAt: Date.now() + 1500, date_created: new Date().toISOString() });
    return json({ id: n, status: 'pending' }, 202);
  }
  if (path === 'v1/account/release_report/list') return json(mp.reports.map(({ file_name, date_created }) => ({ file_name, date_created })));
  const file = mp.reports.find((r) => path === `v1/account/release_report/${r.file_name}`);
  if (file) return Date.now() < file.readyAt ? json({ message: 'not ready' }, 404) : new Response(mpReleaseCsv, { headers: { 'Content-Type': 'text/csv' } });
  return json({ message: 'rota desconhecida' }, 404);
};

// ------------------------------------------------------------------ Storage simulado
// Como o Supabase Storage: os metadados vão para storage.objects COM o papel e o JWT do usuário
// (as políticas RLS da migração decidem), e o conteúdo fica em memória.
const files = new Map<string, { bytes: Uint8Array; type: string }>();
const signed = new Map<string, string>(); // token -> bucket/caminho

async function asUser<T>(claims: Record<string, unknown>, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('role', 'authenticated', true), set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (err) {
    await c.query('rollback');
    throw err;
  } finally {
    c.release();
  }
}

async function storage(req: Request, parts: string[]): Promise<Response> {
  const url = new URL(req.url);
  // download por link assinado (sem login, como no Supabase)
  if (req.method === 'GET' && parts[0] === 'object' && parts[1] === 'sign') {
    const key = decodeURIComponent(parts.slice(2).join('/'));
    if (signed.get(url.searchParams.get('token') ?? '') !== key || !files.has(key)) return json({ statusCode: '400', error: 'InvalidSignature' }, 400);
    const f = files.get(key)!;
    const headers: Record<string, string> = { ...CORS, 'Content-Type': f.type || 'application/octet-stream' };
    if (url.searchParams.has('download')) {
      const fname = url.searchParams.get('download') || key.split('/').pop()!;
      headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`;
    }
    return new Response(f.bytes, { headers });
  }
  const claims = await verify((req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''));
  if (!claims || claims.role !== 'authenticated') return json({ statusCode: '403', error: 'Unauthorized', message: 'invalid jwt' }, 403);
  try {
    if (req.method === 'POST' && parts[0] === 'object' && parts[1] === 'sign') {
      const [bucket, ...rest] = parts.slice(2).map(decodeURIComponent);
      const name = rest.join('/');
      const ok = await asUser(claims, (c) => c.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, name]));
      if (!ok.rowCount) return json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, 400);
      const token = crypto.randomUUID();
      signed.set(token, `${bucket}/${name}`);
      return json({ signedURL: `/object/sign/${bucket}/${name}?token=${token}` });
    }
    if (req.method === 'GET' && parts[0] === 'object') {
      // download com login (storage.download): só o que a RLS de storage.objects deixa ver
      const [bucket, ...rest] = parts.slice(1).map(decodeURIComponent);
      const name = rest.join('/');
      const ok = await asUser(claims, (c) => c.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, name]));
      const f = files.get(`${bucket}/${name}`);
      if (!ok.rowCount || !f) return json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, 400);
      return new Response(f.bytes, { headers: { ...CORS, 'Content-Type': f.type || 'application/octet-stream' } });
    }
    if (req.method === 'POST' && parts[0] === 'object') {
      const [bucket, ...rest] = parts.slice(1).map(decodeURIComponent);
      const name = rest.join('/');
      let bytes: Uint8Array;
      let type = req.headers.get('content-type') ?? '';
      if (type.startsWith('multipart/form-data')) {
        // o supabase-js manda o arquivo num campo de nome vazio, que o req.formData() do Deno descarta:
        // lê o multipart à mão (latin1 = 1 caractere por byte, então os índices valem para os bytes)
        const raw = new Uint8Array(await req.arrayBuffer());
        const text = new TextDecoder('latin1').decode(raw);
        const boundary = '--' + (type.match(/boundary=([^;]+)/)?.[1] ?? '').replace(/"/g, '');
        const part = text.split(boundary).find((x) => /filename=/i.test(x.slice(0, x.indexOf('\r\n\r\n'))));
        if (!part) return json({ statusCode: '400', error: 'no file' }, 400);
        const start = text.indexOf(part) + part.indexOf('\r\n\r\n') + 4;
        const end = text.indexOf(part) + part.length - 2; // tira o \r\n antes do próximo separador
        bytes = raw.slice(start, end);
        type = part.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() ?? 'application/octet-stream';
      } else bytes = new Uint8Array(await req.arrayBuffer());
      const limit = await db.query('select file_size_limit from storage.buckets where id = $1', [bucket]);
      if (limit.rows[0]?.file_size_limit && bytes.length > Number(limit.rows[0].file_size_limit)) return json({ statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' }, 413);
      const r = await asUser(claims, (c) => c.query('insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3) returning id', [bucket, name, claims.sub]));
      files.set(`${bucket}/${name}`, { bytes, type });
      return json({ Id: r.rows[0].id, Key: `${bucket}/${name}` });
    }
    if (req.method === 'DELETE' && parts[0] === 'object') {
      const bucket = decodeURIComponent(parts[1]);
      const { prefixes } = await req.json();
      const r = await asUser(claims, (c) => c.query('delete from storage.objects where bucket_id = $1 and name = any($2) returning name', [bucket, prefixes]));
      for (const row of r.rows) files.delete(`${bucket}/${row.name}`);
      return json(r.rows.map((row: { name: string }) => ({ name: row.name, bucket_id: bucket })));
    }
  } catch (err) {
    const msg = (err as Error).message;
    return json({ statusCode: '403', error: 'Unauthorized', message: msg }, /row-level security|permission/.test(msg) ? 403 : 400);
  }
  return json({ error: 'rota de storage desconhecida' }, 404);
}

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
    if (area === 'auth') return await auth(req, rest[1] ?? '', rest.slice(2));
    if (area === 'functions') {
      const fn = functions[rest[1]];
      if (!fn) return json({ error: 'função não existe' }, 404);
      const inner = new Request(`${BASE}/${rest.slice(1).join('/')}${url.search}`, req);
      return await fn(inner);
    }
    if (area === 'storage') return await storage(req, rest.slice(1));
    if (area === 'fake-graph') return fakeGraph(req);
    if (area === 'fake-mp') return await fakeMp(req, rest.join('/'));
    if (area === 'fake-fx') return json({ result: 'success', rates: { BRL: 1, USD: 0.2, EUR: 0.16, MXN: 3.4 } });
    return json({ error: 'rota desconhecida' }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: (err as Error).message }, 500);
  }
});
