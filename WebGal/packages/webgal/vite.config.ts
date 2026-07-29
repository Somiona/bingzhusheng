import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import loadVersion from 'vite-plugin-package-version';
import { resolve } from 'path';
import Info from 'unplugin-info/vite';
import viteCompression from 'vite-plugin-compression';

// https://vitejs.dev/config/

// @ts-ignore
const env = process.env.NODE_ENV;
console.log(env);

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    loadVersion(),
    Info(),
    viteCompression({
      filter: /^(.*assets).*\.(js|css|ttf)$/,
    }),
    // @ts-ignore
    // visualizer(),
  ],
  resolve: {
    alias: {
      '@': resolve('src'),
    },
  },
  build: {
    ...(mode === 'terre-preview'
      ? {
          outDir: resolve('../../../.terre/games/bingzhusheng'),
          emptyOutDir: false,
          copyPublicDir: false,
        }
      : {}),
  },
}));
