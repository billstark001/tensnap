import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import path from 'path';
import { tensnapCodeSplitting } from '../../scripts/vite-chunks.mjs';

export default defineConfig({
  plugins: [preact()],
  root: __dirname,
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 500,
    rolldownOptions: {
      output: {
        codeSplitting: tensnapCodeSplitting,
      },
    },
  },
  server: {
    port: 5180,
    open: true,
  },
  preview: {
    port: 4180,
    open: true,
  }
});
