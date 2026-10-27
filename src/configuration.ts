import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "smol-toml";
import { createDirectories } from "./infrastructure/directories.js";

import { roles, profileSchema, runtimeSchema } from "./domain/configuration.js";
import type {
  AgentProfile,
  ExecutionConfiguration,
  Role,
} from "./domain/configuration.js";
export * from "./domain/configuration.js";

async function loadToml(path: string): Promise<unknown> {
  try {
    return parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot load ${path}: ${String(error)}. Run 'claith init' for missing templates.`,
      { cause: error },
    );
  }
}

export async function loadConfiguration(
  configDir: string,
): Promise<ExecutionConfiguration> {
  const runtimePath = join(configDir, "claith.toml");
  const runtime = runtimeSchema.safeParse(await loadToml(runtimePath));
  if (!runtime.success)
    throw new Error(
      `Invalid settings in ${runtimePath}: ${runtime.error.message}`,
    );
  const agents = {} as Record<Role, AgentProfile>;
  for (const role of roles) {
    const path = join(configDir, "agents", `${role}.toml`);
    const profile = profileSchema.safeParse(await loadToml(path));
    if (!profile.success)
      throw new Error(
        `Invalid ${role} profile in ${path}: ${profile.error.message}`,
      );
    agents[role] = profile.data;
  }
  return { runtime: runtime.data, agents };
}

export async function initializeConfiguration(
  configDir: string,
): Promise<void> {
  await createDirectories(configDir);
  const templates: [string, string][] = [
    ["claith.toml", stringify(runtimeSchema.parse({}))],
  ];
  for (const role of roles) {
    templates.push([
      join("agents", `${role}.toml`),
      "# Select a provider and model available in your existing Pi login.\n" +
        stringify({
          provider: "",
          model: "",
          reasoning: "medium",
          instructions: `You are Claith's ${role}. Follow the approved Delivery Contract and use your structured completion tool.`,
        }),
    ]);
  }
  for (const [path, contents] of templates) {
    try {
      await writeFile(join(configDir, path), contents, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}
