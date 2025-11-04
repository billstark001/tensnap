import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), vanillaExtractPlugin()],

  // Vite options tailored for Tauri development
  clearScreen: false,

  // Tauri expects a fixed port, fail if that port is not available
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: /^tensnap-web-utils\/file-system$/, replacement: path.resolve(__dirname, '../tensnap-web-utils/src/file-system/index.ts') },
      { find: /^tensnap-web-utils$/, replacement: path.resolve(__dirname, '../tensnap-web-utils/index.ts') },
      { find: /^tensnap-web\/Providers$/, replacement: path.resolve(__dirname, '../tensnap-web/src/Providers.tsx') },
      { find: /^tensnap-web\/App$/, replacement: path.resolve(__dirname, '../tensnap-web/src/App.tsx') },
      { find: /^tensnap-web\/store\/file-system\/adapter$/, replacement: path.resolve(__dirname, '../tensnap-web/src/store/file-system/adapter.ts') },
      { find: /^tensnap-web\/store\/file-system\/provider$/, replacement: path.resolve(__dirname, '../tensnap-web/src/store/file-system/provider.tsx') },
      { find: /^tensnap-web\/types\/file$/, replacement: path.resolve(__dirname, '../tensnap-web/src/types/file.ts') },
      { find: /^tensnap-web/, replacement: path.resolve(__dirname, '../tensnap-web') },
    ],
  },

  build: {
    // Tauri supports es2021
    target: process.env.TAURI_PLATFORM == 'windows' ? 'chrome105' : 'safari13',
    // don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
