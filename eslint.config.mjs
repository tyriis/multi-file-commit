import { defineConfig } from 'eslint/config'
import importX from 'eslint-plugin-import-x'
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
      // Match .prettierrc.js (`trailingComma: 'es5'`) instead of neostandard's
      // relaxed default, as the previous eslintrc did.
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
    },
  },
])
