import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "smol-toml";
import { appSettings, type AppSettings } from "../../settings.js";
import { initialClaithConfig } from "./schema.js";
import { validateClaithConfig } from "./validation.js";

export async function createClaithConfig(
  settings: AppSettings = appSettings,
): Promise<void> {
  const path = join(settings.configDir, "config.toml");
  const contents = stringify(validateClaithConfig(initialClaithConfig));
  try {
    await mkdir(settings.configDir, { recursive: true });
    try {
      await writeFile(path, contents, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } catch (error) {
    throw new Error(`Cannot create ${path}: ${String(error)}`, {
      cause: error,
    });
  }
}
