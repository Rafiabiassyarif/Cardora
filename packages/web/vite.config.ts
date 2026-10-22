import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: web di :5173, server di :3000 (proxy socket.io & /api) → satu origin di browser.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/socket.io': { target: 'http://127.0.0.1:3000', ws: true },
    },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        manualChunks: { react: ['react', 'react-dom'], net: ['socket.io-client'] },
      },
    },
  },
});
