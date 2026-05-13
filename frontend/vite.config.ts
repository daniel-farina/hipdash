import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:9099';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api':            { target: BACKEND, changeOrigin: false },
      '/v1':             { target: BACKEND, changeOrigin: false },
      '/admin':          { target: BACKEND, changeOrigin: false },
      '/metrics':        { target: BACKEND, changeOrigin: false },
      '/health':         { target: BACKEND, changeOrigin: false },
      '/cancel-all':     { target: BACKEND, changeOrigin: false },
      '/tap':            { target: BACKEND, changeOrigin: false },
      '/system-stats.json':         { target: BACKEND, changeOrigin: false },
      '/opencode-config.json':      { target: BACKEND, changeOrigin: false },
      '/opencode-tool-usage.json':  { target: BACKEND, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
  },
});
