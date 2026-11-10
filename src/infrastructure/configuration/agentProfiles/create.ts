import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "smol-toml";
import { appSettings, type AppSettings } from "../../settings.js";
import { createDirectories } from "../directories/create.js";
import { defaultAgentProfiles } from "./templates/index.js";

async function writeMissing(path: string, contents: string): Promise<void> {
  try {
    await writeFile(path, contents, { flag: "wx" });
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "EEXIST" &&
      (await stat(path)).isFile()
    )
      return;
    throw new Error(`Cannot create ${path}: ${String(error)}`, {
      cause: error,
    });
  }
}

/** Restore missing standard files without overwriting user edits. */
export async function createDefaultAgentProfiles(
  settings: AppSettings = appSettings,
): Promise<void> {
  const agentsDir = join(settings.configDir, "agents");
  await createDirectories({ configDir: agentsDir }, { skills: {} });
  for (const [name, template] of Object.entries(defaultAgentProfiles)) {
    const profileDir = join(agentsDir, name);
    await createDirectories({ configDir: profileDir }, { skills: {} });
    await writeMissing(
      join(profileDir, "config.toml"),
      "# Select a provider and model before loading this profile.\n" +
        stringify(template.config),
    );
    await writeMissing(join(profileDir, "prompt.md"), template.prompt + "\n");
  }
}
