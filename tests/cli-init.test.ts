import { execFile } from "node:child_process";
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
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parse } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initialClaithConfig } from "../src/infrastructure/configuration/claithConfig/schema.js";

const execFileAsync = promisify(execFile);
let homeDirectory: string;

beforeEach(async () => {
  homeDirectory = await mkdtemp(join(tmpdir(), "claith-init-"));
});
afterEach(async () => {
  await rm(homeDirectory, { recursive: true, force: true });
});

function run(...args: string[]) {
  return execFileAsync(
    process.execPath,
    ["--import", "tsx", "src/main.ts", ...args],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: { ...process.env, HOME: homeDirectory, USERPROFILE: homeDirectory },
      timeout: 10_000,
    },
  );
}

describe("init CLI process", () => {
  it("creates the complete layout without requiring configured models or a runtime connection", async () => {
    const { stdout, stderr } = await run("init");
    const root = join(homeDirectory, ".claith");
    expect(stdout).toContain(`Initialized configuration: ${root}`);
    expect(stderr).toBe("");
    expect((await readdir(root)).sort()).toEqual([
      "agents",
      "config.toml",
      "log",
      "sessions",
      "worktrees",
    ]);
    expect(parse(await readFile(join(root, "config.toml"), "utf8"))).toEqual(
      initialClaithConfig,
    );
    expect((await readdir(join(root, "agents"))).sort()).toEqual([
      "implementer",
      "planner",
      "reviewer",
      "skills",
    ]);
    expect(await readdir(join(root, "agents", "skills"))).toEqual([]);
    for (const role of ["implementer", "reviewer", "planner"]) {
      const profile = join(root, "agents", role);
      expect((await readdir(profile)).sort()).toEqual([
        "config.toml",
        "prompt.md",
        "skills",
      ]);
      expect(
        parse(await readFile(join(profile, "config.toml"), "utf8")),
      ).toMatchObject({
        role,
        description: expect.stringMatching(/\S/),
        skills: { additionalSkillsDirs: [] },
        model: { provider: "", name: "", reasoning: "medium" },
      });
      expect(
        (await readFile(join(profile, "prompt.md"), "utf8")).trim(),
      ).not.toBe("");
      expect(await readdir(join(profile, "skills"))).toEqual([]);
    }
  });

  it("preserves even invalid existing configs and restores missing files on repeated init", async () => {
    await run("init");
    const root = join(homeDirectory, ".claith");
    const config = join(root, "config.toml");
    const profileConfig = join(root, "agents", "implementer", "config.toml");
    const prompt = join(root, "agents", "implementer", "prompt.md");
    await writeFile(config, "broken = [");
    await writeFile(profileConfig, "also broken = [");
    await writeFile(prompt, "# User prompt\n");
    await rm(join(root, "agents", "reviewer"), { recursive: true });
    await rm(join(root, "sessions"), { recursive: true });

    await run("init");

    expect(await readFile(config, "utf8")).toBe("broken = [");
    expect(await readFile(profileConfig, "utf8")).toBe("also broken = [");
    expect(await readFile(prompt, "utf8")).toBe("# User prompt\n");
    expect(await readdir(join(root, "sessions"))).toEqual([]);
    expect((await readdir(join(root, "agents", "reviewer"))).sort()).toEqual([
      "config.toml",
      "prompt.md",
      "skills",
    ]);
  });

  it.each([[], ["--help"], ["-h"]])(
    "shows help without creating files for %j",
    async (...args) => {
      const { stdout } = await run(...args);
      expect(stdout).toContain("Usage: claith init");
      expect(await readdir(homeDirectory)).toEqual([]);
    },
  );

  it.each([["unknown"], ["init", "extra"], ["init", "--unknown"]])(
    "rejects invalid arguments %j before creating files",
    async (...args) => {
      await expect(run(...args)).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("Usage: claith init"),
      });
      expect(await readdir(homeDirectory)).toEqual([]);
    },
  );

  it("exits unsuccessfully when the root is blocked by a file", async () => {
    const root = join(homeDirectory, ".claith");
    await writeFile(root, "preserve me");
    await expect(run("init")).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(root),
    });
    expect(await readFile(root, "utf8")).toBe("preserve me");
  });

  it.each(["config.toml", "agents/implementer/config.toml"])(
    "reports an error when a directory blocks %s",
    async (relativePath) => {
      const path = join(homeDirectory, ".claith", relativePath);
      await mkdir(path, { recursive: true });
      await expect(run("init")).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(path),
        stdout: "",
      });
      expect(await readdir(path)).toEqual([]);
    },
  );
});
