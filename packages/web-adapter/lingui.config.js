import { formatter } from '@lingui/format-po'

/** @type {import('@lingui/conf').LinguiConfig} */
export default {
  locales: ['en', 'zh', 'ja'],
  sourceLocale: 'en',
  catalogs: [
    {
      path: '<rootDir>/src/locales/{locale}/messages',
      include: ['src', '../web-common/src'],
      exclude: ['**/node_modules/**'],
    },
  ],
  format: formatter({}),
  compileNamespace: 'es',
};
