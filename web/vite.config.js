import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

// 🌟 唯一真源：直接读取根目录（上一级）的 package.json
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // 把读到的版本号注入到全局变量中
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    proxy: { '/api': 'http://localhost:3000' }
  },
});
