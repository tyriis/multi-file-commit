module.exports = {
  root: true,
  env: {
    es2021: true,
    node: true,
  },
  extends: 'standard',
  overrides: [
    {
      files: ['.eslintrc.{js,cjs}'],
      parserOptions: {
        sourceType: 'script',
      },
    },
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    'comma-dangle': ['error', 'always-multiline'],
  },
}
