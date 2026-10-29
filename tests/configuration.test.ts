import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrap } from "../src/bootstrap.js";
import { createDirectories } from "../src/infrastructure/directories.js";
import { appSettings } from "../src/settings.js";
import { parse } from "smol-toml";
import { executionRoles as roles } from "../src/configuration.js";

const execFileAsync = promisify(execFile);
let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "claith-config-"));
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe("configuration directories", () => {
  it("creates only the required empty directories, including missing parents", async () => {
    const configDir = join(temporaryDirectory, "missing", ".claith");

    await createDirectories(configDir);

    const entries = await readdir(configDir, { withFileTypes: true });
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      "agents",
      "log",
      "sessions",
      "skills",
      "worktrees",
    ]);
    for (const entry of entries) {
      expect(entry.isDirectory()).toBe(true);
      expect(await readdir(join(configDir, entry.name))).toEqual([]);
    }
  });

  it("preserves existing contents and restores missing directories on repeated calls", async () => {
    const configDir = join(temporaryDirectory, ".claith");
    await createDirectories(configDir);
    await writeFile(join(configDir, "config.toml"), "existing configuration");
    await writeFile(join(configDir, "agents", "custom.md"), "existing agent");
    await rm(join(configDir, "sessions"), { recursive: true });

    await createDirectories(configDir);
    await createDirectories(configDir);

    expect(await readFile(join(configDir, "config.toml"), "utf8")).toBe(
      "existing configuration",
    );
    expect(await readFile(join(configDir, "agents", "custom.md"), "utf8")).toBe(
      "existing agent",
    );
    expect(await readdir(join(configDir, "sessions"))).toEqual([]);
  });

  it.each([".", "agents", "skills", "sessions", "worktrees", "log"])(
    "rejects when a file blocks the required directory %s",
    async (directory) => {
      const configDir = join(temporaryDirectory, ".claith");
      if (directory !== ".") {
        await mkdir(configDir);
      }
      const blockingFile = join(configDir, directory);
      await writeFile(blockingFile, "preserve me");

      await expect(createDirectories(configDir)).rejects.toThrow();
      expect(await readFile(blockingFile, "utf8")).toBe("preserve me");
    },
  );
});

describe("settings", () => {
  it("uses .claith in the user's home directory", () => {
    expect(appSettings.configDir).toBe(join(homedir(), ".claith"));
  });
});

describe("bootstrap", () => {
  it("creates directories at the configured path", async () => {
    const configDir = join(temporaryDirectory, "custom-config");

    await bootstrap({ configDir });

    expect((await readdir(configDir)).sort()).toEqual([
      "agents",
      "log",
      "sessions",
      "skills",
      "worktrees",
    ]);
  });

  it("propagates directory creation errors", async () => {
    const configDir = join(temporaryDirectory, "blocked");
    await writeFile(configDir, "preserve me");

    await expect(bootstrap({ configDir })).rejects.toThrow();
    expect(await readFile(configDir, "utf8")).toBe("preserve me");
  });
});

describe("application startup", () => {
  function startApplication() {
    return execFileAsync(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: {
        ...process.env,
        HOME: temporaryDirectory,
        USERPROFILE: temporaryDirectory,
      },
      timeout: 10_000,
    });
  }

  it("initializes the default configuration directory on startup", async () => {
    await startApplication();

    expect((await readdir(join(temporaryDirectory, ".claith"))).sort()).toEqual(
      ["agents", "log", "sessions", "skills", "worktrees"],
    );
  });

  it("exits unsuccessfully when the configuration directory cannot be created", async () => {
    await writeFile(join(temporaryDirectory, ".claith"), "preserve me");

    await expect(startApplication()).rejects.toMatchObject({ code: 1 });
    expect(await readFile(join(temporaryDirectory, ".claith"), "utf8")).toBe(
      "preserve me",
    );
  });
});

describe("runtime configuration", () => {
  it("creates explicit permission profiles and snapshots their resolved tools", async () => {
    const { initializeConfiguration, loadConfiguration } =
      await import("../src/configuration.js");
    await initializeConfiguration(temporaryDirectory);
    const entries = await readdir(temporaryDirectory);
    expect(entries).toContain("config.toml");
    expect(entries).not.toContain("claith.toml");
    expect((await readdir(join(temporaryDirectory, "agents"))).sort()).toEqual([
      "implementer.toml",
      "reviewer.toml",
    ]);
    for (const role of roles) {
      const path = join(temporaryDirectory, "agents", `${role}.toml`);
      const template = await readFile(path, "utf8");
      expect(parse(template)).toMatchObject({
        permissions: role === "implementer" ? "read-write" : "read-only",
      });
      expect(parse(template)).not.toHaveProperty("tools");
      await writeFile(
        path,
        template
          .replace('provider = ""', 'provider = "test"')
          .replace('model = ""', 'model = "test"'),
      );
    }
    const saved = await loadConfiguration(temporaryDirectory);
    expect(saved.agents.implementer.tools).toContain("bash");
    expect(saved.agents.reviewer.tools).toContain("read_diff");
    const path = join(temporaryDirectory, "agents", "implementer.toml");
    await writeFile(
      path,
      (await readFile(path, "utf8")).replace(
        'permissions = "read-write"',
        'permissions = "read-only"',
      ),
    );
    expect(
      (await loadConfiguration(temporaryDirectory)).agents.implementer.tools,
    ).not.toContain("bash");
    expect(saved.agents.implementer.tools).toContain("bash");
  });

  it.each([
    ["implementer", "", "permissions"],
    ["reviewer", 'permissions = "read-write"', "must be read-only"],
    ["implementer", 'permissions = "all"', "permissions"],
    [
      "implementer",
      'permissions = "read-only"\ntools = ["bash"]',
      "Unrecognized key",
    ],
  ])("rejects invalid rights in %s: %s", async (role, permissions, message) => {
    const { initializeConfiguration, loadConfiguration } =
      await import("../src/configuration.js");
    await initializeConfiguration(temporaryDirectory);
    for (const name of roles) {
      await writeFile(
        join(temporaryDirectory, "agents", `${name}.toml`),
        'provider = "test"\nmodel = "test"\ninstructions = "test"\n' +
          (role === name ? permissions : 'permissions = "read-only"'),
      );
    }
    await expect(loadConfiguration(temporaryDirectory)).rejects.toThrow(
      message,
    );
    await expect(loadConfiguration(temporaryDirectory)).rejects.toThrow(
      `${role}.toml`,
    );
  });

  it("creates templates without overwriting user files and requires explicit models", async () => {
    const { initializeConfiguration, loadConfiguration } =
      await import("../src/configuration.js");
    await initializeConfiguration(temporaryDirectory);
    await expect(loadConfiguration(temporaryDirectory)).rejects.toThrow(
      "Select a Pi provider",
    );
    const runtimeFile = join(temporaryDirectory, "config.toml");
    await writeFile(runtimeFile, "maxRepairs = 1\n");
    // Leftover files from older installations must not affect current settings.
    await writeFile(
      join(temporaryDirectory, "claith.toml"),
      "maxRepairs = 9\n",
    );
    for (const role of ["orchestrator", "implementer", "reviewer"]) {
      await writeFile(
        join(temporaryDirectory, "agents", `${role}.toml`),
        'provider = "test"\nmodel = "model"\ninstructions = "Follow contract"\npermissions = "read-only"\n',
      );
    }
    await initializeConfiguration(temporaryDirectory);
    expect(await readFile(runtimeFile, "utf8")).toBe("maxRepairs = 1\n");
    expect((await loadConfiguration(temporaryDirectory)).runtime).toMatchObject(
      {
        maxRepairs: 1,
        agentTimeoutSeconds: 1800,
        checkTimeoutSeconds: 600,
        heartbeatIntervalSeconds: 10,
        heartbeatTimeoutSeconds: 30,
        reminderSeconds: 3600,
      },
    );
  });

  it("identifies malformed TOML, missing profiles, and invalid settings", async () => {
    const { initializeConfiguration, loadConfiguration } =
      await import("../src/configuration.js");
    await expect(loadConfiguration(temporaryDirectory)).rejects.toThrow(
      "config.toml",
    );
    await initializeConfiguration(temporaryDirectory);
    await writeFile(join(temporaryDirectory, "config.toml"), "broken = [");
    await expect(loadConfiguration(temporaryDirectory)).rejects.toThrow(
      "Cannot load",
    );
    await writeFile(
      join(temporaryDirectory, "config.toml"),
      "heartbeatIntervalSeconds = 30",
    );
    await expect(loadConfiguration(temporaryDirectory)).rejects.toThrow(
      "heartbeatIntervalSeconds",
    );
    await writeFile(join(temporaryDirectory, "config.toml"), "");
    await rm(join(temporaryDirectory, "agents", "implementer.toml"));
    await expect(loadConfiguration(temporaryDirectory)).rejects.toThrow(
      "implementer.toml",
    );
  });
});
