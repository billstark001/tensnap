/** @type {import('@lingui/conf').LinguiConfig} */
export default {
  locales: ['en', 'zh', 'ja'],
  sourceLocale: 'en',
  catalogs: [{
    path: '<rootDir>/../tensnap-web/src/locales/{locale}/messages',
    include: ['src', '../tensnap-web/src', '../web-common/src'],
    exclude: ['**/node_modules/**'],
  }],
  compileNamespace: 'es',
};
