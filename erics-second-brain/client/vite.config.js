import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH is baked in at build time (asset URLs, router base).
// Keep it in sync with the server's BASE_PATH env var.
function base() {
  let p = process.env.BASE_PATH ?? '/erics_second_brain';
  if (!p.startsWith('/')) p = '/' + p;
  if (!p.endsWith('/')) p += '/';
  return p;
}

export default defineConfig({
  base: base(),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // dev: forward API calls to the local server
      [base() + 'api']: { target: 'http://localhost:3111', changeOrigin: true },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
