import type { AgentProfileConfig, AgentRole } from "../schema.js";
import { implementerSystemPrompt } from "./implementer.js";
import { reviewerSystemPrompt } from "./reviewer.js";
import { plannerSystemPrompt } from "./planner.js";

interface AgentProfileTemplate {
  config: AgentProfileConfig;
  prompt: string;
}

function template(role: AgentRole, prompt: string): AgentProfileTemplate {
  return {
    config: {
      role,
      permissions: role === "implementer" ? "read-write" : "read-only",
      reasoning: "medium",
      // Templates need an explicit provider/model before they can be loaded.
      model: { provider: "", name: "" },
    },
    prompt,
  };
}

export const defaultAgentProfiles = {
  implementer: template("implementer", implementerSystemPrompt),
  reviewer: template("reviewer", reviewerSystemPrompt),
  planner: template("planner", plannerSystemPrompt),
} satisfies Record<AgentRole, AgentProfileTemplate>;
