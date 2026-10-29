import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeSchema } from "../../src/configuration.js";
import { contractSchema } from "../../src/domain/contracts.js";
import type {
  RunInput,
  ReviewInput,
  Review,
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
    configuration: {
      runtime: runtimeSchema.parse({}),
      agents: agentProfiles(),
    },
    contract: contractSchema.parse({
      taskId: "task",
      version: 1,
      startCommit,
      title: "Task",
      tasks: "Create the requested behavior.",
      goal: "Requested behavior",
      context: "Fixture",
      scope: "source.txt",
      constraints: "Preserve unrelated files",
      acceptanceCriteria: [
        { id: "works", text: "Behavior works", mode: "check", checkId: "test" },
      ],
      checks: [{ id: "test", command: "test -f source.txt" }],
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
      references: [c.checkId ?? "diff"],
    })),
  };
}
