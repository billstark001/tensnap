import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { lingui } from '@lingui/vite-plugin';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import path from 'node:path';
import { tensnapCodeSplitting } from '../../scripts/vite-chunks.mjs';

export default defineConfig({
  cacheDir: process.env.TENSNAP_EVALUATION_VITE_CACHE_DIR,
  define: {
    __APP_VERSION__: JSON.stringify('benchmark'),
  },
  plugins: [react({ plugins: [['@lingui/swc-plugin', {}]] }), lingui(), vanillaExtractPlugin()],
  resolve: {
    alias: [
      {
        find: /^@\/(.*)$/,
        replacement: path.resolve(import.meta.dirname, '../tensnap-web/src/$1'),
      },
      {
        find: '@tensnap/benchmark/harness',
        replacement: path.resolve(import.meta.dirname, 'src/harness/index.ts'),
      },
      {
        find: '@tensnap/web/benchmark',
        replacement: path.resolve(import.meta.dirname, '../tensnap-web/src/benchmark.tsx'),
      },
      {
        find: '@tensnap/web/transport',
        replacement: path.resolve(import.meta.dirname, '../tensnap-web/src/transport/index.ts'),
      },
      {
        find: '@tensnap/js/bindings',
        replacement: path.resolve(import.meta.dirname, '../tensnap-js/src/bindings/index.ts'),
      },
      {
        find: '@tensnap/js/runtime',
        replacement: path.resolve(import.meta.dirname, '../tensnap-js/src/runtime/index.ts'),
      },
      {
        find: '@tensnap/core/environment/browser',
        replacement: path.resolve(import.meta.dirname, '../core/src/environment/browser.ts'),
      },
      {
        find: '@tensnap/core/environment',
        replacement: path.resolve(import.meta.dirname, '../core/src/environment/index.ts'),
      },
      {
        find: '@tensnap/core/runtime/browser',
        replacement: path.resolve(import.meta.dirname, '../core/src/runtime/browser.ts'),
      },
      {
        find: '@tensnap/core/runtime',
        replacement: path.resolve(import.meta.dirname, '../core/src/runtime/index.ts'),
      },
      {
        find: /^@tensnap\/core$/,
        replacement: path.resolve(import.meta.dirname, '../core/src/index.ts'),
      },
      {
        find: '@tensnap/protocol/layers',
        replacement: path.resolve(import.meta.dirname, '../protocol/src/layers.ts'),
      },
      {
        find: /^@tensnap\/protocol$/,
        replacement: path.resolve(import.meta.dirname, '../protocol/src/index.ts'),
      },
      {
        find: '@leafer-ui/core',
        replacement: path.resolve(import.meta.dirname, 'node_modules/@leafer-ui/core'),
      },
    ],
  },
  root: import.meta.dirname,
  base: './',
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 500,
    rolldownOptions: {
      input: {
        browserRunner: path.resolve(import.meta.dirname, 'browser-runner.html'),
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
      allow: [path.resolve(import.meta.dirname, '../..')],
    },
  },
  preview: {
    port: 4180,
    open: true,
  },
});
