import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeSchema } from "../../src/infrastructure/bootstrap/configuration.js";
import { contractSchema } from "../../src/domain/contracts.js";
import type {
  RunInput,
  VerificationPlan,
  ReviewInput,
  Review,
  RunRecord,
} from "../../src/domain/contracts.js";
import { git } from "../../src/workspace/git.js";
import { agentProfiles } from "./profiles.js";
export function taskInput(
  project = "/project",
  startCommit = "a".repeat(40),
): RunInput {
  return {
    runId: "test-task-v1",
    project,
    startCommit,
    configuration: {
      runtime: runtimeSchema.parse({}),
      agents: agentProfiles(),
    },
    contract: contractSchema.parse({
      taskId: "task",
      version: 1,
      title: "Task",
      description:
        "Create the requested behavior in source.txt. Preserve unrelated files.",
      acceptanceCriteria: [{ id: "works", text: "Behavior works" }],
    }),
  };
}
export async function projectFixture(directory: string) {
  const project = join(directory, "project");
  const remote = join(directory, "origin.git");
  await mkdir(project);
  await git(directory, "init", "--bare", remote);
  await git(project, "init", "-b", "dev");
  await git(project, "config", "user.name", "Test");
  await git(project, "config", "user.email", "test@example.invalid");
  await writeFile(join(project, "source.txt"), "original");
  await git(project, "add", ".");
  await git(project, "commit", "-m", "seed");
  await git(project, "remote", "add", "origin", remote);
  await git(project, "push", "-u", "origin", "dev");
  return {
    project,
    remote,
    root: join(directory, "state"),
    input: taskInput(project, await git(project, "rev-parse", "HEAD")),
  };
}
export function acceptedReview(input: ReviewInput): Review {
  return {
    runId: input.runId,
    taskId: input.contract.taskId,
    version: input.contract.version,
    attempt: input.attempt,
    revision: input.candidate.revision,
    verdict: "accepted",
    summary: "Verified",
    findings: [],
    criteria: input.contract.acceptanceCriteria.map((c) => ({
      criterionId: c.id,
      satisfied: true,
      references: [input.candidate.verificationPlan.checks[0]!.id],
    })),
  };
}

export function verificationPlan(): VerificationPlan {
  return { setup: [], checks: [{ id: "test", command: "test -f source.txt" }] };
}

export function completedTaskRun(input: RunInput): RunRecord {
  const workspace = {
    path: `/managed/${input.runId}`,
    branch: `feature/claith-${input.runId}`,
    base: input.startCommit,
    artifactDir: "/artifacts",
  };
  const candidate = {
    revision: "b".repeat(40),
    diffRef: "/artifacts/diff.patch",
    verificationPlan: verificationPlan(),
  };
  const checks = candidate.verificationPlan.checks.map((c) => ({
    ...c,
    exitCode: 0,
    outputRef: "/artifacts/check.log",
    revision: candidate.revision,
    unchanged: true,
  }));
  const reviewInput = {
    ...input,
    workspace,
    attempt: 0,
    feedback: "",
    candidate,
    checks,
  };
  const integration = {
    revision: "e".repeat(40),
    path: workspace.path + "-integration-0",
    branch: "integration",
    verificationPlan: candidate.verificationPlan,
    checks: checks.map((c) => ({ ...c, revision: "e".repeat(40) })),
  };
  return {
    contract: input.contract,
    execution: {
      runId: input.runId,
      project: input.project,
      startCommit: input.startCommit,
      configuration: input.configuration,
      status: "completed",
      stage: "done",
      repairsUsed: 0,
      repairBudget: input.configuration.runtime.maxRepairs,
      blocked: null,
      workspace,
      sessions: [],
      integration,
      pushed: true,
      cleaned: true,
      attempts: [
        {
          attempt: 0,
          implementerWorkflowId: `${input.runId}-implementer-0`,
          reviewerWorkflowId: `${input.runId}-reviewer-0`,
          integration,
          result: {
            candidate,
            checks,
            implementation: {
              sessionId: "implementer",
              submission: {
                runId: input.runId,
                taskId: input.contract.taskId,
                version: input.contract.version,
                attempt: 0,
                revision: candidate.revision,
                status: "submitted",
                summary: "Done",
                verificationPlan: candidate.verificationPlan,
                evidence: [{ criterionId: "works", references: ["test"] }],
              },
            },
          },
          review: {
            sessionId: "reviewer",
            submission: acceptedReview(reviewInput),
          },
        },
      ],
    },
  };
}
