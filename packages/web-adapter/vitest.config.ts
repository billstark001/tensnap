import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: path.resolve(import.meta.dirname, './src/$1') },
      {
        find: /^@tensnap\/core$/,
        replacement: path.resolve(import.meta.dirname, '../core/src/index.ts'),
      },
      {
        find: /^@tensnap\/core\/(.*)$/,
        replacement: path.resolve(import.meta.dirname, '../core/src/$1'),
      },
      {
        find: /^@tensnap\/web$/,
        replacement: path.resolve(import.meta.dirname, '../tensnap-web/index.ts'),
      },
      {
        find: /^@tensnap\/web\/(.*)$/,
        replacement: path.resolve(import.meta.dirname, '../tensnap-web/src/$1'),
      },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.d.ts', 'src/**/__tests__/**'],
    },
  },
});
