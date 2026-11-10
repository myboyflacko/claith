import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "smol-toml";
import { appSettings, type AppSettings } from "../../settings.js";
import { profileNameSchema, type AgentProfile } from "./schema.js";
import {
  validateAgentProfileConfig,
  validateAgentPrompt,
} from "./validation.js";

async function load<T>(
  path: string,
  decode: (contents: string) => T,
): Promise<T> {
  try {
    return decode(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot load ${path}: ${String(error)}`, { cause: error });
  }
}

export async function parseAgentProfile(
  name: string,
  settings: AppSettings = appSettings,
): Promise<AgentProfile> {
  profileNameSchema.parse(name);
  const agentsDir = join(settings.configDir, "agents");
  const profileDir = join(agentsDir, name);
  const config = await load(join(profileDir, "config.toml"), (text) =>
    validateAgentProfileConfig(parse(text)),
  );
  const prompt = await load(join(profileDir, "prompt.md"), validateAgentPrompt);
  const skills = {
    shared: join(agentsDir, "skills"),
    profile: join(profileDir, "skills"),
  };
  for (const path of Object.values(skills)) {
    try {
      if (!(await stat(path)).isDirectory())
        throw new Error("Expected a directory");
    } catch (error) {
      throw new Error(
        `Cannot load skills directory ${path}: ${String(error)}`,
        { cause: error },
      );
    }
  }
  return { name, config, prompt, skills };
}
