import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // API_URL (en frontend/.env) apunta al backend; por defecto el puerto local 3001
  const env = loadEnv(mode, process.cwd(), '');
  const proxy = { '/api': env.API_URL || 'http://localhost:3001' };
  return {
    plugins: [react()],
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
  };
});
