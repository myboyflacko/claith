import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { AttemptInput, ReviewInput } from "../src/domain/contracts.js";
import {
  git,
  workspaceActivities,
  assertRevision,
  runSetup,
} from "../src/workspace/git.js";
import { writeJson, readJson, projectId } from "../src/workspace/storage.js";
import { withOwnership } from "../src/workspace/ownership.js";
import { runCommand } from "../src/workspace/process.js";
import {
  projectFixture,
  acceptedReview,
  verificationPlan,
} from "./fixtures/task.js";
let temp: string;
let fixture: Awaited<ReturnType<typeof projectFixture>>;
let project: string;
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), "claith-delivery-"));
  fixture = await projectFixture(temp);
  project = fixture.project;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(temp, { recursive: true, force: true });
});
async function candidate(plan = verificationPlan()) {
  const { root, input } = fixture;
  const activities = workspaceActivities(root);
  const workspace = await activities.prepare(input);
  await writeFile(join(workspace.path, "source.txt"), "changed");
  const work: AttemptInput = { ...input, workspace, attempt: 0, feedback: "" };
  await writeJson(join(workspace.artifactDir, "implementer-0", "result.json"), {
    sessionId: "implementer",
    submission: {
      runId: input.runId,
      taskId: input.contract.taskId,
      version: input.contract.version,
      attempt: 0,
      revision: input.startCommit,
      status: "submitted",
      summary: "Done",
      verificationPlan: plan,
      evidence: [{ criterionId: "works", references: ["test"] }],
    },
  });
  const result = await activities.candidate(work);
  const reviewInput: ReviewInput = { ...work, candidate: result, checks: [] };
  reviewInput.checks = await activities.check(reviewInput);
  const review = {
    sessionId: "review",
    submission: acceptedReview(reviewInput),
  };
  await writeJson(
    join(workspace.artifactDir, "reviewer-0", "result.json"),
    review,
  );
  return { activities, work, reviewInput, review, result };
}
describe("verified Git delivery", () => {
  it("coordinates integration across different worktree entrypoints of the same repository", async () => {
    const activities = workspaceActivities(fixture.root);
    await activities.prepare(fixture.input);
    const alternate = join(temp, "alternate");
    await git(
      project,
      "worktree",
      "add",
      "-b",
      "inspection",
      alternate,
      fixture.input.startCommit,
    );
    const lock = join(
      fixture.root,
      "sessions",
      ".integration-locks",
      projectId(join(project, ".git")),
    );
    await withOwnership(lock, async () => {
      await expect(
        activities.prepare({
          ...fixture.input,
          runId: "other-task",
          project: alternate,
        }),
      ).rejects.toThrow("already has a writer");
    });
  });
  it("merges, checks, pushes exact revision, reconciles a lost push acknowledgement, and cleans up idempotently", async () => {
    const { activities, work, reviewInput, review } = await candidate();
    const integration = await activities.integrate({ ...reviewInput, review });
    expect(await git(project, "rev-parse", "dev")).toBe(
      fixture.input.startCommit,
    );
    expect(
      (await git(integration.path, "show", "-s", "--format=%P", "HEAD")).split(
        " ",
      ),
    ).toHaveLength(2);
    const delivery = {
      ...fixture.input,
      workspace: work.workspace,
      integration,
    };
    await activities.push(delivery);
    await rm(join(work.workspace.artifactDir, "pushed.json"));
    await activities.push(delivery);
    expect(await git(project, "rev-parse", "dev")).toBe(integration.revision);
    expect(await git(fixture.remote, "rev-parse", "dev")).toBe(
      integration.revision,
    );
    await activities.cleanup(delivery);
    await activities.cleanup(delivery);
    expect(await git(project, "branch", "--list", work.workspace.branch)).toBe(
      "",
    );
    expect(
      await readJson(join(work.workspace.artifactDir, "candidate-0.json")),
    ).not.toBeNull();
  });
  it("runs agent-selected shell setup and checks in both task and fresh integration worktrees", async () => {
    await writeFile(join(project, ".gitignore"), ".ready\n");
    await git(project, "add", ".gitignore");
    await git(project, "commit", "-m", "ignore setup output");
    await git(project, "push", "origin", "dev");
    fixture.input.startCommit = await git(project, "rev-parse", "HEAD");
    const plan = {
      setup: [{ id: "prepare", command: "printf ready > .ready" }],
      checks: [
        {
          id: "test",
          command:
            'test "$(cat .ready)" = ready && test "$(cat source.txt)" = changed',
        },
      ],
    };
    const { activities, work, reviewInput, review } = await candidate(plan);
    expect(reviewInput.checks[0]!.exitCode).toBe(0);
    const integration = await activities.integrate({ ...reviewInput, review });
    expect(integration.verificationPlan).toEqual(plan);
    expect(integration.checks[0]!.exitCode).toBe(0);
    expect(await readFile(join(integration.path, ".ready"), "utf8")).toBe(
      "ready",
    );
    for (const prefix of ["checks-0", "integration-checks-0"]) {
      expect(
        await readJson(
          join(work.workspace.artifactDir, `${prefix}-setup-prepare.json`),
        ),
      ).toEqual({ exitCode: 0, command: plan.setup[0]!.command });
    }
    const delivery = {
      ...fixture.input,
      workspace: work.workspace,
      integration,
    };
    await activities.push(delivery);
    await activities.cleanup(delivery);
    expect(await git(fixture.remote, "rev-parse", "dev")).toBe(
      integration.revision,
    );
  });
  it("returns failed setup evidence for repair instead of treating checks as passed", async () => {
    const plan = {
      ...verificationPlan(),
      setup: [{ id: "prepare", command: "echo setup-failed; exit 7" }],
    };
    const { reviewInput } = await candidate(plan);
    expect(reviewInput.checks[0]!.exitCode).toBeNull();
    expect(await readFile(reviewInput.checks[0]!.outputRef, "utf8")).toContain(
      "setup-failed",
    );
  });
  it("rejects a changed verification plan after the candidate was recorded", async () => {
    const { activities, work, reviewInput, review } = await candidate();
    const file = join(
      work.workspace.artifactDir,
      "implementer-0",
      "result.json",
    );
    const result = (await readJson<{
      submission: { verificationPlan: ReturnType<typeof verificationPlan> };
    }>(file))!;
    result.submission.verificationPlan.checks[0]!.command = "true";
    await writeJson(file, result);
    await expect(activities.candidate(work)).rejects.toThrow(
      "verification plan changed",
    );
    const changed = {
      ...reviewInput,
      candidate: {
        ...reviewInput.candidate,
        verificationPlan: {
          setup: [],
          checks: [{ id: "test", command: "true" }],
        },
      },
      checks: reviewInput.checks.map((check) => ({
        ...check,
        command: "true",
      })),
    };
    await expect(activities.integrate({ ...changed, review })).rejects.toThrow(
      "recorded review/check",
    );
  });
  it("recovers a candidate commit whose checkpoint was lost", async () => {
    const { activities, work, result } = await candidate();
    await rm(join(work.workspace.artifactDir, "candidate-0.json"));
    expect((await activities.candidate(work)).revision).toBe(result.revision);
  });
  it("blocks a changed local or remote development base", async () => {
    const { activities, reviewInput, review } = await candidate();
    await git(project, "commit", "--allow-empty", "-m", "other work");
    await expect(
      activities.integrate({ ...reviewInput, review }),
    ).rejects.toThrow("Development base changed");
    await expect(activities.prepare(fixture.input)).rejects.toThrow(
      "Development base changed",
    );
  });
  it("does not modify dev when integration checks fail", async () => {
    const plan = verificationPlan();
    plan.checks[0]!.command =
      'test "$(git rev-list --parents -n 1 HEAD | wc -w)" -eq 2';
    const { activities, reviewInput, review } = await candidate(plan);
    const integration = await activities.integrate({ ...reviewInput, review });
    expect(integration.checks[0]!.exitCode).not.toBe(0);
    expect(await git(project, "rev-parse", "dev")).toBe(
      fixture.input.startCommit,
    );
  });
  it("cleans up earlier rejected integration branches after a successful repair", async () => {
    const plan = verificationPlan();
    plan.checks[0]!.command =
      'test "$(git rev-list --parents -n 1 HEAD | wc -w)" -eq 2 || grep -q repaired source.txt';
    const { activities, work, reviewInput, review } = await candidate(plan);
    const rejected = await activities.integrate({ ...reviewInput, review });
    expect(rejected.checks[0]!.exitCode).not.toBe(0);
    const next = { ...work, attempt: 1 };
    await writeFile(join(work.workspace.path, "source.txt"), "repaired");
    const firstSubmission = (await readJson<{
      sessionId: string;
      submission: Record<string, unknown>;
    }>(join(work.workspace.artifactDir, "implementer-0", "result.json")))!;
    await writeJson(
      join(work.workspace.artifactDir, "implementer-1", "result.json"),
      {
        ...firstSubmission,
        submission: { ...firstSubmission.submission, attempt: 1 },
      },
    );
    const result = await activities.candidate(next);
    const checked = {
      ...next,
      candidate: result,
      checks: [] as ReviewInput["checks"],
    };
    checked.checks = await activities.check(checked);
    const accepted = {
      sessionId: "review-1",
      submission: acceptedReview(checked),
    };
    await writeJson(
      join(work.workspace.artifactDir, "reviewer-1", "result.json"),
      accepted,
    );
    const integration = await activities.integrate({
      ...checked,
      review: accepted,
    });
    const delivery = {
      ...fixture.input,
      workspace: work.workspace,
      integration,
    };
    await activities.push(delivery);
    await activities.cleanup(delivery);
    expect(await git(project, "branch", "--list", rejected.branch)).toBe("");
  });
  it("retains the accepted candidate after a rejected push and resumes delivery only", async () => {
    const { activities, work, reviewInput, review, result } = await candidate();
    const integration = await activities.integrate({ ...reviewInput, review });
    const delivery = {
      ...fixture.input,
      workspace: work.workspace,
      integration,
    };
    const hook = join(fixture.remote, "hooks", "pre-receive");
    await writeFile(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    await expect(activities.push(delivery)).rejects.toThrow();
    expect(await git(project, "rev-parse", "dev")).toBe(integration.revision);
    expect(await git(fixture.remote, "rev-parse", "dev")).toBe(
      fixture.input.startCommit,
    );
    await expect(activities.cleanup(delivery)).rejects.toThrow(
      "confirmed push",
    );
    await rm(hook);
    await activities.push(delivery);
    expect(await git(work.workspace.path, "rev-parse", "HEAD")).toBe(
      result.revision,
    );
    await activities.cleanup(delivery);
  });
  it("rejects a forged review or altered check evidence", async () => {
    const { activities, reviewInput, review } = await candidate();
    await writeJson(
      join(reviewInput.workspace.artifactDir, "checks-0.json"),
      [],
    );
    await expect(
      activities.integrate({ ...reviewInput, review }),
    ).rejects.toThrow("recorded review/check");
  });
  it.each([
    "printf mutated > source.txt",
    "printf temporary > source.txt; git restore source.txt",
  ])(
    "invalidates modifying checks, including restored content: %s",
    async (command) => {
      const plan = verificationPlan();
      plan.checks[0]!.command = command;
      const { reviewInput } = await candidate(plan);
      expect(reviewInput.checks[0]!.unchanged).toBe(false);
    },
  );
  it("preserves uncertain setup and refuses overlapping writers", async () => {
    const { work } = await candidate();
    const plan = {
      ...verificationPlan(),
      setup: [{ id: "install", command: "touch unexpected" }],
    };
    await writeJson(
      join(work.workspace.artifactDir, "checks-0-setup-install.started.json"),
      {},
    );
    await expect(runSetup(work, plan, "checks-0")).rejects.toThrow(
      "uncertain outcome",
    );
    await writeJson(
      join(work.workspace.artifactDir, "checks-0-setup-install.json"),
      { exitCode: null, command: "touch unexpected" },
    );
    await expect(runSetup(work, plan, "checks-0")).rejects.toThrow(
      "uncertain outcome",
    );
    await withOwnership(work.workspace.artifactDir, async () => {
      await expect(
        workspaceActivities(fixture.root).candidate(work),
      ).rejects.toThrow("already has a writer");
    });
  });
  it("rejects revision changes and run identity reuse", async () => {
    const { activities, work, result } = await candidate();
    await git(work.workspace.path, "commit", "--allow-empty", "-m", "other");
    await expect(
      assertRevision(work.workspace, result.revision),
    ).rejects.toThrow("differs");
    await expect(
      activities.prepare({
        ...fixture.input,
        contract: { ...fixture.input.contract, title: "changed" },
      }),
    ).rejects.toThrow("different input");
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
});
