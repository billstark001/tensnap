import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { lingui } from '@lingui/vite-plugin';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import path from 'path';
import pkg from './package.json';
import { tensnapCodeSplitting } from '../../scripts/vite-chunks.mjs';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react({
      plugins: [['@lingui/swc-plugin', {}]],
    }),
    lingui(),
    vanillaExtractPlugin(),
  ],
  resolve: {
    alias: [{ find: /^@\/(.*)$/, replacement: path.resolve(__dirname, './src/$1') }],
    // Radix overlays must share one layer manager so modal teardown restores
    // body pointer events correctly across workspace packages.
    dedupe: ['@radix-ui/react-dismissable-layer'],
  },
  server: {
    port: 3200,
    host: true,
  },
  preview: {
    port: 3210,
    host: true,
  },
  build: {
    // Stable renderer/UI/runtime cache boundaries; retain the normal 500 KiB
    // warning for any eager chunk that escapes the shared split policy.
    chunkSizeWarningLimit: 500,
    rolldownOptions: {
      output: {
        codeSplitting: tensnapCodeSplitting,
      },
    },
  },
});
