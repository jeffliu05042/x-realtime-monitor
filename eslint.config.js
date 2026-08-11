export default [
  {
    ignores: ["data/**", "node_modules/**"],
  },
  {
    files: ["bin/**/*.js", "src/**/*.js", "test/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-constant-condition": "error",
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_", "caughtErrors": "none" }],
    },
  },
];
