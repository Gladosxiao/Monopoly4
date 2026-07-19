import { defineConfig } from 'vite';

export default defineConfig({
  // 生产部署在子路径时设置 VITE_BASE_URL=/repo-name/
  base: process.env.VITE_BASE_URL || '/',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
