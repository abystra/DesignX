import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: process.env.DEV_HOST || '127.0.0.1', port: 5173, strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false } } },
  preview: { host: '127.0.0.1', port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false } } },
});
