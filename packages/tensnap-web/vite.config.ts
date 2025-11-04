import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    vanillaExtractPlugin()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'tensnap-web-utils': path.resolve(__dirname, '../tensnap-web-utils'),
    },
  },
  server: {
    port: 3000,
    host: true
  }
});