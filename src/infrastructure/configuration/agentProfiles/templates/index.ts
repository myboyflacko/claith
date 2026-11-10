import type { AgentProfileConfig, AgentRole } from "../schema.js";
import { implementerSystemPrompt } from "./implementer.js";
import { reviewerSystemPrompt } from "./reviewer.js";
import { plannerSystemPrompt } from "./planner.js";

interface AgentProfileTemplate {
  config: AgentProfileConfig;
  prompt: string;
}

function template(
  role: AgentRole,
  prompt: string,
  description: string,
): AgentProfileTemplate {
  return {
    config: {
      role,
      description,
      permissions: role === "implementer" ? "read-write" : "read-only",
      skills: { additionalSkillsDirs: [] },
      // Templates need an explicit provider/model before they can be loaded.
      model: { provider: "", name: "", reasoning: "medium" },
    },
    prompt,
  };
}

export const defaultAgentProfiles = {
  implementer: template(
    "implementer",
    implementerSystemPrompt,
    "Implements approved tasks and provides verification evidence.",
  ),
  reviewer: template(
    "reviewer",
    reviewerSystemPrompt,
    "Reviews candidate changes against acceptance criteria and verification evidence.",
  ),
  planner: template(
    "planner",
    plannerSystemPrompt,
    "Plans the next behavior increment within the approved Delivery Contract.",
  ),
} satisfies Record<AgentRole, AgentProfileTemplate>;
