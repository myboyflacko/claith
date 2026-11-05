import type { ChildWorkflowInput, ChildWorkflowResult } from "./types.js";

/** Fail closed: a placeholder must never masquerade as verified implementation. */
export async function orchestratorWorkflow(
  input: ChildWorkflowInput,
): Promise<ChildWorkflowResult> {
  return {
    success: false,
    evidence: [],
    error: `Task ${input.taskId}: Orchestrator Critic Agent Loop is not implemented`,
  };
}
