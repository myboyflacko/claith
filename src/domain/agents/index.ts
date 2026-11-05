import type { Permission } from "../tools.js";

/** Shared agent definition, independent of workflows and session providers. */
export interface AgentDefinition {
  readonly role: "implementer" | "reviewer" | "planner";
  readonly tools: readonly string[];
  readonly developerInstructions: string;
  readonly model: {
    readonly provider: string;
    readonly name: string;
  };
  readonly permissions: Permission;
}

export interface Implementer extends AgentDefinition {
  readonly role: "implementer";
}

export interface Reviewer extends AgentDefinition {
  readonly role: "reviewer";
  readonly permissions: "read-only";
}

/** Describes the planner only; it does not register a runtime role. */
export interface Planner extends AgentDefinition {
  readonly role: "planner";
  readonly permissions: "read-only";
}
