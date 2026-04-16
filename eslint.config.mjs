import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";

export default [
    js.configs.recommended,
    {
        files: ["scripts/**/*.ts", "src/**/*.ts"],
        languageOptions: {
            parser: typescriptParser,
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module",
            },
            globals: {
                ...globals.node,
                Bun: "readonly",
            },
        },
        plugins: {
            "@typescript-eslint": typescript,
            "simple-import-sort": simpleImportSort,
        },
        rules: {
            ...typescript.configs.recommended.rules,
            "@typescript-eslint/no-unused-vars": "error",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/explicit-function-return-type": "off",
        },
    },
    {
        files: ["*.mjs"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
        },
    },
];
