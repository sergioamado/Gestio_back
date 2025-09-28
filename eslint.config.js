// eslint.config.js
const js = require("@eslint/js");
const tseslint = require("typescript-eslint");

module.exports = [
  {
    ignores: ["dist", "node_modules"], // replaces .eslintignore
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off",
    },
  },
];
