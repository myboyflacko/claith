import {
  ActivityCancellationType,
  CancellationScope,
  ChildWorkflowCancellationType,
  condition,
  executeChild,
  getExternalWorkflowHandle,
  isCancellation,
  proxyActivities,
  setHandler,
  workflowInfo,
  ApplicationFailure,
} from "@temporalio/workflow";
import { contractSchema } from "../domain/contracts.js";
import { executionConfigurationSchema } from "../domain/configuration.js";
import type {
  Activities,
  Approval,
  Decision,
  Escalation,
  SessionInput,
  SessionSnapshot,
  TaskInput,
  TaskResult,
  TaskSnapshot,
} from "../domain/contracts.js";
import {
  approveUpdate,
  cancelUpdate,
  conversationUpdate,
  decisionSignal,
  decisionUpdate,
  progressSignal,
  statusQuery,
  taskCancelSignal,
} from "./messages.js";

function reject(message: string): never {
  throw ApplicationFailure.nonRetryable(message, "InvalidCommand");
}
function activities(input: { configuration: SessionInput["configuration"] }) {
  const s = input.configuration.runtime;
  return proxyActivities<Activities>({
    startToCloseTimeout: `${s.agentTimeoutSeconds}s`,
    heartbeatTimeout: `${s.heartbeatTimeoutSeconds}s`,
    retry: { maximumAttempts: 1 },
    cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  });
}

export async function coordinator(
  input: SessionInput,
): Promise<SessionSnapshot> {
  input.configuration = executionConfigurationSchema.parse(input.configuration);
  const snapshot: SessionSnapshot = {
    sessionId: input.sessionId,
    project: input.project,
    state: "idle",
    currentTask: null,
    pendingEscalation: null,
    proposal: null,
    acceptedResults: [],
    conversation: [],
    messages: [],
    outline: [],
  };
  const receipts = new Map<string, { fingerprint: string; value: string }>();
  const approvals = new Map<string, string>();
  const versions = new Map<string, number>();
  const resolvedQuestions = new Set<string>();
  const queue: string[] = [];
  let approval: Approval | null = null;
  let busy = false;
  let cancelled = false;
  let questionSequence = 0;
  const scope = new CancellationScope();
  function once(id: string, payload: unknown, action: () => string): string {
    const fingerprint = JSON.stringify(payload);
    const old = receipts.get(id);
    if (old) {
      if (old.fingerprint !== fingerprint)
        reject("Command ID reused with different content");
      return old.value;
    }
    const value = action();
    receipts.set(id, { fingerprint, value });
    return value;
  }
  setHandler(statusQuery, () => snapshot);
  setHandler(conversationUpdate, (message) =>
    once(message.id, message, () => {
      if (cancelled || snapshot.state === "completed")
        reject("Session is closed");
      if (
        busy ||
        snapshot.pendingEscalation ||
        snapshot.currentTask?.state === "running" ||
        snapshot.currentTask?.state === "waiting"
      )
        reject("Wait for the active task or answer its question");
      if (!message.text.trim()) reject("Conversation cannot be empty");
      snapshot.conversation.push(message);
      queue.push(message.id);
      snapshot.state = "planning";
      return message.id;
    }),
  );
  setHandler(approveUpdate, (request) =>
    once(request.commandId, request, () => {
      const approvedKey = `${request.taskId}:${request.version}`;
      if (approvals.has(approvedKey)) return approvals.get(approvedKey)!;
      const c = snapshot.proposal?.contract;
      if (
        busy ||
        queue.length ||
        approval ||
        snapshot.state !== "awaiting_approval" ||
        !c ||
        c.taskId !== request.taskId ||
        c.version !== request.version
      )
        reject("Stale or unavailable contract");
      const executionId = `${input.sessionId}-${c.taskId}-v${c.version}`;
      request.configuration = executionConfigurationSchema.parse(
        request.configuration,
      );
      approval = request;
      approvals.set(approvedKey, executionId);
      snapshot.state = "running";
      snapshot.currentTask = {
        executionId,
        contract: c,
        attempt: 0,
        repairsUsed: 0,
        state: "running",
      };
      return executionId;
    }),
  );
  setHandler(progressSignal, (task, question) => {
    if (
      !cancelled &&
      snapshot.currentTask?.executionId === task.executionId &&
      (!question || !resolvedQuestions.has(question.id))
    ) {
      snapshot.currentTask = task;
      snapshot.pendingEscalation = question;
      snapshot.state = task.state === "waiting" ? "waiting" : "running";
    }
  });
  setHandler(decisionUpdate, async (decision) => {
    let dispatch = false;
    const value = once(decision.commandId, decision, () => {
      const q = snapshot.pendingEscalation;
      if (
        !q ||
        q.id !== decision.escalationId ||
        q.executionId !== decision.executionId
      )
        reject("Stale question or execution");
      if (
        !Number.isInteger(decision.additionalRepairs) ||
        decision.additionalRepairs < 0 ||
        decision.additionalRepairs > 20
      )
        reject("Continuation requires 0..20 additional repairs");
      if (decision.confirmCriteria.some((id) => !q.criteria.includes(id)))
        reject("Unknown acceptance criterion");
      if (
        q.kind === "acceptance" &&
        (decision.additionalRepairs !== 0 ||
          q.criteria.some((id) => !decision.confirmCriteria.includes(id)))
      )
        reject("Confirm all pending criteria explicitly");
      if (q.kind !== "acceptance" && decision.additionalRepairs < 1)
        reject("Grant an explicit bounded continuation");
      if (!decision.answer.trim()) reject("An answer is required");
      resolvedQuestions.add(q.id);
      snapshot.pendingEscalation = null;
      dispatch = true;
      return decision.escalationId;
    });
    if (dispatch) {
      if (decision.executionId === input.sessionId) {
        snapshot.conversation.push({
          id: decision.commandId,
          text: decision.answer,
        });
        queue.push(decision.commandId);
        snapshot.state = "planning";
      } else
        await getExternalWorkflowHandle(decision.executionId).signal(
          decisionSignal,
          decision,
        );
    }
    return value;
  });
  setHandler(cancelUpdate, (id) =>
    once(id, { cancel: true }, () => {
      cancelled = true;
      snapshot.state = "cancelled";
      scope.cancel();
      return input.sessionId;
    }),
  );
  try {
    await scope.run(async () => {
      while (!cancelled && snapshot.state !== "completed") {
        const ready = () => cancelled || queue.length > 0 || approval !== null;
        if (snapshot.pendingEscalation) {
          if (
            !(await condition(
              ready,
              `${input.configuration.runtime.reminderSeconds}s`,
            ))
          ) {
            snapshot.pendingEscalation.reminders++;
            continue;
          }
        } else await condition(ready);
        if (cancelled) break;
        if (queue.length) {
          queue.splice(0);
          busy = true;
          snapshot.state = "planning";
          try {
            const proposal = await activities(input).plan({
              session: snapshot,
              startingRevision:
                snapshot.acceptedResults.at(-1)?.acceptedCommit ??
                input.startingRevision,
              configuration: input.configuration,
            });
            if (proposal.contract) {
              proposal.contract = contractSchema.parse(proposal.contract);
              const c = proposal.contract;
              const base =
                snapshot.acceptedResults.at(-1)?.acceptedCommit ??
                input.startingRevision;
              const predecessor = snapshot.acceptedResults.at(-1);
              if (predecessor && !c.dependencies.includes(predecessor.taskId))
                throw new Error(
                  "Next task must reference its accepted predecessor",
                );
              if (c.version <= (versions.get(c.taskId) ?? 0))
                throw new Error(
                  "Revised contracts require an increasing version",
                );
              if (
                c.startingRevision !== base ||
                c.dependencies.some(
                  (id) =>
                    !snapshot.acceptedResults.some((r) => r.taskId === id),
                ) ||
                snapshot.acceptedResults.some((r) => r.taskId === c.taskId)
              )
                throw new Error("Proposal has invalid base or dependencies");
              versions.set(c.taskId, c.version);
            }
            if (proposal.goalComplete && proposal.contract)
              throw new Error(
                "A completed goal cannot propose another contract",
              );
            snapshot.proposal = proposal;
            snapshot.outline = proposal.outline;
            snapshot.messages.push(proposal.message);
            snapshot.state = proposal.goalComplete
              ? "completed"
              : proposal.contract
                ? "awaiting_approval"
                : "idle";
          } catch (error) {
            snapshot.state = "waiting";
            snapshot.pendingEscalation = {
              id: `${input.sessionId}-planning-${++questionSequence}`,
              executionId: input.sessionId,
              kind: "recovery",
              question: String(error),
              criteria: [],
              reminders: 0,
            };
          } finally {
            busy = false;
          }
        }
        if (approval) {
          const approved = approval;
          approval = null;
          busy = true;
          const task = snapshot.currentTask!;
          const result = await executeChild(taskExecution, {
            workflowId: task.executionId,
            cancellationType:
              ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
            args: [
              {
                sessionId: input.sessionId,
                project: input.project,
                coordinatorId: workflowInfo().workflowId,
                executionId: task.executionId,
                contract: task.contract,
                configuration: approved.configuration,
                dependencies: snapshot.acceptedResults.filter((r) =>
                  task.contract.dependencies.includes(r.taskId),
                ),
              },
            ],
          });
          busy = false;
          snapshot.pendingEscalation = null;
          if (result) {
            snapshot.acceptedResults.push(result);
            snapshot.currentTask = {
              ...snapshot.currentTask!,
              state: "completed",
            };
            queue.push(`accepted-${result.taskId}`);
          } else {
            cancelled = true;
            snapshot.state = "cancelled";
          }
        }
      }
    });
  } catch (error) {
    if (!isCancellation(error)) throw error;
    snapshot.state = "cancelled";
  }
  if (snapshot.state === "cancelled" && snapshot.currentTask)
    snapshot.currentTask.state = "cancelled";
  return snapshot;
}

export async function taskExecution(
  input: TaskInput,
): Promise<TaskResult | null> {
  const act = activities(input);
  const state: TaskSnapshot = {
    executionId: input.executionId,
    contract: input.contract,
    attempt: 0,
    repairsUsed: 0,
    state: "running",
  };
  let questionSequence = 0;
  let pending: Escalation | null = null;
  let reply: Decision | null = null;
  let budget = input.configuration.runtime.maxRepairs;
  let feedback = "";
  const scope = new CancellationScope();
  const notify = () =>
    getExternalWorkflowHandle(input.coordinatorId).signal(
      progressSignal,
      state,
      pending,
    );
  setHandler(decisionSignal, (d) => {
    if (
      pending?.id === d.escalationId &&
      d.executionId === input.executionId &&
      !reply
    )
      reply = d;
  });
  setHandler(taskCancelSignal, () => scope.cancel());
  async function ask(
    kind: Escalation["kind"],
    question: string,
    criteria: string[] = [],
  ): Promise<Decision> {
    pending = {
      id: `${input.executionId}-q${++questionSequence}`,
      executionId: input.executionId,
      kind,
      question,
      criteria,
      reminders: 0,
    };
    state.state = "waiting";
    reply = null;
    await notify();
    while (!reply) {
      if (
        !(await condition(
          () => reply !== null,
          `${input.configuration.runtime.reminderSeconds}s`,
        ))
      ) {
        pending.reminders++;
        await notify();
      }
    }
    const answer = reply as Decision;
    pending = null;
    reply = null;
    state.state = "running";
    await notify();
    return answer;
  }
  try {
    return await scope.run(async () => {
      let workspace;
      while (!workspace) {
        try {
          workspace = await act.prepare(input);
        } catch (error) {
          feedback = (
            await ask(
              "recovery",
              `Workspace needs reconciliation: ${String(error)}`,
            )
          ).answer;
        }
      }
      while (true) {
        await notify();
        const attempt = {
          ...input,
          attempt: state.attempt,
          feedback,
          workspace,
        };
        try {
          const implementation = await act.implement(attempt);
          if (implementation.status === "blocked") {
            const decision = await ask("blocker", implementation.summary);
            budget += decision.additionalRepairs;
            feedback = decision.answer;
          } else {
            const candidate = await act.candidate({
              ...attempt,
              implementation,
            });
            const checks = await act.check({ ...attempt, candidate });
            if (
              checks.length !== input.contract.checks.length ||
              input.contract.checks.some(
                (c) =>
                  !checks.some(
                    (e) =>
                      e.id === c.id &&
                      e.command === c.command &&
                      e.revision === candidate.revision &&
                      e.unchanged &&
                      e.exitCode === 0,
                  ),
              )
            ) {
              feedback = `Checks failed for ${candidate.revision}: ${JSON.stringify(checks)}`;
            } else {
              const review = input.contract.review
                ? await act.review({ ...attempt, candidate, checks })
                : null;
              if (
                review &&
                (review.taskId !== input.contract.taskId ||
                  review.attempt !== state.attempt ||
                  review.revision !== candidate.revision)
              )
                throw new Error("Stale review");
              if (review?.verdict === "blocked") {
                const decision = await ask("blocker", review.summary);
                budget += decision.additionalRepairs;
                feedback = decision.answer;
              } else if (review && review.verdict !== "accepted")
                feedback = review.summary;
              else {
                for (const criterion of input.contract.acceptance) {
                  const evidence = implementation.evidence.find(
                    (e) => e.criterionId === criterion.id,
                  );
                  if (
                    criterion.mode !== "human" &&
                    (!evidence ||
                      !evidence.references.length ||
                      evidence.references.some(
                        (ref) =>
                          ref !== "diff" && !checks.some((c) => c.id === ref),
                      ))
                  )
                    throw new Error(
                      `Missing or unknown acceptance evidence: ${criterion.id}`,
                    );
                }
                const human = input.contract.acceptance
                  .filter((a) => a.mode === "human")
                  .map((a) => a.id);
                if (human.length)
                  await ask(
                    "acceptance",
                    "Confirm the acceptance criteria against the candidate evidence",
                    human,
                  );
                const result: TaskResult = {
                  taskId: input.contract.taskId,
                  executionId: input.executionId,
                  acceptedCommit: candidate.revision,
                  workspace,
                  checks,
                  review,
                  evidence: implementation.evidence,
                  humanConfirmations: human,
                  blockers: [],
                };
                await act.accept({ ...attempt, result });
                state.state = "completed";
                await notify();
                return result;
              }
            }
          }
        } catch (error) {
          if (isCancellation(error)) throw error;
          const decision = await ask(
            "recovery",
            `An activity did not complete safely: ${String(error)}`,
          );
          budget += decision.additionalRepairs;
          feedback = decision.answer;
        }
        if (state.repairsUsed >= budget) {
          const decision = await ask(
            "repair",
            `Repair budget exhausted. ${feedback}`,
          );
          budget += decision.additionalRepairs;
          feedback += `\nHuman decision: ${decision.answer}`;
        }
        state.repairsUsed++;
        state.attempt++;
      }
    });
  } catch (error) {
    if (!isCancellation(error)) throw error;
    return null;
  }
}
