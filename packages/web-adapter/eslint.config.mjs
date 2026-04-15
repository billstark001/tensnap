import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  {
    ignores: ['dist', 'node_modules'],
  },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      parser: tsParser,
      globals: {
        browser: true,
        es2021: true,
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...typescript.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@tensnap/web',
                '@tensnap/web/*',
                '!@tensnap/web/types/*',
                '!@tensnap/web/styles/*',
                '!@tensnap/web/utils/*',
                '!@tensnap/web/components/ui',
                '!@tensnap/web/components/ui/*',
              ],
              message:
                'web-adapter can only import from @tensnap/web/types/*, @tensnap/web/styles/*, @tensnap/web/utils/*, @tensnap/web/components/ui/*',
            },
          ],
        },
      ],
    },
  },
];