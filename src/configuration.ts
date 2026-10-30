import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "smol-toml";
import { createDirectories } from "./infrastructure/directories.js";

import {
  executionRoles,
  resolveProfile,
  runtimeSchema,
} from "./domain/configuration.js";
import { rolePolicy } from "./domain/tools.js";
import type {
  ExecutionAgentProfile,
  ExecutionConfiguration,
  ExecutionRole,
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
  const runtimePath = join(configDir, "config.toml");
  const runtime = runtimeSchema.safeParse(await loadToml(runtimePath));
  if (!runtime.success)
    throw new Error(
      `Invalid settings in ${runtimePath}: ${runtime.error.message}`,
    );
  const agents = {} as Record<ExecutionRole, ExecutionAgentProfile>;
  for (const role of executionRoles) {
    const path = join(configDir, "agents", `${role}.toml`);
    const value = await loadToml(path);
    try {
      agents[role] = resolveProfile(role, value);
    } catch (error) {
      throw new Error(
        `Invalid ${role} profile in ${path}: ${String(error)}. Set permissions = "${rolePolicy[role].permissions}" and select a Pi provider/model.`,
        { cause: error },
      );
    }
  }
  return { runtime: runtime.data, agents };
}

export async function initializeConfiguration(
  configDir: string,
): Promise<void> {
  await createDirectories(configDir);
  const templates: [string, string][] = [
    ["config.toml", stringify(runtimeSchema.parse({}))],
  ];
  for (const role of executionRoles) {
    templates.push([
      join("agents", `${role}.toml`),
      "# Select a provider and model available in your existing Pi login.\n" +
        stringify({
          provider: "",
          model: "",
          reasoning: "medium",
          permissions: rolePolicy[role].permissions,
          instructions: `You are Claith's ${role}. Follow the approved task and use your structured completion tool.`,
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
