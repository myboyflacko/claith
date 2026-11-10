import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "smol-toml";
import { appSettings, type AppSettings } from "../../settings.js";
import type { ClaithConfig } from "./schema.js";
import { validateClaithConfig } from "./validation.js";

export async function parseClaithConfig(
  settings: AppSettings = appSettings,
): Promise<ClaithConfig> {
  const path = join(settings.configDir, "config.toml");
  let value: unknown;
  try {
    value = parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot load ${path}: ${String(error)}`, { cause: error });
  }
  try {
    return validateClaithConfig(value);
  } catch (error) {
    throw new Error(`Invalid settings in ${path}: ${String(error)}`, {
      cause: error,
    });
  }
}
