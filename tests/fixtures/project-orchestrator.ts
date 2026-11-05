import {
  ActivityCancellationType,
  proxyActivities,
} from "@temporalio/workflow";
import type {
  ChildWorkflowInput,
  ChildWorkflowResult,
} from "../../src/workflows/types.js";

export async function orchestratorWorkflow(
  input: ChildWorkflowInput,
): Promise<ChildWorkflowResult> {
  const { runProjectTask } = proxyActivities<{
    runProjectTask(input: ChildWorkflowInput): Promise<ChildWorkflowResult>;
  }>({
    startToCloseTimeout: "1h",
    heartbeatTimeout: "1m",
    retry: { maximumAttempts: 1 },
    cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  });
  return runProjectTask(input);
}
