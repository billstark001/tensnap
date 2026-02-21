import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import path from 'path';

export default defineConfig({
  plugins: [
    preact(),
  ],
  root: path.resolve(__dirname, 'src-benchmark'),
  base: './',
  resolve: {
    alias: {
      // resolve the package itself so benchmark can import from 'tensnap-web-core/...'
      'tensnap-web-core/chart': path.resolve(__dirname, 'src/chart/index.ts'),
      'tensnap-web-core/environment': path.resolve(__dirname, 'src/environment/index.ts'),
      'tensnap-web-core/parameter': path.resolve(__dirname, 'src/parameter/index.ts'),
      'tensnap-web-core/utils': path.resolve(__dirname, 'src/utils/index.ts'),
      'tensnap-web-core': path.resolve(__dirname, 'src/index.ts'),
      'tensnap-web-utils/fake-models/wolf-sheep': path.resolve(__dirname, '../tensnap-web-utils/src/fake-models/wolf-sheep.ts'),
      'tensnap-web-utils/fake-models/schelling': path.resolve(__dirname, '../tensnap-web-utils/src/fake-models/schelling.ts'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist-benchmark'),
    emptyOutDir: true,
  },
  server: {
    port: 5180,
    open: true,
  },
});
