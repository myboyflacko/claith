import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function createDirectories(configDir: string): Promise<void> {
  await mkdir(configDir, { recursive: true });

  for (const directory of [
    "agents",
    "skills",
    "sessions",
    "worktrees",
    "log",
  ]) {
    await mkdir(join(configDir, directory), { recursive: true });
  }
}
