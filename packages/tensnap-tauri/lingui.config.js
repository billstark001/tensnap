/** @type {import('@lingui/conf').LinguiConfig} */
module.exports = {
  locales: ['en', 'zh', 'ja'],
  sourceLocale: 'en',
  catalogs: [
    {
      path: '<rootDir>/../tensnap-web/src/locales/{locale}/messages',
      include: ['src', '../tensnap-web/src', '../web-adapter/src'],
      exclude: ['**/node_modules/**'],
    },
  ],
  format: 'po',
  compileNamespace: 'es',
};
