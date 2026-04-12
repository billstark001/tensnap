import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ['macros'],
      },
    }),
    vanillaExtractPlugin(),
  ],

  // Vite options tailored for Tauri development
  clearScreen: false,

  // Tauri expects a fixed port, fail if that port is not available
  server: {
    port: 3250,
    strictPort: true,
    watch: {
      // Tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  resolve: {
    alias: [
      { find: /^@tensnap\/web\/index$/, replacement: path.resolve(__dirname, '../tensnap-web/index.ts') },
      { find: /^@tensnap\/web\/src\/(.*)$/, replacement: path.resolve(__dirname, '../tensnap-web/src/$1') },
      { find: /^@tensnap\/web\/Providers$/, replacement: path.resolve(__dirname, '../tensnap-web/src/Providers.tsx') },
      { find: /^@tensnap\/web\/App$/, replacement: path.resolve(__dirname, '../tensnap-web/src/App.tsx') },
      { find: /^@tensnap\/web\/i18n$/, replacement: path.resolve(__dirname, '../tensnap-web/src/i18n.ts') },
      { find: /^@tensnap\/web\/store\/file-system\/adapter$/, replacement: path.resolve(__dirname, '../tensnap-web/src/store/file-system/adapter.ts') },
      { find: /^@tensnap\/web\/store\/file-system\/provider$/, replacement: path.resolve(__dirname, '../tensnap-web/src/store/file-system/provider.tsx') },
      { find: /^@tensnap\/web\/store\/file-system\/store$/, replacement: path.resolve(__dirname, '../tensnap-web/src/store/file-system/store.ts') },
      { find: /^@tensnap\/web\/types\/file$/, replacement: path.resolve(__dirname, '../tensnap-web/src/types/file.ts') },
      { find: /^@tensnap\/web$/, replacement: path.resolve(__dirname, '../tensnap-web/index.ts') },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, '../tensnap-web/src/$1') },
    ],
  },

  build: {
    // Tauri supports es2021
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    // Don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
  },

});