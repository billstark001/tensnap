import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
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
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', '../../benchmarks/**/*.test.ts'],
  },
});
