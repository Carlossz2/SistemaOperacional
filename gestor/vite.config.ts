import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relativa: funciona em GitHub Pages, Vercel, Netlify ou numa subpasta da Hostinger
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 800 },
});
