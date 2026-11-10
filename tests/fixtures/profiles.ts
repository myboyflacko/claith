import { resolveProfile } from "../../src/infrastructure/configuration/schema.js";
import type {
  AgentProfile,
  Role,
} from "../../src/infrastructure/configuration/schema.js";
import { rolePolicy } from "../../src/application/agents/tools.js";

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
