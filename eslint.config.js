// ESLint flat config for every TypeScript package in the monorepo.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cdk.out/**',
      '**/coverage/**',
      'packages/frontend/test-results/**',
      'packages/frontend/playwright-report/**',
      'packages/infra/**/*.js',
      'packages/infra/**/*.d.ts',
      'ios/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Loosely typed JSON (element geometry, MCP payloads) is common here; flag it without failing CI.
      '@typescript-eslint/no-explicit-any': 'warn',
      // `open ? close() : show()` and `cond && run()` are used as statements on purpose.
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
    },
  },
  {
    files: ['packages/frontend/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['packages/infra/jest.config.js'],
    languageOptions: { sourceType: 'commonjs' },
  },
  prettier,
);
