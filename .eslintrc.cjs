module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', 'release', '.eslintrc.cjs'],
  // The main process is CommonJS running in Node, not a browser bundle.
  overrides: [
    {
      files: ['electron/**/*.cjs', 'scripts/**/*.cjs', '*.config.js', 'postcss.config.js', 'tailwind.config.js'],
      env: { browser: false, node: true, es2022: true },
      parserOptions: { sourceType: 'script', ecmaVersion: 2022 },
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
        // _-prefixed names mark values destructured only to be dropped.
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      },
    },
  ],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
  },
}
