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
      { find: '@tensnap/benchmark/harness', replacement: path.resolve(__dirname, 'src/harness/index.ts') },
      { find: '@tensnap/web/benchmark', replacement: path.resolve(__dirname, '../tensnap-web/src/benchmark.tsx') },
      { find: '@tensnap/web/transport', replacement: path.resolve(__dirname, '../tensnap-web/src/transport/index.ts') },
      { find: '@tensnap/js/bindings', replacement: path.resolve(__dirname, '../tensnap-js/src/bindings/index.ts') },
      { find: '@tensnap/js/runtime', replacement: path.resolve(__dirname, '../tensnap-js/src/runtime/index.ts') },
      { find: '@tensnap/core/environment/browser', replacement: path.resolve(__dirname, '../core/src/environment/browser.ts') },
      { find: '@tensnap/core/environment', replacement: path.resolve(__dirname, '../core/src/environment/index.ts') },
      { find: '@tensnap/core/runtime/browser', replacement: path.resolve(__dirname, '../core/src/runtime/browser.ts') },
      { find: '@tensnap/core/runtime', replacement: path.resolve(__dirname, '../core/src/runtime/index.ts') },
      { find: /^@tensnap\/core$/, replacement: path.resolve(__dirname, '../core/src/index.ts') },
      { find: '@tensnap/protocol/layers', replacement: path.resolve(__dirname, '../protocol/src/layers.ts') },
      { find: /^@tensnap\/protocol$/, replacement: path.resolve(__dirname, '../protocol/src/index.ts') },
      { find: '@leafer-ui/core', replacement: path.resolve(__dirname, 'node_modules/@leafer-ui/core') },
    ],
  },
  root: __dirname,
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 500,
    rolldownOptions: {
      input: {
        browserRunner: path.resolve(__dirname, 'browser-runner.html'),
      },
      output: {
        codeSplitting: tensnapCodeSplitting,
      },
    },
  },
  server: {
    port: 5180,
    open: true,
    fs: {
      allow: [path.resolve(__dirname, '../..')],
    },
  },
  preview: {
    port: 4180,
    open: true,
  }
});
