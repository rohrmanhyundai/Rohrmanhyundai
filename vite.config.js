import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  base: '/Rohrmanhyundai/',
  server: { port: 5175, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main:  resolve(__dirname, 'index.html'),
        sales: resolve(__dirname, 'sales/index.html'),
      },
    },
  },
});
