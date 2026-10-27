import { hostname } from "node:os";
import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

interface Owner {
  host: string;
  pid: number;
  start: string;
  token: string;
}
async function assertProcessGroupsStopped(directory: string): Promise<void> {
  const groups = new Set<number>();
  async function collect(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await collect(file);
      else if (entry.name.endsWith(".process.json")) {
        const value = JSON.parse(await readFile(file, "utf8")) as {
          host: string;
          group: number;
          stopped?: boolean;
        };
        if (value.host !== hostname())
          throw new Error(
            "Cannot reconcile subprocesses owned by another host",
          );
        if (!value.stopped) groups.add(value.group);
      }
    }
  }
  await collect(directory);
  if (!groups.size) return;
  for (const pid of await readdir("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (fields[0] !== "Z" && groups.has(Number(fields[2])))
        throw new Error(
          `Previous subprocess group ${fields[2]} still has a live writer (${pid}); stop it before reconciliation`,
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
async function processStart(pid: number): Promise<string | null> {
  try {
    // Linux start ticks plus boot ID distinguish PID reuse and host reboots.
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    return (
      (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim() +
      ":" +
      stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(
      "Cannot establish that the previous workspace writer has stopped",
      { cause: error },
    );
  }
}
export async function withOwnership<T>(
  directory: string,
  action: () => Promise<T>,
): Promise<T> {
  const path = join(directory, "writer.json");
  const owner: Owner = {
    host: hostname(),
    pid: process.pid,
    start: (await processStart(process.pid))!,
    token: randomUUID(),
  };
  try {
    await writeFile(path, JSON.stringify(owner), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const previous = JSON.parse(await readFile(path, "utf8")) as Owner;
    if (
      previous.host !== hostname() ||
      (await processStart(previous.pid)) === previous.start
    ) {
      throw new Error(
        `Workspace already has a writer: ${previous.host}:${previous.pid}`,
        { cause: error },
      );
    }
    // Recovery itself is serialized by a second exclusive lock. Never steal a live lock.
    const recovery = path + ".recovery";
    await writeFile(recovery, owner.token, { flag: "wx" });
    try {
      if ((await readFile(path, "utf8")) !== JSON.stringify(previous))
        throw new Error("Workspace ownership changed during reconciliation", {
          cause: error,
        });
      await unlink(path);
      await writeFile(path, JSON.stringify(owner), { flag: "wx" });
    } finally {
      await unlink(recovery);
    }
  }
  try {
    await assertProcessGroupsStopped(directory);
    return await action();
  } finally {
    await release();
  }
  async function release(): Promise<void> {
    const current = JSON.parse(await readFile(path, "utf8")) as Owner;
    if (current.token !== owner.token)
      throw new Error("Workspace ownership changed unexpectedly");
    await unlink(path);
  }
}
