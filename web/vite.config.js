import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { 
    proxy: { '/api': 'http://localhost:3000' } // 开发环境代理，解决跨域
  },
});