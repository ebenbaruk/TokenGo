import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxy = {
  '/api': { target: 'http://localhost:8787', changeOrigin: false },
  '/auth': { target: 'http://localhost:8787', changeOrigin: false },
};

export default defineConfig({
  plugins: [react()],
  // MapLibre 6 charge son worker (module ES) à côté de son bundle : ne pas le pré-bundler en dev,
  // et le bundler nous-mêmes via ?worker&url (cf. src/map/GameMap.tsx).
  optimizeDeps: { exclude: ['maplibre-gl'] },
  worker: { format: 'es' },
  server: { port: 5173, host: '0.0.0.0', proxy },
  preview: { port: 4173, host: '0.0.0.0', proxy },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
