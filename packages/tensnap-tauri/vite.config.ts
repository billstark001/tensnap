import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import path from 'path';

// Custom plugin to resolve @ imports contextually for both tauri and tensnap-web
function tenasnapWebAliasPlugin(): Plugin {
  const tenasnapWebPath = path.resolve(__dirname, '../tensnap-web');
  const tenasnapWebSrcPath = path.join(tenasnapWebPath, 'src');
  const tauriSrcPath = path.resolve(__dirname, './src');
  
  return {
    name: 'tensnap-web-alias',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      // Handle @/ imports based on context
      if (source.startsWith('@/')) {
        const relativePath = source.slice(2); // Remove '@/'
        
        // If the importer is from tensnap-web, resolve to tensnap-web/src
        if (importer && importer.includes(tenasnapWebPath)) {
          const resolvedPath = path.join(tenasnapWebSrcPath, relativePath);
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

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), vanillaExtractPlugin(), tenasnapWebAliasPlugin()],

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
      // Specific aliases for tensnap-web-utils
      { find: /^tensnap-web-utils\/file-system$/, replacement: path.resolve(__dirname, '../tensnap-web-utils/src/file-system/index.ts') },
      { find: /^tensnap-web-utils\/adapters$/, replacement: path.resolve(__dirname, '../tensnap-web-utils/src/adapters/index.ts') },
      { find: /^tensnap-web-utils$/, replacement: path.resolve(__dirname, '../tensnap-web-utils/index.ts') },
      
      // Specific aliases for tensnap-web exports
      { find: /^tensnap-web\/Providers$/, replacement: path.resolve(__dirname, '../tensnap-web/src/Providers.tsx') },
      { find: /^tensnap-web\/App$/, replacement: path.resolve(__dirname, '../tensnap-web/src/App.tsx') },
      { find: /^tensnap-web\/store\/file-system\/adapter$/, replacement: path.resolve(__dirname, '../tensnap-web/src/store/file-system/adapter.ts') },
      { find: /^tensnap-web\/store\/file-system\/provider$/, replacement: path.resolve(__dirname, '../tensnap-web/src/store/file-system/provider.tsx') },
      { find: /^tensnap-web\/store\/file-system\/store$/, replacement: path.resolve(__dirname, '../tensnap-web/src/store/file-system/store.ts') },
      { find: /^tensnap-web\/types\/file$/, replacement: path.resolve(__dirname, '../tensnap-web/src/types/file.ts') },
      { find: /^tensnap-web\/styles\/dialog\.css$/, replacement: path.resolve(__dirname, '../tensnap-web/src/styles/dialog.css.ts') },
      { find: /^tensnap-web\/utils\/react$/, replacement: path.resolve(__dirname, '../tensnap-web/src/utils/react.ts') },
      { find: /^tensnap-web/, replacement: path.resolve(__dirname, '../tensnap-web') },
      
      // Note: @ alias is handled by custom plugin to support both tauri and tensnap-web contexts
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
