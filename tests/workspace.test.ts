import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { profileSchema, runtimeSchema } from "../src/configuration.js";
import type {
  AttemptInput,
  Candidate,
  TaskInput,
  TaskResult,
} from "../src/domain/contracts.js";
import {
  assertRevision,
  git,
  workspaceActivities,
} from "../src/workspace/git.js";
import { withOwnership } from "../src/workspace/ownership.js";
import { readJson, writeJson } from "../src/workspace/storage.js";
import { runCommand } from "../src/workspace/process.js";

let temp: string;
let project: string;
let input: TaskInput;
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), "claith-workspace-"));
  project = join(temp, "project");
  await mkdir(project);
  await git(project, "init", "-b", "dev");
  await git(project, "config", "user.name", "Test");
  await git(project, "config", "user.email", "test@example.invalid");
  await writeFile(join(project, "source.txt"), "original");
  await git(project, "add", ".");
  await git(project, "commit", "-m", "initial");
  const startingRevision = await git(project, "rev-parse", "HEAD");
  const profile = profileSchema.parse({
    provider: "double",
    model: "double",
    instructions: "test",
  });
  input = {
    sessionId: "session",
    project,
    executionId: "task-one",
    coordinatorId: "session",
    dependencies: [],
    configuration: {
      runtime: runtimeSchema.parse({}),
      agents: {
        orchestrator: profile,
        implementer: profile,
        reviewer: profile,
      },
    },
    contract: {
      taskId: "one",
      version: 1,
      startingRevision,
      title: "Task one",
      outcome: "Change source",
      boundaries: ["source.txt"],
      dependencies: [],
      acceptance: [
        { id: "works", text: "works", mode: "check", checkId: "test" },
      ],
      setup: [],
      checks: [{ id: "test", command: "test -f source.txt" }],
      review: false,
      endpoint: "local-commit",
    },
  };
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(temp, { recursive: true, force: true });
});
async function candidate() {
  const activities = workspaceActivities(join(temp, "state"));
  const workspace = await activities.prepare(input);
  await writeFile(join(workspace.path, "source.txt"), "changed");
  const attempt: AttemptInput = {
    ...input,
    workspace,
    attempt: 0,
    feedback: "",
  };
  const result = await activities.candidate({
    ...attempt,
    implementation: {
      status: "submitted",
      summary: "changed",
      evidence: [{ criterionId: "works", references: ["test"] }],
    },
  });
  return { activities, attempt, result };
}
describe("isolated workspace and evidence", () => {
  it("chains separate branches/worktrees on accepted commits and reconciles commit checkpoints", async () => {
    const { activities, attempt, result } = await candidate();
    const checks = await activities.check({ ...attempt, candidate: result });
    const accepted: TaskResult = {
      taskId: "one",
      executionId: input.executionId,
      acceptedCommit: result.revision,
      workspace: attempt.workspace,
      checks,
      review: null,
      evidence: result.implementation.evidence,
      humanConfirmations: [],
      blockers: [],
    };
    await activities.accept({ ...attempt, result: accepted });
    await rm(join(attempt.workspace.artifactDir, "candidate-0.json"));
    const recovered = await activities.candidate({
      ...attempt,
      implementation: result.implementation,
    });
    expect(recovered.revision).toBe(result.revision);
    const second = await activities.prepare({
      ...input,
      executionId: "task-two",
      dependencies: [accepted],
      contract: {
        ...input.contract,
        taskId: "two",
        startingRevision: result.revision,
        dependencies: ["one"],
      },
    });
    expect(second.path).not.toBe(attempt.workspace.path);
    expect(second.branch).not.toBe(attempt.workspace.branch);
    expect(await git(second.path, "rev-parse", "HEAD")).toBe(result.revision);
    expect(await readFile(join(second.path, "source.txt"), "utf8")).toBe(
      "changed",
    );
    expect(await git(project, "branch", "--show-current")).toBe("dev");
    expect(
      await readJson(join(attempt.workspace.artifactDir, "accepted.json")),
    ).toEqual(accepted);
  });

  it("invalidates checks when source changes even if a command succeeds", async () => {
    input.contract.checks[0]!.command = "printf mutated > source.txt";
    const { activities, attempt, result } = await candidate();
    const checks = await activities.check({ ...attempt, candidate: result });
    expect(checks[0]).toMatchObject({
      exitCode: 0,
      unchanged: false,
      revision: result.revision,
    });
    await expect(
      assertRevision(attempt.workspace, result.revision),
    ).rejects.toThrow("differs");
  });

  it("rejects cached checks against another revision and rejects an overlapping writer", async () => {
    const { activities, attempt, result } = await candidate();
    await activities.check({ ...attempt, candidate: result });
    await withOwnership(attempt.workspace.artifactDir, async () => {
      await expect(
        activities.check({ ...attempt, candidate: result }),
      ).rejects.toThrow("already has a writer");
    });
    await git(
      attempt.workspace.path,
      "commit",
      "--allow-empty",
      "-m",
      "another revision",
    );
    await expect(
      activities.check({ ...attempt, candidate: result }),
    ).rejects.toThrow("differs");
  });

  it("preserves failed subprocess output and cancels a running command", async () => {
    const output = join(temp, "command.log");
    expect(
      await runCommand("echo evidence; exit 7", {
        cwd: project,
        output,
        timeoutMs: 1000,
      }),
    ).toBe(7);
    expect(await readFile(output, "utf8")).toContain("evidence");
    const controller = new AbortController();
    const running = runCommand("sleep 30", {
      cwd: project,
      output,
      timeoutMs: 60_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    expect(await running).toBeNull();
  });

  it("runs approved locked installs from an npm-started worker without inheriting one-off script flags", async () => {
    vi.stubEnv("npm_lifecycle_event", "start");
    vi.stubEnv("npm_config_allow_scripts", "one-off-package");
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(
      join(project, "package-lock.json"),
      JSON.stringify({
        name: "fixture",
        version: "1.0.0",
        lockfileVersion: 3,
        packages: { "": { name: "fixture", version: "1.0.0" } },
      }),
    );
    const output = join(temp, "install.log");
    const exitCode = await runCommand("npm ci --no-audit --no-fund", {
      cwd: project,
      output,
      timeoutMs: 10_000,
    });
    expect(await readFile(output, "utf8")).not.toContain("EALLOWSCRIPTS");
    expect(exitCode).toBe(0);
  });

  it("refuses an approval identity reused with different contents", async () => {
    const activities = workspaceActivities(join(temp, "state"));
    await activities.prepare(input);
    await expect(
      activities.prepare({
        ...input,
        contract: { ...input.contract, title: "different" },
      }),
    ).rejects.toThrow("another approval");
  });

  it("fails closed when acceptance artifacts are absent or altered", async () => {
    const { activities, attempt, result } = await candidate();
    const checkInput = { ...attempt, candidate: result };
    const checks = await activities.check(checkInput);
    await writeJson(join(attempt.workspace.artifactDir, "checks-0.json"), []);
    await expect(
      activities.accept({
        ...attempt,
        result: {
          taskId: "one",
          executionId: input.executionId,
          acceptedCommit: result.revision,
          workspace: attempt.workspace,
          checks,
          review: null,
          evidence: [],
          humanConfirmations: [],
          blockers: [],
        },
      }),
    ).rejects.toThrow("recorded checks");
    expect(
      await readJson<Candidate>(
        join(attempt.workspace.artifactDir, "candidate-0.json"),
      ),
    ).not.toBeNull();
  });
});
