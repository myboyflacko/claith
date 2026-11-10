import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultAgentProfiles } from "../src/infrastructure/configuration/agentProfiles/create.js";
import { parseAgentProfile } from "../src/infrastructure/configuration/agentProfiles/parser.js";
import {
  agentRoles,
  type AgentProfileConfig,
  type AgentRole,
} from "../src/infrastructure/configuration/agentProfiles/schema.js";
import { defaultAgentProfiles } from "../src/infrastructure/configuration/agentProfiles/templates/index.js";
import {
  validateAgentProfileConfig,
  validateAgentPrompt,
} from "../src/infrastructure/configuration/agentProfiles/validation.js";

function config(role: AgentRole = "implementer"): AgentProfileConfig {
  return {
    ...defaultAgentProfiles[role].config,
    model: {
      ...defaultAgentProfiles[role].config.model,
      provider: "test-provider",
      name: "test-model",
    },
  };
}

describe("agent profile validation", () => {
  it("requires core config fields, including model identity and reasoning", () => {
    for (const key of ["role", "permissions", "model"]) {
      const value: Record<string, unknown> = { ...config() };
      delete value[key];
      expect(() => validateAgentProfileConfig(value)).toThrow(key);
    }
    for (const key of ["provider", "name", "reasoning"]) {
      const model: Record<string, unknown> = { ...config().model };
      delete model[key];
      expect(() => validateAgentProfileConfig({ ...config(), model })).toThrow(
        key,
      );
    }
  });

  it.each([
    { ...config(), role: "unknown" },
    { ...config(), reasoning: "medium" },
    { ...config(), model: { ...config().model, reasoning: "invalid" } },
    { ...config(), additionalSkillsDirs: "not-an-array" },
    { ...config(), additionalSkillsDirs: [""] },
    { ...config(), additionalSkillsDirs: ["   "] },
    { ...config(), additionalSkillsDirs: [42] },
    { ...config(), permissions: "all" },
    { ...config(), tools: ["bash"] },
    { ...config(), instructions: "Use prompt.md instead" },
    { ...config(), model: { ...config().model, extra: true } },
    { ...config(), model: { ...config().model, provider: "" } },
    { ...config(), model: { ...config().model, name: " " } },
  ])("rejects invalid config %j", (value) => {
    expect(() => validateAgentProfileConfig(value)).toThrow();
  });

  it.each(["reviewer", "planner"] as const)("keeps %s read-only", (role) => {
    expect(() =>
      validateAgentProfileConfig({
        ...config(role),
        permissions: "read-write",
      }),
    ).toThrow("permissions");
    expect(validateAgentProfileConfig(config(role))).toEqual(config(role));
  });

  it("allows a restricted implementer", () => {
    expect(
      validateAgentProfileConfig({ ...config(), permissions: "read-only" })
        .permissions,
    ).toBe("read-only");
  });

  it("rejects blank prompts and preserves formatting in valid prompts", () => {
    expect(() => validateAgentPrompt(" \n\t")).toThrow("prompt.md");
    expect(validateAgentPrompt("# Prompt\n\nKeep formatting.\n")).toBe(
      "# Prompt\n\nKeep formatting.\n",
    );
  });
});

describe("agent profile files", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "claith-profiles-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function profilePath(name: string, file: string) {
    return join(root, "agents", name, file);
  }

  async function saveProfile(name: string, role: AgentRole = "implementer") {
    await mkdir(profilePath(name, "skills"), { recursive: true });
    await mkdir(join(root, "agents", "skills"), { recursive: true });
    await writeFile(profilePath(name, "config.toml"), stringify(config(role)));
    await writeFile(profilePath(name, "prompt.md"), "# Custom prompt\n");
  }

  it("creates all standard profiles and shared skills under missing parents", async () => {
    const configDir = join(root, "missing", ".claith");
    await createDefaultAgentProfiles({ configDir });
    expect(await readdir(configDir)).toEqual(["agents"]);
    expect((await readdir(join(configDir, "agents"))).sort()).toEqual([
      "implementer",
      "planner",
      "reviewer",
      "skills",
    ]);
    expect(await readdir(join(configDir, "agents", "skills"))).toEqual([]);
    for (const role of agentRoles) {
      const directory = join(configDir, "agents", role);
      expect((await readdir(directory)).sort()).toEqual([
        "config.toml",
        "prompt.md",
        "skills",
      ]);
      expect(
        parse(await readFile(join(directory, "config.toml"), "utf8")),
      ).toEqual(defaultAgentProfiles[role].config);
      expect(await readFile(join(directory, "prompt.md"), "utf8")).toBe(
        defaultAgentProfiles[role].prompt + "\n",
      );
      expect(await readdir(join(directory, "skills"))).toEqual([]);
      await expect(parseAgentProfile(role, { configDir })).rejects.toThrow(
        "Select a provider",
      );
    }
  });

  it.each(agentRoles)(
    "loads configured %s profiles and both skill paths",
    async (role) => {
      await createDefaultAgentProfiles({ configDir: root });
      await writeFile(
        profilePath(role, "config.toml"),
        stringify(config(role)),
      );
      const profile = await parseAgentProfile(role, { configDir: root });
      expect(profile).toEqual({
        name: role,
        config: config(role),
        prompt: defaultAgentProfiles[role].prompt + "\n",
        skills: {
          shared: join(root, "agents", "skills"),
          profile: profilePath(role, "skills"),
          additional: [],
        },
      });
    },
  );

  it("loads a custom profile by name without provisioning standard profiles", async () => {
    await saveProfile("reviewer-fast", "reviewer");
    const profile = await parseAgentProfile("reviewer-fast", {
      configDir: root,
    });
    expect(profile.name).toBe("reviewer-fast");
    expect(profile.config.role).toBe("reviewer");
    expect(profile.prompt).toBe("# Custom prompt\n");
    expect((await readdir(join(root, "agents"))).sort()).toEqual([
      "reviewer-fast",
      "skills",
    ]);
  });

  it("resolves additional skill directories relative to the profile and keeps absolute paths", async () => {
    await saveProfile("custom");
    const relative = "extra-skills";
    const absolute = join(root, "external-skills");
    await mkdir(profilePath("custom", relative));
    await mkdir(absolute);
    await writeFile(
      profilePath("custom", "config.toml"),
      stringify({
        ...config(),
        additionalSkillsDirs: [relative, absolute],
        model: { ...config().model, reasoning: "high" },
      }),
    );

    const profile = await parseAgentProfile("custom", { configDir: root });
    expect(profile.skills.additional).toEqual([
      profilePath("custom", relative),
      absolute,
    ]);
    expect(profile.config.model.reasoning).toBe("high");
    expect(profile.config.additionalSkillsDirs).toEqual([relative, absolute]);
  });

  it("uses no additional skill paths when the optional field is omitted", async () => {
    await saveProfile("custom");
    const value = config();
    delete value.additionalSkillsDirs;
    await writeFile(profilePath("custom", "config.toml"), stringify(value));

    const profile = await parseAgentProfile("custom", { configDir: root });
    expect(profile.skills.additional).toEqual([]);
    expect(profile.config).not.toHaveProperty("additionalSkillsDirs");
  });

  it.each(["missing", "file"])(
    "rejects an additional skills path that is %s without creating it",
    async (kind) => {
      await saveProfile("custom");
      const path = join(root, "external-skills");
      if (kind === "file") await writeFile(path, "preserve me");
      await writeFile(
        profilePath("custom", "config.toml"),
        stringify({
          ...config(),
          additionalSkillsDirs: [path],
        }),
      );

      await expect(
        parseAgentProfile("custom", { configDir: root }),
      ).rejects.toThrow(path);
      if (kind === "file")
        expect(await readFile(path, "utf8")).toBe("preserve me");
      else await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("restores missing standard files and directories while preserving user content", async () => {
    await createDefaultAgentProfiles({ configDir: root });
    const contents = "# User configuration\n" + stringify(config());
    await writeFile(profilePath("implementer", "config.toml"), contents);
    await rm(profilePath("implementer", "prompt.md"));
    await writeFile(profilePath("reviewer", "prompt.md"), "User prompt\n");
    await rm(profilePath("reviewer", "config.toml"));
    await writeFile(profilePath("reviewer", "skills/custom.md"), "user skill");
    await rm(join(root, "agents", "planner"), { recursive: true });
    await rm(join(root, "agents", "skills"), { recursive: true });
    await writeFile(join(root, "agents", "implementer.toml"), "old profile");
    await createDefaultAgentProfiles({ configDir: root });
    await createDefaultAgentProfiles({ configDir: root });

    expect(
      await readFile(profilePath("implementer", "config.toml"), "utf8"),
    ).toBe(contents);
    expect(
      await readFile(profilePath("implementer", "prompt.md"), "utf8"),
    ).toBe(defaultAgentProfiles.implementer.prompt + "\n");
    expect(await readFile(profilePath("reviewer", "prompt.md"), "utf8")).toBe(
      "User prompt\n",
    );
    expect(
      parse(await readFile(profilePath("reviewer", "config.toml"), "utf8")),
    ).toEqual(defaultAgentProfiles.reviewer.config);
    expect(
      await readFile(profilePath("reviewer", "skills/custom.md"), "utf8"),
    ).toBe("user skill");
    expect(
      await readFile(join(root, "agents", "implementer.toml"), "utf8"),
    ).toBe("old profile");
    expect(await readdir(join(root, "agents", "skills"))).toEqual([]);
    expect(await readFile(profilePath("planner", "prompt.md"), "utf8")).toBe(
      defaultAgentProfiles.planner.prompt + "\n",
    );
  });

  it.each(["config.toml", "prompt.md", "skills"])(
    "reports missing %s without restoring it",
    async (file) => {
      await saveProfile("custom");
      const path = profilePath("custom", file);
      await rm(path, { recursive: true });
      const result = parseAgentProfile("custom", { configDir: root });
      await expect(result).rejects.toThrow(path);
      await expect(result).rejects.toHaveProperty("cause");
      await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("reports missing shared skills without restoring the directory", async () => {
    await saveProfile("custom");
    const path = join(root, "agents", "skills");
    await rm(path, { recursive: true });
    await expect(
      parseAgentProfile("custom", { configDir: root }),
    ).rejects.toThrow(path);
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports a missing profile without creating directories", async () => {
    await expect(
      parseAgentProfile("missing", { configDir: root }),
    ).rejects.toThrow(profilePath("missing", "config.toml"));
    expect(await readdir(root)).toEqual([]);
  });

  it.each([
    "../outside",
    "/absolute",
    "nested/profile",
    "nested\\profile",
    ".",
    "",
    "skills",
    "SKILLS",
  ])("rejects invalid or reserved profile name %s", async (name) => {
    await expect(
      parseAgentProfile(name, { configDir: root }),
    ).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
  });

  it.each([
    ["config.toml", "broken = [", "config.toml"],
    [
      "config.toml",
      stringify({
        ...config(),
        model: { ...config().model, reasoning: "invalid" },
      }),
      "reasoning",
    ],
    ["prompt.md", " \n", "prompt.md"],
  ])("reports invalid %s with its file path", async (file, contents, field) => {
    await saveProfile("custom");
    const path = profilePath("custom", file!);
    await writeFile(path, contents!);
    const result = parseAgentProfile("custom", { configDir: root });
    await expect(result).rejects.toThrow(path);
    await expect(result).rejects.toThrow(field!);
    expect(await readFile(path, "utf8")).toBe(contents);
  });

  it("preserves invalid existing standard files instead of silently replacing them", async () => {
    await createDefaultAgentProfiles({ configDir: root });
    const path = profilePath("implementer", "config.toml");
    await writeFile(path, "broken = [");
    await createDefaultAgentProfiles({ configDir: root });
    expect(await readFile(path, "utf8")).toBe("broken = [");
    await expect(
      parseAgentProfile("implementer", { configDir: root }),
    ).rejects.toThrow(path);
  });

  it("reports a file blocking a required profile directory", async () => {
    await mkdir(join(root, "agents"));
    const path = join(root, "agents", "implementer");
    await writeFile(path, "preserve me");
    await expect(
      createDefaultAgentProfiles({ configDir: root }),
    ).rejects.toThrow(path);
    expect(await readFile(path, "utf8")).toBe("preserve me");
  });

  it.each(["config.toml", "prompt.md"])(
    "rejects a directory blocking %s",
    async (file) => {
      await createDefaultAgentProfiles({ configDir: root });
      const path = profilePath("implementer", file);
      await rm(path);
      await mkdir(path);
      await expect(
        createDefaultAgentProfiles({ configDir: root }),
      ).rejects.toThrow(path);
      expect((await stat(path)).isDirectory()).toBe(true);
    },
  );

  it("keeps the supplied template instructions and gives the planner a read-only prompt", () => {
    expect(defaultAgentProfiles.implementer.prompt).toContain(
      "Submit via submit_implementation",
    );
    expect(defaultAgentProfiles.reviewer.prompt).toContain("Use submit_review");
    expect(defaultAgentProfiles.planner.prompt).toContain(
      "human-approved Delivery Contract",
    );
    expect(defaultAgentProfiles.planner.prompt).toContain("You are read-only.");
  });
});
