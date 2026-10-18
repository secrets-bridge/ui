// ESLint flat config (UI-N-07). Before this file existed `npm run
// lint` exited 2 ("couldn't find an eslint.config"), so none of the
// rules below, including the react-hooks ones behind the existing
// `eslint-disable` comments, were ever enforced. CI now runs lint.
//
// Mirrors the Vite React + TS template, using only the plugins already
// in devDependencies (no type-aware rules, so lint stays fast and needs
// no tsconfig project wiring).
import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  { ignores: ['dist', 'coverage', 'node_modules'] },
  js.configs.recommended,
  // parser + plugin + eslint-recommended overrides (turns off core rules
  // TypeScript already checks, e.g. no-undef) + the recommended set.
  ...tsPlugin.configs['flat/recommended'],
  // public/theme-init.js runs as a classic script before the app.
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { window: 'readonly', document: 'readonly' },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // rules-of-hooks stays an error; exhaustive-deps is the plugin's
      // default warn (intentional omissions carry a disable comment
      // with the reason next to them).
      ...reactHooks.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      // Fast-refresh hint only (dev HMR granularity), not a correctness
      // or security rule. Several modules export a hook or helper next
      // to a component on purpose; splitting them is a refactor, so it
      // stays a warning.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // `_`-prefixed args / vars are the deliberate "unused" marker.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
];
