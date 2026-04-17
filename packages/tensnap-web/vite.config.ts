import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { lingui } from '@lingui/vite-plugin';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import path from 'path';
import pkg from './package.json';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react({
      plugins: [['@lingui/swc-plugin', {}]],
    }),
    lingui(),
    vanillaExtractPlugin()
  ],
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, './src/$1') },
      { find: /^@tensnap\/web-adapter$/, replacement: path.resolve(__dirname, '../web-adapter/src/index.ts') },
      { find: /^@tensnap\/web-adapter\/(.*)$/, replacement: path.resolve(__dirname, '../web-adapter/src/$1') },
    ],
  },
  server: {
    port: 3200,
    host: true
  }
});