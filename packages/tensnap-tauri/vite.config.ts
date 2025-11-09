import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { lingui } from '@lingui/vite-plugin';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ['macros'],
      },
    }),
    lingui(),
    vanillaExtractPlugin(),
  ],

  // Vite options tailored for Tauri development
  clearScreen: false,

  // Tauri expects a fixed port, fail if that port is not available
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  resolve: {
    alias: {
      'tensnap-web/Providers': path.resolve(__dirname, '../tensnap-web/src/Providers.tsx'),
      'tensnap-web/App': path.resolve(__dirname, '../tensnap-web/src/App.tsx'),
      'tensnap-web/i18n': path.resolve(__dirname, '../tensnap-web/src/i18n.ts'),
      'tensnap-web/store/file-system/adapter': path.resolve(__dirname, '../tensnap-web/src/store/file-system/adapter.ts'),
      'tensnap-web/store/file-system/provider': path.resolve(__dirname, '../tensnap-web/src/store/file-system/provider.tsx'),
      'tensnap-web/store/file-system/store': path.resolve(__dirname, '../tensnap-web/src/store/file-system/store.ts'),
      'tensnap-web/types/file': path.resolve(__dirname, '../tensnap-web/src/types/file.ts'),
      'tensnap-web': path.resolve(__dirname, '../tensnap-web'),

      // Handle @ alias from tensnap-web package when imported by tauri
      '@': path.resolve(__dirname, '../tensnap-web/src'),
    },
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