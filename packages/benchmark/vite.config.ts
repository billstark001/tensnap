import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import path from 'path';

export default defineConfig({
  plugins: [preact()],
  root: __dirname,
  base: './',
  resolve: {
    alias: {
      '@tensnap/core/chart': path.resolve(__dirname, '../core/src/chart/index.ts'),
      '@tensnap/core/environment': path.resolve(__dirname, '../core/src/environment/index.ts'),
      '@tensnap/core/parameter': path.resolve(__dirname, '../core/src/parameter/index.ts'),
      '@tensnap/core/protocol': path.resolve(__dirname, '../core/src/protocol/index.ts'),
      '@tensnap/core/scenario': path.resolve(__dirname, '../core/src/scenario/index.ts'),
      '@tensnap/core/transport': path.resolve(__dirname, '../core/src/transport/index.ts'),
      '@tensnap/core/utils': path.resolve(__dirname, '../core/src/utils/index.ts'),
      '@tensnap/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@tensnap/web-adapter/fake-models/wolf-sheep': path.resolve(__dirname, '../web-adapter/src/fake-models/wolf-sheep.ts'),
      '@tensnap/web-adapter/fake-models/schelling': path.resolve(__dirname, '../web-adapter/src/fake-models/schelling.ts'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5180,
    open: true,
  },
});