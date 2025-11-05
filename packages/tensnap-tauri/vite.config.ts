import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import path from 'path';

// Custom plugin to resolve @ imports contextually for both tauri and tensnap-web
function tensnapWebAliasPlugin(): Plugin {
  const tensnapWebPath = path.resolve(__dirname, '../tensnap-web');
  const tensnapWebSrcPath = path.join(tensnapWebPath, 'src');
  const tauriSrcPath = path.resolve(__dirname, './src');

  return {
    name: 'tensnap-web-alias',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      // Handle @/ imports based on context
      if (source.startsWith('@/')) {
        const relativePath = source.slice(2); // Remove '@/'

        // If the importer is from tensnap-web, resolve to tensnap-web/src
        if (importer && importer.includes(tensnapWebPath)) {
          const resolvedPath = path.join(tensnapWebSrcPath, relativePath);
          const resolved = await this.resolve(resolvedPath, importer, { skipSelf: true, ...options });
          if (resolved && !resolved.external) {
            return resolved;
          }
        }

        // Otherwise, resolve to tauri/src (for tauri's own files)
        const resolvedPath = path.join(tauriSrcPath, relativePath);
        const resolved = await this.resolve(resolvedPath, importer, { skipSelf: true, ...options });
        if (resolved && !resolved.external) {
          return resolved;
        }
      }

      return null;
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), vanillaExtractPlugin(), tensnapWebAliasPlugin()],

  // Vite options tailored for Tauri development
  clearScreen: false,

  // Tauri expects a fixed port, fail if that port is not available
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  resolve: {
    alias: {
      // Specific aliases for tensnap-web-utils
      'tensnap-web-utils/file-system': path.resolve(__dirname, '../tensnap-web-utils/src/file-system/index.ts'),
      'tensnap-web-utils/adapters': path.resolve(__dirname, '../tensnap-web-utils/src/adapters/index.ts'),
      'tensnap-web-utils': path.resolve(__dirname, '../tensnap-web-utils/index.ts'),

      // Specific aliases for tensnap-web exports
      'tensnap-web/Providers': path.resolve(__dirname, '../tensnap-web/src/Providers.tsx'),
      'tensnap-web/App': path.resolve(__dirname, '../tensnap-web/src/App.tsx'),
      'tensnap-web/store/file-system/adapter': path.resolve(__dirname, '../tensnap-web/src/store/file-system/adapter.ts'),
      'tensnap-web/store/file-system/provider': path.resolve(__dirname, '../tensnap-web/src/store/file-system/provider.tsx'),
      'tensnap-web/store/file-system/store': path.resolve(__dirname, '../tensnap-web/src/store/file-system/store.ts'),
      'tensnap-web/types/file': path.resolve(__dirname, '../tensnap-web/src/types/file.ts'),
      'tensnap-web/styles/dialog.css': path.resolve(__dirname, '../tensnap-web/src/styles/dialog.css.ts'),
      'tensnap-web/utils/react': path.resolve(__dirname, '../tensnap-web/src/utils/react.ts'),
      'tensnap-web': path.resolve(__dirname, '../tensnap-web'),

      // Note: @ alias is handled by custom plugin to support both tauri and tensnap-web contexts
    },
  },

  build: {
    // Tauri supports es2021
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    // Don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});