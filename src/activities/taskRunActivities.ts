import { access, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { assertReview, checksPassed } from "../domain/contracts.js";
import { runDirectory } from "../workspace/git.js";
import type { Evidence, ProjectActivities, TaskRunOutcome } from "../workflows/types.js";

export async function collectTaskRun(
  root: string,
  input: Parameters<ProjectActivities["collectTaskRun"]>[0],
): Promise<TaskRunOutcome> {
  const { prepared, timestamp, record } = input;
  const expected = prepared.input;
  const artifactDir = runDirectory(root, expected.runId);
  const evidence: Evidence[] = [];
  let success = false;
  let error = input.error;
  const add = (type: Evidence["type"], data: unknown, refs: string[]) => evidence.push({
    id: `${expected.runId}-${evidence.length}`, taskId: expected.contract.taskId,
    type, timestamp, data, refs,
  });
  if (record) {
    try {
      const e = record.execution;
      if (e.runId !== expected.runId || e.project !== expected.project || e.startCommit !== expected.startCommit ||
          JSON.stringify(record.contract) !== JSON.stringify(expected.contract) ||
          JSON.stringify(e.configuration) !== JSON.stringify(expected.configuration)) throw new Error("Task result identity does not match the dispatched run");
      for (const attempt of e.attempts) {
        const result = attempt.result;
        if (result?.candidate) add("artifact", { attempt: attempt.attempt, revision: result.candidate.revision }, [result.candidate.diffRef]);
        for (const check of result?.checks ?? []) add("check", check, [check.outputRef]);
        if (attempt.review) add("review", attempt.review, [join(artifactDir, `reviewer-${attempt.attempt}`, "result.json")]);
        for (const check of attempt.integration?.checks ?? []) add("check", check, [check.outputRef]);
      }
      for (const session of e.sessions) add("log", { role: session.role, sessionId: session.sessionId, attempt: session.attempt }, [session.path]);
      add("log", { status: e.status, stage: e.stage, revision: e.integration?.revision ?? null, pushed: e.pushed, cleaned: e.cleaned }, [join(artifactDir, "run.json")]);
      if (e.status === "completed") {
        const last = e.attempts.at(-1);
        if (!e.workspace || !e.integration || !last?.result?.candidate || !last.review ||
            last.review.submission.verdict !== "accepted" || e.stage !== "done" || !e.pushed || !e.cleaned ||
            !checksPassed(e.integration.verificationPlan, e.integration.checks, e.integration.revision)) throw new Error("Task did not complete verified delivery");
        assertReview({ ...expected, workspace: e.workspace, attempt: last.attempt, feedback: "", candidate: last.result.candidate, checks: last.result.checks }, last.review.submission);
        success = true;
      } else error ??= `Task workflow ${e.status}${e.blocked ? `: ${e.blocked.message}` : ""}`;
    } catch (cause) {
      success = false;
      error = cause instanceof Error ? cause.message : String(cause);
    }
  } else error ??= "Task workflow failed without a result";
  let retained = false;
  try { await access(prepared.worktree.path); retained = true; }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }
  if (!retained) {
    try {
      const names = await readdir(dirname(prepared.worktree.path));
      retained = names.some(name => name.startsWith(`${basename(prepared.worktree.path)}-integration-`));
    } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }
  }
  if (success && retained) { success = false; error = "Task reported cleanup but owned worktrees remain"; }
  return {
    success, evidence,
    ...(error ? { error } : {}),
    retainedWorktree: retained ? { ...prepared.worktree, status: "error" } : null,
  };
}
