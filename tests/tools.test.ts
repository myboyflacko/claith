import { describe, expect, it } from "vitest";
import {
  executionConfigurationSchema,
  executionProfileSchema,
  profileSchema,
} from "../src/configuration.js";
import { roles, ToolRegistry, toolRegistry } from "../src/domain/tools.js";
import { agentProfile, agentProfiles } from "./fixtures/profiles.js";

describe("tool permissions and execution snapshots", () => {
  it.each([undefined, "all", "", []])(
    "requires an explicit permission level (%s)",
    (permissions) => {
      expect(() =>
        profileSchema.parse({
          provider: "test",
          model: "test",
          instructions: "test",
          permissions,
        }),
      ).toThrow("permissions");
    },
  );

  it.each(["orchestrator", "reviewer"] as const)(
    "rejects read-write for %s at execution boundaries",
    (role) => {
      const profile = agentProfile(role);
      profile.permissions = "read-write";
      expect(() => executionProfileSchema(role).parse(profile)).toThrow(
        `${role} permissions must be read-only`,
      );
      if (role === "reviewer")
        expect(() =>
          executionConfigurationSchema.parse({
            runtime: {},
            agents: { ...agentProfiles(), reviewer: profile },
          }),
        ).toThrow("reviewer permissions must be read-only");
    },
  );

  it("can restrict the implementer to read-only including its completion tool", () => {
    expect(
      agentProfile("implementer", { permissions: "read-only" }).tools,
    ).toEqual(["read", "grep", "find", "ls", "submit_implementation"]);
  });

  it.each(["bash", "write", "edit", "submit_implementation", "unknown", "*"])(
    "rejects %s in a reviewer snapshot",
    (name) => {
      const profile = agentProfile("reviewer");
      profile.tools.push(name);
      expect(() => executionProfileSchema("reviewer").parse(profile)).toThrow(
        `Tool ${name} is not allowed`,
      );
    },
  );

  it("rejects duplicate names and missing structured completion tools", () => {
    const profile = agentProfile("implementer");
    expect(() =>
      executionProfileSchema("implementer").parse({
        ...profile,
        tools: [...profile.tools, "read"],
      }),
    ).toThrow("Duplicate tools");
    expect(() =>
      executionProfileSchema("implementer").parse({
        ...profile,
        tools: ["read"],
      }),
    ).toThrow("requires submit_implementation");
  });

  it("rejects duplicate registrations instead of replacing tools", () => {
    const read = toolRegistry.get("read")!;
    expect(() => new ToolRegistry([read, read])).toThrow(
      "Duplicate tool registration: read",
    );
  });

  it("grants new custom tools by role and permission without expanding saved selections", () => {
    const profile = agentProfile("reviewer");
    const base = [
      ...new Set(roles.flatMap((role) => agentProfile(role).tools)),
    ].map((name) => toolRegistry.get(name)!);
    const expanded = new ToolRegistry([
      ...base,
      {
        name: "read_report",
        permissions: "read-only",
        roles: ["reviewer"],
        source: "custom",
      },
      {
        name: "write_report",
        permissions: "read-write",
        roles: ["implementer"],
        source: "custom",
      },
    ]);
    expect(expanded.resolve("reviewer", "read-only")).toContain("read_report");
    expect(expanded.resolve("orchestrator", "read-only")).not.toContain(
      "read_report",
    );
    expect(expanded.resolve("implementer", "read-write")).toContain(
      "write_report",
    );
    expect(expanded.resolve("implementer", "read-only")).not.toContain(
      "write_report",
    );
    expanded.validate("reviewer", profile.permissions, profile.tools);
    expect(executionProfileSchema("reviewer").parse(profile).tools).toEqual(
      profile.tools,
    );
    expect(profile.tools).not.toContain("read_report");
  });
});
