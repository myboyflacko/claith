import {
  ActivityCancellationType,
  proxyActivities,
} from "@temporalio/workflow";
import type { RunInput, RunRecord } from "../../src/domain/contracts.js";
export { projectWorkflow } from "../../src/workflows/projectWorkflow.js";
export { readProjectEvidence } from "../../src/workflows/readProjectEvidence.js";

/** Scheduler boundary fixture; real Taskflow delivery is covered separately with real Git. */
export async function taskWorkflow(input: RunInput): Promise<RunRecord> {
  const { runProjectTask } = proxyActivities<{
    runProjectTask(input: RunInput): Promise<RunRecord>;
  }>({
    startToCloseTimeout: "1h",
    heartbeatTimeout: "1m",
    retry: { maximumAttempts: 1 },
    cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  });
  return runProjectTask(input);
}
