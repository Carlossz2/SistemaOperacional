import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BUILD_ID = `${Date.now().toString(36)}`;

/** Grava a versão do build no service worker: o app instalado (PWA) se atualiza a cada deploy. */
function swVersion(): Plugin {
  let outDir = 'dist';
  return {
    name: 'gestor-sw-version',
    apply: 'build',
    configResolved(cfg) {
      outDir = resolve(cfg.root, cfg.build.outDir);
    },
    closeBundle() {
      const file = resolve(outDir, 'sw.js');
      const src = readFileSync(file, 'utf8');
      if (!src.includes('__BUILD_ID__')) throw new Error('sw.js sem marcador __BUILD_ID__');
      writeFileSync(file, src.replace(/__BUILD_ID__/g, BUILD_ID));
    },
  };
}

/** Política de segurança de conteúdo (CSP): o navegador só fala com o próprio site e o Supabase. */
function csp(supabaseUrl: string | undefined): Plugin {
  const api = supabaseUrl ? new URL(supabaseUrl).origin : 'https://*.supabase.co';
  const ws = api.replace(/^http/, 'ws');
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${api} ${ws} https://*.supabase.co wss://*.supabase.co https://open.er-api.com`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
  return {
    name: 'gestor-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />\n    <meta name="referrer" content="no-referrer" />`);
    },
  };
}

// base relativa: funciona em GitHub Pages, Vercel, Netlify ou numa subpasta da Hostinger
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: './',
    plugins: [react(), swVersion(), csp(env.VITE_SUPABASE_URL)],
    define: { __APP_VERSION__: JSON.stringify(BUILD_ID) },
    build: { chunkSizeWarningLimit: 800 },
    server: { fs: { allow: ['..'] } },
  };
});
