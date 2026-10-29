import { resolveProfile } from "../../src/configuration.js";
import type { AgentProfile, Role } from "../../src/configuration.js";
import { rolePolicy } from "../../src/domain/tools.js";

export function agentProfile(
  role: Role,
  overrides: Partial<AgentProfile> = {},
) {
  return resolveProfile(role, {
    provider: "double",
    model: "double",
    instructions: "test",
    permissions: rolePolicy[role].permissions,
    ...overrides,
  });
}

export function agentProfiles() {
  return {
    implementer: agentProfile("implementer"),
    reviewer: agentProfile("reviewer"),
  };
}
