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
      "sessions",
      "skills",
    ]);
    for (const entry of entries) {
      expect(entry.isDirectory()).toBe(true);
      expect(await readdir(join(configDir, entry.name))).toEqual([]);
    }
  });

  it("preserves existing contents and restores missing directories on repeated calls", async () => {
    const configDir = join(temporaryDirectory, ".claith");
    await createDirectories(configDir);
    await writeFile(join(configDir, "claith.toml"), "existing configuration");
    await writeFile(join(configDir, "agents", "custom.md"), "existing agent");
    await rm(join(configDir, "sessions"), { recursive: true });

    await createDirectories(configDir);
    await createDirectories(configDir);

    expect(await readFile(join(configDir, "claith.toml"), "utf8")).toBe(
      "existing configuration",
    );
    expect(await readFile(join(configDir, "agents", "custom.md"), "utf8")).toBe(
      "existing agent",
    );
    expect(await readdir(join(configDir, "sessions"))).toEqual([]);
  });

  it.each([".", "agents", "skills", "sessions"])(
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
      "sessions",
      "skills",
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
      ["agents", "sessions", "skills"],
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
