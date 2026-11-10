import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { appSettings, type AppSettings } from "../../settings.js";
import { directoryStructure, type DirectoryStructure } from "./schema.js";

async function createTree(
  path: string,
  structure: DirectoryStructure,
): Promise<void> {
  try {
    await mkdir(path, { recursive: true });
  } catch (error) {
    throw new Error(`Cannot create directory ${path}: ${String(error)}`, {
      cause: error,
    });
  }
  for (const [name, children] of Object.entries(structure)) {
    await createTree(join(path, name), children);
  }
}

export async function createDirectories(
  settings: AppSettings = appSettings,
  structure: DirectoryStructure = directoryStructure,
): Promise<void> {
  await createTree(settings.configDir, structure);
}
