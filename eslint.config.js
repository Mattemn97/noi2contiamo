// ESLint flat config: typescript-eslint con controllo dei tipi, Prettier gestisce il formato.
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";
import tseslint from "typescript-eslint";

const IO_IMPORTS = [
  "react",
  "react-dom",
  "firebase",
  "firebase/*",
  "@firebase/*",
  "@noi2contiamo/data",
  "@noi2contiamo/data/*",
  "node:*",
];
const IO_GLOBALS = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "document",
  "window",
  "navigator",
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dev-dist/**",
      "**/.tsbuild/**",
      "server/**",
      "firebase/**",
      "data/**",
      "packages/data/src/api.gen.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { project: "./tsconfig.tools.json", tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Gli adapter implementano un'interfaccia a Promise: `async` senza `await` è voluto.
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  {
    // AC-7: il dominio resta puro (il test purity.test.ts fa lo stesso controllo).
    files: ["packages/core/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: IO_IMPORTS }],
      "no-restricted-globals": ["error", ...IO_GLOBALS],
    },
  },
  {
    // Spec 0003: accessibilità di base su ogni componente React.
    files: ["apps/web/src/**/*.tsx"],
    ...jsxA11y.flatConfigs.recommended,
  },
  {
    // Spec 0003: le pagine usano solo i componenti di ui/ (le librerie di base stanno dentro ui/).
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ignores: ["apps/web/src/ui/**", "apps/web/src/dev/**", "**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react-aria-components",
                "react-aria-components/*",
                "recharts",
                "recharts/*",
                "@tanstack/react-table",
              ],
              message: "Usa i componenti di apps/web/src/ui/ (e ui/charts per i grafici).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/contract/suite.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  prettier,
);
