import { agentProfileConfigSchema, agentPromptSchema } from "./schema.js";
import type { AgentProfileConfig } from "./schema.js";

export function validateAgentProfileConfig(value: unknown): AgentProfileConfig {
  return agentProfileConfigSchema.parse(value);
}

export function validateAgentPrompt(value: unknown): string {
  return agentPromptSchema.parse(value);
}
