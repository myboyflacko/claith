import {
  ActivityCancellationType,
  ApplicationFailure,
  CancellationScope,
  ChildWorkflowCancellationType,
  condition,
  executeChild,
  isCancellation,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import { executionConfigurationSchema } from "../domain/configuration.js";
import {
  assertReview,
  checksPassed,
  contractSchema,
  runIdentity,
  revision,
} from "../domain/contracts.js";
import type {
  Activities,
  AttemptInput,
  BlockKind,
  ImplementerResult,
  ReviewInput,
  RunInput,
  RunRecord,
  Resume,
} from "../domain/contracts.js";
import { cancelUpdate, resumeUpdate, statusQuery } from "./messages.js";
function activities(input: RunInput) {
  return proxyActivities<Activities>({
    startToCloseTimeout: `${input.configuration.runtime.agentTimeoutSeconds}s`,
    heartbeatTimeout: `${input.configuration.runtime.heartbeatTimeoutSeconds}s`,
    retry: { maximumAttempts: 1 },
    cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  });
}
export async function implementerWorkflow(
  input: AttemptInput,
): Promise<ImplementerResult> {
  const act = activities(input);
  const implementation = await act.implement(input);
  if (implementation.submission.status === "blocked")
    return { implementation, candidate: null, checks: [] };
  const candidate = await act.candidate(input);
  const checks = await act.check({ ...input, candidate, checks: [] });
  return { implementation, candidate, checks };
}
export async function reviewerWorkflow(input: ReviewInput) {
  const result = await activities(input).review(input);
  try {
    assertReview(input, result.submission);
  } catch (error) {
    throw ApplicationFailure.nonRetryable(errorText(error), "InvalidReview");
  }
  return result;
}
function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return `${error.message}${error.cause ? `: ${errorText(error.cause)}` : ""}`;
}
export async function taskWorkflow(input: RunInput): Promise<RunRecord> {
  const contract = contractSchema.safeParse(input.contract);
  const configuration = executionConfigurationSchema.safeParse(
    input.configuration,
  );
  if (
    !contract.success ||
    !configuration.success ||
    !runIdentity.safeParse(input.runId).success ||
    !revision.safeParse(input.startCommit).success
  )
    throw ApplicationFailure.nonRetryable("Invalid task input", "InvalidInput");
  input = {
    ...input,
    contract: contract.data,
    configuration: configuration.data,
  };
  const record: RunRecord = {
    contract: input.contract,
    execution: {
      runId: input.runId,
      project: input.project,
      startCommit: input.startCommit,
      configuration: input.configuration,
      status: "running",
      stage: "prepare",
      repairsUsed: 0,
      repairBudget: input.configuration.runtime.maxRepairs,
      blocked: null,
      workspace: null,
      sessions: [],
      attempts: [],
      integration: null,
      pushed: false,
      cleaned: false,
    },
  };
  const e = record.execution;
  const act = activities(input);
  const scope = new CancellationScope();
  let cancelled = false;
  let sequence = 0;
  let resumed = false;
  const receipts = new Map<string, { fingerprint: string; result: string }>();
  function reject(message: string): never {
    throw ApplicationFailure.nonRetryable(message, "InvalidCommand");
  }
  setHandler(statusQuery, () => record);
  setHandler(resumeUpdate, (command: Resume) => {
    const fingerprint = JSON.stringify(command);
    const prior = receipts.get(command.commandId);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        reject("Command ID reused with different content");
      return prior.result;
    }
    if (
      cancelled ||
      !e.blocked ||
      e.status !== "blocked" ||
      resumed ||
      command.blockerId !== e.blocked.id
    )
      reject("Stale blocker or closed run");
    if (e.blocked.kind === "base_changed")
      reject("New contract version and run required for changed dev");
    if (
      !Number.isInteger(command.additionalRepairs) ||
      command.additionalRepairs < 0 ||
      command.additionalRepairs > 20
    )
      reject("additionalRepairs must be 0..20");
    if (e.blocked.kind === "repair" && command.additionalRepairs < 1)
      reject("Repair budget exhausted; explicitly grant additional repairs");
    e.repairBudget += command.additionalRepairs;
    resumed = true;
    receipts.set(command.commandId, { fingerprint, result: command.blockerId });
    return command.blockerId;
  });
  setHandler(cancelUpdate, () => {
    if (e.status === "completed") reject("Run is completed");
    cancelled = true;
    scope.cancel();
    return input.runId;
  });
  async function wait(kind: BlockKind, message: string): Promise<void> {
    e.status = "blocked";
    e.blocked = { id: `${input.runId}-q${++sequence}`, kind, message };
    resumed = false;
    // Even if persistence is temporarily unavailable, Temporal retains the blocker.
    try {
      e.sessions = await act.record(record);
    } catch (error) {
      if (isCancellation(error)) throw error;
    }
    await condition(() => resumed || cancelled);
    e.blocked = null;
    e.status = "running";
  }
  async function persist(): Promise<void> {
    const status = e.status;
    while (true) {
      try {
        e.sessions = await act.record(record);
        return;
      } catch (error) {
        if (isCancellation(error)) throw error;
        await wait("recovery", `Cannot persist run: ${errorText(error)}`);
        e.status = status;
      }
    }
  }
  let feedback = "";
  async function repair(reason: string): Promise<void> {
    feedback = reason;
    if (e.repairsUsed >= e.repairBudget) await wait("repair", reason);
    e.repairsUsed++;
    e.integration = null;
    e.stage = "implement";
  }
  try {
    await scope.run(async () => {
      await persist();
      while (e.stage !== "done") {
        try {
          if (e.stage === "prepare") {
            e.workspace = await act.prepare(input);
            e.stage = "implement";
          } else {
            const attempt = e.repairsUsed;
            const work: AttemptInput = {
              ...input,
              workspace: e.workspace!,
              attempt,
              feedback,
            };
            let history = e.attempts.find((a) => a.attempt === attempt);
            if (!history) {
              history = {
                attempt,
                implementerWorkflowId: `${input.runId}-implementer-${attempt}`,
                reviewerWorkflowId: null,
                result: null,
                review: null,
                integration: null,
              };
              e.attempts.push(history);
            }
            if (e.stage === "implement") {
              history.result ??= await executeChild(implementerWorkflow, {
                workflowId: history.implementerWorkflowId,
                args: [work],
                cancellationType:
                  ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
              });
              if (
                history.result.implementation.submission.status === "blocked"
              ) {
                await wait(
                  "agent",
                  history.result.implementation.submission.summary,
                );
                await repair(history.result.implementation.submission.summary);
              } else if (
                !history.result.candidate ||
                !checksPassed(
                  history.result.candidate.verificationPlan,
                  history.result.checks,
                  history.result.candidate.revision,
                )
              )
                await repair(
                  `Checks failed: ${JSON.stringify(history.result.checks)}`,
                );
              else e.stage = "review";
            } else if (e.stage === "review") {
              const candidate = history.result!.candidate!;
              history.reviewerWorkflowId = `${input.runId}-reviewer-${attempt}`;
              const reviewInput = {
                ...work,
                candidate,
                checks: history.result!.checks,
              };
              history.review ??= await executeChild(reviewerWorkflow, {
                workflowId: history.reviewerWorkflowId,
                args: [reviewInput],
                cancellationType:
                  ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
              });
              assertReview(reviewInput, history.review.submission);
              if (history.review.submission.verdict === "accepted")
                e.stage = "integrate";
              else {
                if (history.review.submission.verdict === "blocked")
                  await wait("agent", history.review.submission.summary);
                await repair(JSON.stringify(history.review.submission));
              }
            } else if (e.stage === "integrate") {
              history.integration = await act.integrate({
                ...work,
                candidate: history.result!.candidate!,
                checks: history.result!.checks,
                review: history.review!,
              });
              e.integration = history.integration;
              if (
                !checksPassed(
                  e.integration.verificationPlan,
                  e.integration.checks,
                  e.integration.revision,
                )
              )
                await repair(
                  `Integration checks failed: ${JSON.stringify(e.integration.checks)}`,
                );
              else e.stage = "push";
            } else if (e.stage === "push") {
              await act.push({
                ...input,
                workspace: e.workspace!,
                integration: e.integration!,
              });
              e.pushed = true;
              e.stage = "cleanup";
            } else if (e.stage === "cleanup") {
              await act.cleanup({
                ...input,
                workspace: e.workspace!,
                integration: e.integration!,
              });
              e.cleaned = true;
              e.stage = "done";
            }
          }
          await persist();
        } catch (error) {
          if (isCancellation(error)) throw error;
          const text = errorText(error);
          const kind: BlockKind = text.includes("Development base changed")
            ? "base_changed"
            : ["push", "cleanup"].includes(e.stage)
              ? "delivery"
              : "recovery";
          await wait(kind, text);
        }
      }
      e.status = "completed";
      await persist();
    });
  } catch (error) {
    if (!isCancellation(error)) throw error;
    e.status = "cancelled";
    e.blocked = null;
    await CancellationScope.nonCancellable(async () => {
      try {
        e.sessions = await act.record(record);
      } catch {
        /* Temporal retains the cancelled result if artifact storage is unavailable. */
      }
    });
  }
  return record;
}
