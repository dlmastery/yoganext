import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The `@` alias is written as a root-relative path rather than resolved with
// `node:path`, so this config type-checks without @types/node installed.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': '/src' },
  },
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'es2020',
    cssTarget: 'chrome111',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
