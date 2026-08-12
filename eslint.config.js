import js from "@eslint/js";
import eslintReact from "@eslint-react/eslint-plugin";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import-x";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  {
    ignores: [".react-router/**", "build/**", "node_modules/**", "public/build/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parser: typescriptParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
    },
    plugins: {
      "@eslint-react": eslintReact,
      "@typescript-eslint": typescriptEslint,
      "import-x": importPlugin,
      "jsx-a11y": jsxA11y,
      "react-hooks": reactHooks,
    },
    settings: {
      "import-x/resolver": {
        typescript: true,
      },
      "react-x": {
        version: "detect",
        importSource: "react",
      },
    },
    rules: {
      ...typescriptEslint.configs.recommended.rules,
      ...eslintReact.configs["recommended-typescript"].rules,
      ...jsxA11y.configs.recommended.rules,
      ...importPlugin.flatConfigs.recommended.rules,
      ...importPlugin.flatConfigs.typescript.rules,
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "import-x/no-unresolved": "off",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // TypeScript reports unresolved type and value identifiers with better context.
      "no-undef": "off",
    },
  },
];
