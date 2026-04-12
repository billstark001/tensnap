import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import path from 'path';
import pkg from './package.json';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react({
      babel: {
        plugins: ['macros'],
      },
    }),
    vanillaExtractPlugin()
  ],
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, './src/$1') },
      { find: /^@tensnap\/web$/, replacement: path.resolve(__dirname, './index.ts') },
      { find: /^@tensnap\/web\/(.*)$/, replacement: path.resolve(__dirname, './src/$1') },
      { find: /^@tensnap\/web-adapter$/, replacement: path.resolve(__dirname, '../web-adapter/src/index.ts') },
      { find: /^@tensnap\/web-adapter\/file-system$/, replacement: path.resolve(__dirname, '../web-adapter/src/file-system/index.ts') },
      { find: /^@tensnap\/web-adapter\/adapters$/, replacement: path.resolve(__dirname, '../web-adapter/src/adapters/index.ts') },
      { find: /^@tensnap\/web-adapter\/adapters\/(.*)$/, replacement: path.resolve(__dirname, '../web-adapter/src/adapters/$1') },
    ],
  },
  server: {
    port: 3200,
    host: true
  }
});