import { defineConfig } from 'eslint/config'
import importX from 'eslint-plugin-import-x'
import prettierConfig from 'eslint-config-prettier'
import { neostandard } from 'neostandard'

export default defineConfig([
  ...neostandard({ noJsx: true }),
  {
    ignores: ['dist/', 'node_modules/'],
  },
  {
    plugins: {
      'import-x': importX,
    },
    rules: {
      'import-x/export': 'error',
      'import-x/first': 'error',
      'import-x/no-absolute-path': ['error', { esmodule: true, commonjs: true, amd: false }],
      'import-x/no-duplicates': 'error',
      'import-x/no-named-default': 'error',
      'import-x/no-webpack-loader-syntax': 'error',
    },
  },
  // Prettier owns formatting here (pre-commit runs it on every file), so switch
  // off the style rules it disagrees with. Without this, `eslint --fix` and the
  // pre-commit prettier hook keep reverting each other: neostandard wants a
  // space in `constructor (x)` and trailing commas in call arguments, while
  // .prettierrc.js produces `constructor(x)` and `trailingComma: 'es5'`.
  prettierConfig,
])
