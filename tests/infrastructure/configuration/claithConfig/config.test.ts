import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "smol-toml";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
} from "vitest";
import { createClaithConfig } from "../../../../src/infrastructure/configuration/claithConfig/create.js";
import { parseClaithConfig } from "../../../../src/infrastructure/configuration/claithConfig/parser.js";
import { initialClaithConfig } from "../../../../src/infrastructure/configuration/claithConfig/schema.js";
import type {
  ClaithConfig,
  ExecutionConfig,
  TemporalConfig,
} from "../../../../src/infrastructure/configuration/claithConfig/schema.js";
import { validateClaithConfig } from "../../../../src/infrastructure/configuration/claithConfig/validation.js";

function withField(section: keyof ClaithConfig, field: string, value: unknown) {
  return {
    ...initialClaithConfig,
    [section]: { ...initialClaithConfig[section], [field]: value },
  };
}

describe("Claith config validation", () => {
  it("returns the complete configuration with typed sections", () => {
    const config = validateClaithConfig(initialClaithConfig);
    expect(config).toEqual(initialClaithConfig);
    expectTypeOf(config).toEqualTypeOf<ClaithConfig>();
    expectTypeOf(config.temporal).toEqualTypeOf<TemporalConfig>();
    expectTypeOf(config.execution).toEqualTypeOf<ExecutionConfig>();
  });

  it.each(["temporal", "execution"] as const)(
    "rejects a missing %s section and each missing field",
    (section) => {
      const config: Record<string, unknown> = { ...initialClaithConfig };
      delete config[section];
      expect(() => validateClaithConfig(config)).toThrow(section);

      for (const field of Object.keys(initialClaithConfig[section])) {
        const fields: Record<string, unknown> = {
          ...initialClaithConfig[section],
        };
        delete fields[field];
        expect(() =>
          validateClaithConfig({ ...initialClaithConfig, [section]: fields }),
        ).toThrow(field);
      }
    },
  );

  it.each([
    ["temporal", "address", ""],
    ["temporal", "namespace", ""],
    ["temporal", "taskQueue", 42],
    ["temporal", "heartbeatIntervalSeconds", 0],
    ["temporal", "heartbeatTimeoutSeconds", -1],
    ["execution", "maxRepairs", -1],
    ["execution", "maxRepairs", 21],
    ["execution", "maxRepairs", 1.5],
    ["execution", "agentTimeoutSeconds", "1800"],
    ["execution", "checkTimeoutSeconds", 0],
    ["execution", "reminderSeconds", 0.5],
  ] as const)("rejects invalid %s.%s = %s", (section, field, value) => {
    expect(() =>
      validateClaithConfig(withField(section, field, value)),
    ).toThrow(field);
  });

  it.each([30, 31])("rejects a heartbeat interval of %s", (interval) => {
    expect(() =>
      validateClaithConfig(
        withField("temporal", "heartbeatIntervalSeconds", interval),
      ),
    ).toThrow(
      "heartbeatIntervalSeconds must be less than heartbeatTimeoutSeconds",
    );
  });

  it.each([0, 5, 20])("accepts a user maxRepairs value of %s", (maxRepairs) => {
    expect(
      validateClaithConfig(withField("execution", "maxRepairs", maxRepairs))
        .execution.maxRepairs,
    ).toBe(maxRepairs);
  });

  it("rejects unknown fields at the root and in both sections", () => {
    for (const config of [
      { ...initialClaithConfig, typo: true },
      withField("temporal", "typo", true),
      withField("execution", "typo", true),
    ]) {
      expect(() => validateClaithConfig(config)).toThrow("typo");
    }
  });
});

describe("Claith config files", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "claith-config-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("creates missing parents and a complete TOML file at the configured path", async () => {
    const settings = { configDir: join(directory, "missing", ".claith") };
    await createClaithConfig(settings);
    expect(await readdir(settings.configDir)).toEqual(["config.toml"]);
    const contents = await readFile(
      join(settings.configDir, "config.toml"),
      "utf8",
    );
    expect(contents).toContain("[temporal]");
    expect(contents).toContain("[execution]");
    expect(await parseClaithConfig(settings)).toEqual(initialClaithConfig);
  });

  it("preserves comments and user values on repeated creation and loading", async () => {
    const settings = { configDir: directory };
    const config = {
      temporal: { ...initialClaithConfig.temporal, namespace: "custom" },
      execution: { ...initialClaithConfig.execution, maxRepairs: 5 },
    };
    const contents = "# My configuration\n" + stringify(config);
    const path = join(directory, "config.toml");
    await writeFile(path, contents);
    await createClaithConfig(settings);
    await createClaithConfig(settings);
    expect(await parseClaithConfig(settings)).toEqual(config);
    expect(await readFile(path, "utf8")).toBe(contents);
  });

  it("reports a missing file without creating it", async () => {
    await expect(parseClaithConfig({ configDir: directory })).rejects.toThrow(
      `Cannot load ${join(directory, "config.toml")}`,
    );
    expect(await readdir(directory)).toEqual([]);
  });

  it.each([
    ["broken = [", "Cannot load", undefined],
    ["", "Invalid settings in", "temporal"],
    ["maxRepairs = 2", "Invalid settings in", "temporal"],
    [
      stringify(withField("execution", "maxRepairs", "invalid")),
      "Invalid settings in",
      "maxRepairs",
    ],
  ] as const)(
    "reports invalid contents without rewriting: %s",
    async (contents, message, field) => {
      const path = join(directory, "config.toml");
      await writeFile(path, contents);
      await createClaithConfig({ configDir: directory });
      const result = parseClaithConfig({ configDir: directory });
      await expect(result).rejects.toThrow(`${message} ${path}`);
      if (field) await expect(result).rejects.toThrow(field);
      await expect(result).rejects.toHaveProperty("cause");
      expect(await readFile(path, "utf8")).toBe(contents);
    },
  );

  it.each(["", "nested"])("reports a blocked directory %s", async (child) => {
    const blocked = join(directory, "blocked");
    await writeFile(blocked, "preserve me");
    const settings = { configDir: join(blocked, child) };
    await expect(createClaithConfig(settings)).rejects.toThrow(
      `Cannot create ${join(settings.configDir, "config.toml")}`,
    );
    expect(await readFile(blocked, "utf8")).toBe("preserve me");
  });
});
