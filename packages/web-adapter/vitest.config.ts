import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, './src/$1') },
      { find: /^@tensnap\/core$/, replacement: path.resolve(__dirname, '../core/src/index.ts') },
      { find: /^@tensnap\/core\/(.*)$/, replacement: path.resolve(__dirname, '../core/src/$1') },
      { find: /^@tensnap\/web$/, replacement: path.resolve(__dirname, '../tensnap-web/index.ts') },
      { find: /^@tensnap\/web\/(.*)$/, replacement: path.resolve(__dirname, '../tensnap-web/src/$1') },
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