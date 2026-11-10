import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDirectories } from "../src/infrastructure/configuration/directories/create.js";
import type { DirectoryStructure } from "../src/infrastructure/configuration/directories/schema.js";

describe("directory structure", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "claith-directories-"));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("creates the default structure and missing parents without files", async () => {
    const configDir = join(temporaryDirectory, "missing", ".claith");
    await createDirectories({ configDir });
    const entries = await readdir(configDir, { withFileTypes: true });
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      "agents",
      "log",
      "sessions",
      "worktrees",
    ]);
    for (const entry of entries) {
      expect(entry.isDirectory()).toBe(true);
      expect(await readdir(join(configDir, entry.name))).toEqual(
        entry.name === "agents" ? ["skills"] : [],
      );
    }
  });

  it("creates every level of a nested structure", async () => {
    const structure = {
      agents: { prompts: { system: {}, user: {} } },
      sessions: { archives: {} },
    } satisfies DirectoryStructure;
    await createDirectories({ configDir: temporaryDirectory }, structure);
    expect((await readdir(temporaryDirectory)).sort()).toEqual([
      "agents",
      "sessions",
    ]);
    expect(
      (await readdir(join(temporaryDirectory, "agents", "prompts"))).sort(),
    ).toEqual(["system", "user"]);
    for (const path of [
      ["agents", "prompts", "system"],
      ["agents", "prompts", "user"],
      ["sessions", "archives"],
    ]) {
      expect(await readdir(join(temporaryDirectory, ...path))).toEqual([]);
    }
  });

  it("creates the root for an empty structure", async () => {
    const configDir = join(temporaryDirectory, "empty");
    await createDirectories({ configDir }, {});
    expect(await readdir(configDir)).toEqual([]);
  });

  it("preserves existing contents and restores missing directories", async () => {
    const settings = { configDir: temporaryDirectory };
    await createDirectories(settings);
    const configFile = join(temporaryDirectory, "config.toml");
    const agentFile = join(temporaryDirectory, "agents", "custom.md");
    await writeFile(configFile, "existing configuration");
    await writeFile(agentFile, "existing agent");
    await rm(join(temporaryDirectory, "sessions"), { recursive: true });
    await createDirectories(settings);
    await createDirectories(settings);
    expect(await readFile(configFile, "utf8")).toBe("existing configuration");
    expect(await readFile(agentFile, "utf8")).toBe("existing agent");
    expect(await readdir(join(temporaryDirectory, "sessions"))).toEqual([]);
  });

  it.each([".", "agents", "agents/skills", "sessions", "worktrees", "log"])(
    "reports and preserves a file blocking %s",
    async (directory) => {
      const configDir = join(temporaryDirectory, ".claith");
      if (directory !== ".")
        await mkdir(join(configDir, directory, ".."), { recursive: true });
      const path = join(configDir, directory);
      await writeFile(path, "preserve me");
      const result = createDirectories({ configDir });
      await expect(result).rejects.toThrow(`Cannot create directory ${path}`);
      await expect(result).rejects.toHaveProperty("cause");
      expect(await readFile(path, "utf8")).toBe("preserve me");
    },
  );

  it("reports a blocking file at a nested level", async () => {
    const path = join(temporaryDirectory, "agents", "prompts");
    await mkdir(join(temporaryDirectory, "agents"));
    await writeFile(path, "preserve me");
    await expect(
      createDirectories(
        { configDir: temporaryDirectory },
        { agents: { prompts: { system: {} } } },
      ),
    ).rejects.toThrow(`Cannot create directory ${path}`);
    expect(await readFile(path, "utf8")).toBe("preserve me");
  });
});
