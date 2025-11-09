/** @type {import('@lingui/conf').LinguiConfig} */
module.exports = {
  locales: ['en', 'zh', 'ja'],
  sourceLocale: 'en',
  catalogs: [
    {
      path: '<rootDir>/src/locales/{locale}/messages',
      include: ['src', '../tensnap-web-utils/src'],
      exclude: ['**/node_modules/**'],
    },
  ],
  format: 'po',
  compileNamespace: 'es',
};
