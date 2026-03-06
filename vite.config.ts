import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = { ...loadEnv(mode, '.', ''), ...process.env };
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.DOUBAO_ENDPOINT': JSON.stringify(env.DOUBAO_ENDPOINT),
      'process.env.DOUBAO_CHAT_ENDPOINT': JSON.stringify(env.DOUBAO_CHAT_ENDPOINT),
      'process.env.DOUBAO_IMAGE_ENDPOINT': JSON.stringify(env.DOUBAO_IMAGE_ENDPOINT),
      'process.env.DOUBAO_VISION_MODEL': JSON.stringify(env.DOUBAO_VISION_MODEL),
      'process.env.VITE_SAM2_URL': JSON.stringify(env.VITE_SAM2_URL),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      host: true,
      proxy: {
        '/api/doubao': 'http://localhost:3001',
        '/api/sam2': {
          target: 'http://localhost:3002',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/sam2/, ''),
        },
      },
    },
  };
});
