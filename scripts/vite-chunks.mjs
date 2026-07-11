/**
 * Shared cache-oriented chunk policy for the web renderer, Tauri webview, and
 * benchmark app. External groups are deliberately evaluated before workspace groups:
 * Rolldown otherwise absorbs a workspace package's dependency closure into its
 * chunk, which defeats the cache boundary and can hide an oversized vendor.
 */
const matches = (fragment) => (id) => id.replaceAll('\\', '/').includes(fragment);

export const tensnapCodeSplitting = {
  groups: [
    { name: 'vendor-leafer', test: matches('/leafer'), priority: 100 },
    { name: 'vendor-d3', test: matches('/d3'), priority: 100 },
    { name: 'vendor-react', test: (id) => matches('/react/')(id) || matches('/react-dom/')(id), priority: 100 },
    { name: 'vendor-ui', test: (id) => [
      '/@radix-ui/',
      '/@dnd-kit/',
      '/react-split/',
      '/lucide-react/',
    ].some((fragment) => matches(fragment)(id)), priority: 100 },
    { name: 'vendor-i18n', test: matches('/@lingui/'), priority: 100 },
    { name: 'vendor-state', test: (id) => matches('/zustand/')(id) || matches('/idb/')(id), priority: 100 },
    { name: 'vendor-data', test: (id) => [
      '/@msgpack/',
      '/zod/',
      '/pure-expr/',
    ].some((fragment) => matches(fragment)(id)), priority: 100 },
    { name: 'tensnap-core-environment', test: matches('/packages/core/src/environment/'), priority: 50 },
    { name: 'tensnap-core-chart', test: matches('/packages/core/src/chart/'), priority: 50 },
    { name: 'tensnap-core-runtime', test: matches('/packages/core/src/runtime/'), priority: 50 },
    { name: 'tensnap-core-scenario', test: matches('/packages/core/src/scenario/'), priority: 50 },
    { name: 'tensnap-core-snapshot', test: matches('/packages/core/src/snapshot/'), priority: 50 },
    { name: 'tensnap-core-asset', test: matches('/packages/core/src/asset/'), priority: 50 },
    { name: 'tensnap-core-utils', test: matches('/packages/core/src/utils/'), priority: 50 },
    { name: 'tensnap-core-parameter', test: matches('/packages/core/src/parameter/'), priority: 50 },
    { name: 'tensnap-core-transport', test: matches('/packages/core/src/transport/'), priority: 50 },
    { name: 'tensnap-core', test: matches('/packages/core/'), priority: 10 },
    { name: 'tensnap-protocol', test: matches('/packages/protocol/'), priority: 10 },
    { name: 'tensnap-web-common', test: matches('/packages/web-common/'), priority: 10 },
  ],
};
