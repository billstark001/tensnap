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
      'tensnap-web-utils': path.resolve(__dirname, '../tensnap-web-utils/src/'),
    },
  },
  server: {
    port: 3200,
    host: true
  }
});