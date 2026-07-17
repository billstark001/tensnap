const TYPESCRIPT_LEGACY_API_VERSION = '6.0.3';

/**
 * TypeScript 7 is the native compiler and intentionally no longer exposes the
 * legacy JavaScript compiler API. These tools still execute that API at
 * runtime, so give only them a private TS 6 dependency until their upstream
 * releases adopt the TypeScript 7 APIs. TenSnap itself is compiled by TS 7.
 */
function useLegacyTypeScriptApi(pkg) {
  if (pkg.peerDependencies?.typescript) {
    delete pkg.peerDependencies.typescript;
  }
  pkg.dependencies = {
    ...pkg.dependencies,
    typescript: TYPESCRIPT_LEGACY_API_VERSION,
  };
  return pkg;
}

module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === 'zod-to-ts' || pkg.name?.startsWith('@typescript-eslint/')) {
        return useLegacyTypeScriptApi(pkg);
      }
      return pkg;
    },
  },
};
