import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4172,
    strictPort: true,
  },
});
