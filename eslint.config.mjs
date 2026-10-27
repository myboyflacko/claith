import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    "dist/**",
    "coverage/**",
    ".agents/**",
    ".claude/**",
    ".codex/**",
  ]),
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
  { files: ["**/*.mjs"], extends: [js.configs.recommended] },
);
