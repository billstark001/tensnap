import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { lingui } from '@lingui/vite-plugin';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import path from 'path';
import { tensnapCodeSplitting } from '../../scripts/vite-chunks.mjs';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('benchmark'),
  },
  plugins: [
    react({ plugins: [['@lingui/swc-plugin', {}]] }),
    lingui(),
    vanillaExtractPlugin(),
  ],
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, '../tensnap-web/src/$1') },
    ],
  },
  root: __dirname,
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 500,
    rolldownOptions: {
      output: {
        codeSplitting: tensnapCodeSplitting,
      },
    },
  },
  server: {
    port: 5180,
    open: true,
  },
  preview: {
    port: 4180,
    open: true,
  }
});
