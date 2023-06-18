module.exports = {
  trailingComma: 'es5',
  tabWidth: 2,
  semi: false,
  singleQuote: true,
  printWidth: 120,
  overrides: [
    {
      files: ['*.yaml', '*.json5', '*.yml', 'Dockerfile'],
      options: {
        singleQuote: false,
      },
    },
  ],
}
