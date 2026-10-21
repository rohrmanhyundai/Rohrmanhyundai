import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Every build gets an id, baked into the bundle and written to version.json.
// A tab left open across a deploy compares the two and reloads itself (see the
// new-build check in App.jsx), so nobody sits on yesterday's tiles.
const BUILD_ID = String(Date.now());
const buildVersionFile = {
  name: 'build-version-file',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
  },
};

export default defineConfig({
  plugins: [react(), buildVersionFile],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  base: '/Rohrmanhyundai/',
  server: { port: 5175, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main:  resolve(__dirname, 'index.html'),
        sales: resolve(__dirname, 'sales/index.html'),
        dashboard: resolve(__dirname, 'dashboard/index.html'),
      },
    },
  },
});
