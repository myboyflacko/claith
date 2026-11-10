import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runCommand } from "../../src/infrastructure/process.js";
import { withOwnership } from "../../src/infrastructure/workspace/ownership.js";

const probes = vi.hoisted(() => ({ count: 0 }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      if (args[0] === "/proc/1/stat") {
        probes.count++;
        return Promise.reject(
          Object.assign(new Error("Process exited during stat read"), {
            code: "ESRCH",
          }),
        );
      }
      return actual.readFile(...args);
    },
  };
});
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
it("treats ESRCH during process-group scans as a vanished process", async () => {
  const root = await mkdtemp(join(tmpdir(), "claith-proc-race-"));
  roots.push(root);
  const before = probes.count;
  expect(
    await runCommand("printf done", {
      cwd: root,
      output: join(root, "command.log"),
      timeoutMs: 5000,
    }),
  ).toBe(0);
  expect(probes.count).toBeGreaterThan(before);
}, 30000);
it("allows ownership recovery past processes that vanish during enumeration", async () => {
  const root = await mkdtemp(join(tmpdir(), "claith-owner-race-"));
  roots.push(root);
  const lock = join(root, "lock");
  await mkdir(lock);
  await writeFile(
    join(lock, "old.process.json"),
    JSON.stringify({ host: hostname(), group: 999999999 }),
  );
  const before = probes.count;
  expect(await withOwnership(lock, async () => "recovered")).toBe("recovered");
  expect(probes.count).toBeGreaterThan(before);
}, 30000);
