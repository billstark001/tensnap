import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { lingui } from '@lingui/vite-plugin';
import path from 'path';

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ['macros'],
      },
    }),
    lingui(),
    vanillaExtractPlugin()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'tensnap-web-utils/file-system': path.resolve(__dirname, '../tensnap-web-utils/src/file-system/index.ts'),
      'tensnap-web-utils/adapters': path.resolve(__dirname, '../tensnap-web-utils/src/adapters/index.ts'),
      'tensnap-web-utils': path.resolve(__dirname, '../tensnap-web-utils/index.ts'),
    },
  },
  server: {
    port: 3000,
    host: true
  }
});