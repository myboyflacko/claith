import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { identity } from "../domain/contracts.js";

export const projectId = (project: string): string =>
  createHash("sha256").update(project).digest("hex").slice(0, 24);
export function taskDirectory(
  root: string,
  project: string,
  session: string,
  execution: string,
): string {
  identity.parse(session);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(execution))
    throw new Error("Invalid execution identity");
  return join(root, "sessions", projectId(project), session, execution);
}
export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  await rename(temp, path);
}
export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export async function logEvent(path: string, event: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(
    path,
    JSON.stringify({ timestamp: new Date().toISOString(), event }) + "\n",
  );
}
