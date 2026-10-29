import { execFile } from "node:child_process";
import { watch } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  Activities,
  RunInput,
  Workspace,
  AttemptInput,
  CommandEvidence,
  ReviewInput,
  Integration,
  IntegrationInput,
  WorkInput,
  SessionReference,
} from "../domain/contracts.js";
import {
  assertReview,
  checksPassed,
  runIdentity,
} from "../domain/contracts.js";
import { runCommand } from "./process.js";
import { withOwnership } from "./ownership.js";
import { projectId, readJson, writeJson } from "./storage.js";
const exec = promisify(execFile);
export async function git(cwd: string, ...args: string[]): Promise<string> {
  return (
    await exec("git", ["-C", cwd, ...args], {
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    })
  ).stdout.trim();
}
export async function assertRevision(
  workspace: Pick<Workspace, "path">,
  expected: string,
): Promise<void> {
  if (
    (await git(workspace.path, "rev-parse", "HEAD")) !== expected ||
    (await git(
      workspace.path,
      "status",
      "--porcelain",
      "--untracked-files=all",
    ))
  )
    throw new Error(`Workspace differs from checked revision ${expected}`);
}
export function runDirectory(root: string, runId: string): string {
  runIdentity.parse(runId);
  return join(root, "sessions", runId);
}
function baseChanged(): never {
  const error = new Error(
    "Development base changed; submit a new contract version and run",
  );
  error.name = "BaseChanged";
  throw error;
}
async function fetchDev(project: string): Promise<string> {
  await git(
    project,
    "fetch",
    "--no-tags",
    "origin",
    "+refs/heads/dev:refs/remotes/origin/dev",
  );
  return git(project, "rev-parse", "refs/remotes/origin/dev");
}
async function requireBase(input: RunInput): Promise<void> {
  if (
    (await fetchDev(input.project)) !== input.contract.startCommit ||
    (await git(input.project, "rev-parse", "refs/heads/dev")) !==
      input.contract.startCommit
  )
    baseChanged();
}
async function branchExists(project: string, branch: string): Promise<boolean> {
  return !!(await git(project, "branch", "--list", branch));
}
async function worktreeExists(project: string, path: string): Promise<boolean> {
  return (await git(project, "worktree", "list", "--porcelain"))
    .split("\n")
    .includes(`worktree ${path}`);
}
async function ensureWorktree(
  input: RunInput,
  workspace: Workspace,
): Promise<void> {
  if (!(await worktreeExists(input.project, workspace.path))) {
    if (await branchExists(input.project, workspace.branch))
      throw new Error(
        "Branch exists without recorded worktree; reconcile preserved state",
      );
    await git(
      input.project,
      "worktree",
      "add",
      "-b",
      workspace.branch,
      workspace.path,
      workspace.base,
    );
  }
  if (
    (await git(workspace.path, "branch", "--show-current")) !== workspace.branch
  )
    throw new Error("Workspace branch changed");
}
export async function runSetup(
  input: WorkInput,
  signal?: AbortSignal,
): Promise<void> {
  for (const command of input.contract.setup) {
    const file = join(input.workspace.artifactDir, `setup-${command.id}`);
    const done = await readJson<{ exitCode: number | null }>(file + ".json");
    if (done?.exitCode === 0) continue;
    if ((await readJson(file + ".started.json")) && !done)
      throw new Error(
        `Setup ${command.id} has an uncertain outcome; reconcile preserved output`,
      );
    await writeJson(file + ".started.json", { command });
    const exitCode = await runCommand(command.command, {
      cwd: input.workspace.path,
      output: file + ".log",
      timeoutMs: input.configuration.runtime.checkTimeoutSeconds * 1000,
      ...(signal ? { signal } : {}),
    });
    await writeJson(file + ".json", { exitCode });
    if (exitCode !== 0)
      throw new Error(`Setup ${command.id} failed; see ${file}.log`);
  }
}
async function checkCommands(
  input: RunInput,
  workspace: Workspace,
  commit: string,
  prefix: string,
  signal?: AbortSignal,
): Promise<CommandEvidence[]> {
  await assertRevision(workspace, commit);
  const file = join(workspace.artifactDir, `${prefix}.json`);
  const saved = await readJson<CommandEvidence[]>(file);
  if (saved) {
    if (saved.some((e) => e.revision !== commit))
      throw new Error("Cached checks belong to another revision");
    return saved;
  }
  const tracked = new Set((await git(workspace.path, "ls-files")).split("\n"));
  let changed = false;
  const watcher = watch(workspace.path, { recursive: true }, (_event, path) => {
    if (path && tracked.has(path)) changed = true;
  });
  const evidence: CommandEvidence[] = [];
  try {
    for (const command of input.contract.checks) {
      const outputRef = join(
        workspace.artifactDir,
        `${prefix}-${command.id}.log`,
      );
      const exitCode = await runCommand(command.command, {
        cwd: workspace.path,
        output: outputRef,
        timeoutMs: input.configuration.runtime.checkTimeoutSeconds * 1000,
        ...(signal ? { signal } : {}),
      });
      let unchanged = !changed;
      try {
        await assertRevision(workspace, commit);
      } catch {
        unchanged = false;
      }
      evidence.push({
        ...command,
        exitCode,
        outputRef,
        revision: commit,
        unchanged,
      });
      if (!unchanged) break;
    }
    if (changed)
      evidence.forEach((e) => {
        e.unchanged = false;
      });
    await writeJson(file, evidence);
    return evidence;
  } finally {
    watcher.close();
  }
}
export function workspaceActivities(
  root: string,
  signal?: AbortSignal,
): Pick<
  Activities,
  | "prepare"
  | "setup"
  | "candidate"
  | "check"
  | "integrate"
  | "push"
  | "cleanup"
  | "record"
> {
  async function projectGuard<T>(
    input: RunInput,
    action: () => Promise<T>,
  ): Promise<T> {
    const repository = await realpath(
      resolve(
        input.project,
        await git(input.project, "rev-parse", "--git-common-dir"),
      ),
    );
    const directory = join(
      root,
      "sessions",
      ".integration-locks",
      projectId(repository),
    );
    await mkdir(join(root, "worktrees", projectId(input.project)), {
      recursive: true,
    });
    await mkdir(directory, { recursive: true });
    return withOwnership(directory, action);
  }
  async function guarded<T>(
    input: WorkInput,
    action: () => Promise<T>,
  ): Promise<T> {
    return withOwnership(input.workspace.artifactDir, async () => {
      if (
        (await git(input.workspace.path, "branch", "--show-current")) !==
        input.workspace.branch
      )
        throw new Error("Workspace branch changed");
      return action();
    });
  }
  async function assertIntegration(input: IntegrationInput): Promise<void> {
    // Read the immutable delivery checkpoint rather than trusting a caller's result.
    const delivery = await readJson<Integration>(
      join(input.workspace.artifactDir, "delivery.json"),
    );
    if (
      !delivery ||
      JSON.stringify(delivery) !== JSON.stringify(input.integration)
    )
      throw new Error("Integration does not match recorded evidence");
    if (!checksPassed(input.contract, delivery.checks, delivery.revision))
      throw new Error("Invalid integration check evidence");
  }
  return {
    prepare: (input) =>
      projectGuard(input, async () => {
        const artifactDir = runDirectory(root, input.runId);
        await mkdir(artifactDir, { recursive: true });
        return withOwnership(artifactDir, async () => {
          const original = await readJson<RunInput>(
            join(artifactDir, "input.json"),
          );
          if (original && JSON.stringify(original) !== JSON.stringify(input))
            throw new Error("Run identity belongs to different input");
          if (!original)
            await writeJson(join(artifactDir, "input.json"), input);
          await requireBase(input);
          // Reject dirty development worktrees, including a dev checkout outside the supplied path.
          for (const block of (
            await git(input.project, "worktree", "list", "--porcelain")
          ).split("\n\n")) {
            if (block.includes("branch refs/heads/dev"))
              await assertRevision(
                { path: block.split("\n")[0]!.slice(9) },
                input.contract.startCommit,
              );
          }
          await git(input.project, "var", "GIT_AUTHOR_IDENT");
          const workspace: Workspace = {
            path: join(
              root,
              "worktrees",
              projectId(input.project),
              input.runId,
            ),
            branch: `feature/claith-${input.runId}`,
            base: input.contract.startCommit,
            artifactDir,
          };
          await ensureWorktree(input, workspace);
          return workspace;
        });
      }),
    setup: (input) => guarded(input, () => runSetup(input, signal)),
    candidate: (input: AttemptInput) =>
      guarded(input, async () => {
        const file = join(
          input.workspace.artifactDir,
          `candidate-${input.attempt}.json`,
        );
        const saved = await readJson<{ revision: string; diffRef: string }>(
          file,
        );
        if (saved) {
          await assertRevision(input.workspace, saved.revision);
          return saved;
        }
        const marker = `Claith-Operation: ${input.runId}-${input.attempt}`;
        if (
          !(
            await git(input.workspace.path, "log", "-1", "--format=%B")
          ).includes(marker)
        ) {
          await git(input.workspace.path, "add", "--all");
          await git(
            input.workspace.path,
            "-c",
            "core.hooksPath=/dev/null",
            "commit",
            "--allow-empty",
            "-m",
            `${input.contract.title}\n\n${marker}`,
          );
        }
        const commit = await git(input.workspace.path, "rev-parse", "HEAD");
        const diffRef = join(
          input.workspace.artifactDir,
          `diff-${input.attempt}.patch`,
        );
        const { writeFile } = await import("node:fs/promises");
        await writeFile(
          diffRef,
          await git(
            input.workspace.path,
            "diff",
            "--no-ext-diff",
            input.contract.startCommit,
            commit,
          ),
        );
        const candidate = { revision: commit, diffRef };
        await writeJson(file, candidate);
        return candidate;
      }),
    check: (input: ReviewInput) =>
      guarded(input, () =>
        checkCommands(
          input,
          input.workspace,
          input.candidate.revision,
          `checks-${input.attempt}`,
          signal,
        ),
      ),
    integrate: (input) =>
      projectGuard(input, () =>
        guarded(input, async () => {
          await requireBase(input);
          assertReview(input, input.review.submission);
          const recordedChecks = await readJson(
            join(input.workspace.artifactDir, `checks-${input.attempt}.json`),
          );
          const recordedReview = await readJson(
            join(
              input.workspace.artifactDir,
              `reviewer-${input.attempt}`,
              "result.json",
            ),
          );
          if (
            JSON.stringify(recordedChecks) !== JSON.stringify(input.checks) ||
            JSON.stringify(recordedReview) !== JSON.stringify(input.review) ||
            input.review.submission.verdict !== "accepted"
          )
            throw new Error(
              "Acceptance does not match recorded review/check evidence",
            );
          await assertRevision(input.workspace, input.candidate.revision);
          const path = join(
            input.workspace.path + `-integration-${input.attempt}`,
          );
          const branch = `claith-integration-${input.runId}-${input.attempt}`;
          const file = join(
            input.workspace.artifactDir,
            `integration-${input.attempt}.json`,
          );
          const prior = await readJson<Integration>(file);
          let integration: Integration;
          if (prior) {
            integration = prior;
            await assertRevision({ path }, prior.revision);
          } else {
            await ensureWorktree(input, {
              path,
              branch,
              base: input.contract.startCommit,
              artifactDir: input.workspace.artifactDir,
            });
            const head = await git(path, "rev-parse", "HEAD");
            if (head === input.contract.startCommit)
              await git(
                path,
                "-c",
                "core.hooksPath=/dev/null",
                "merge",
                "--no-ff",
                "--no-edit",
                input.candidate.revision,
              );
            const commit = await git(path, "rev-parse", "HEAD");
            const parents = (
              await git(path, "show", "-s", "--format=%P", "HEAD")
            ).split(" ");
            if (
              parents[0] !== input.contract.startCommit ||
              parents[1] !== input.candidate.revision ||
              parents.length !== 2
            )
              throw new Error(
                "Unexpected integration commit; reconcile manually",
              );
            const checks = await checkCommands(
              input,
              {
                path,
                branch,
                base: input.contract.startCommit,
                artifactDir: input.workspace.artifactDir,
              },
              commit,
              `integration-checks-${input.attempt}`,
              signal,
            );
            integration = { revision: commit, path, branch, checks };
            await writeJson(file, integration);
          }
          if (
            checksPassed(
              input.contract,
              integration.checks,
              integration.revision,
            )
          )
            await writeJson(
              join(input.workspace.artifactDir, "delivery.json"),
              integration,
            );
          return integration;
        }),
      ),
    push: (input) =>
      projectGuard(input, async () => {
        await assertIntegration(input);
        const commit = input.integration.revision;
        const remote = await fetchDev(input.project);
        const local = await git(input.project, "rev-parse", "refs/heads/dev");
        // If a previous push succeeded, a later remote tip may already contain our commit.
        let remoteContains = false;
        try {
          await git(
            input.project,
            "merge-base",
            "--is-ancestor",
            commit,
            remote,
          );
          remoteContains = true;
        } catch {
          /* not delivered */
        }
        if (remoteContains) {
          await writeJson(join(input.workspace.artifactDir, "pushed.json"), {
            revision: commit,
          });
          return;
        }
        if (
          remote !== input.contract.startCommit ||
          (local !== input.contract.startCommit && local !== commit)
        )
          baseChanged();
        const blocks = (
          await git(input.project, "worktree", "list", "--porcelain")
        ).split("\n\n");
        const dev = blocks.find((b) => b.includes("branch refs/heads/dev"));
        if (dev) {
          const path = dev.split("\n")[0]!.slice(9);
          await assertRevision({ path }, local);
          if (local !== commit)
            await git(
              path,
              "-c",
              "core.hooksPath=/dev/null",
              "merge",
              "--ff-only",
              commit,
            );
        } else if (local !== commit)
          await git(
            input.project,
            "update-ref",
            "refs/heads/dev",
            commit,
            input.contract.startCommit,
          );
        if ((await fetchDev(input.project)) !== input.contract.startCommit)
          baseChanged();
        // Push the exact verified object, never an unbounded moving local ref.
        await git(input.project, "push", "origin", `${commit}:refs/heads/dev`);
        await fetchDev(input.project);
        await git(
          input.project,
          "merge-base",
          "--is-ancestor",
          commit,
          "refs/remotes/origin/dev",
        );
        await writeJson(join(input.workspace.artifactDir, "pushed.json"), {
          revision: commit,
        });
      }),
    cleanup: (input) =>
      projectGuard(input, async () => {
        await assertIntegration(input);
        const pushed = await readJson<{ revision: string }>(
          join(input.workspace.artifactDir, "pushed.json"),
        );
        if (pushed?.revision !== input.integration.revision)
          throw new Error("Cleanup requires confirmed push");
        await fetchDev(input.project);
        await git(
          input.project,
          "merge-base",
          "--is-ancestor",
          input.integration.revision,
          "refs/remotes/origin/dev",
        );
        // Reconcile all process groups before removing any owned worktree.
        await withOwnership(input.workspace.artifactDir, async () => {
          const directories = [
            input.workspace.path,
            ...(await git(input.project, "worktree", "list", "--porcelain"))
              .split("\n")
              .filter((l) =>
                l.startsWith(`worktree ${input.workspace.path}-integration-`),
              )
              .map((l) => l.slice(9)),
          ];
          for (const path of directories) {
            if (await worktreeExists(input.project, path))
              await git(input.project, "worktree", "remove", path);
          }
          // Only delete branches in this run's explicitly owned namespace after ancestry validation.
          for (const branch of [
            input.workspace.branch,
            ...(
              await git(
                input.project,
                "branch",
                "--list",
                `claith-integration-${input.runId}-*`,
              )
            )
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
          ]) {
            if (await branchExists(input.project, branch)) {
              const expected = await git(input.project, "rev-parse", branch);
              if (branch === input.workspace.branch)
                await git(
                  input.project,
                  "merge-base",
                  "--is-ancestor",
                  expected,
                  input.integration.revision,
                );
              else {
                const attempt = branch.slice(
                  `claith-integration-${input.runId}-`.length,
                );
                if (!/^\d+$/.test(attempt))
                  throw new Error("Unknown integration branch");
                const owned = await readJson<Integration>(
                  join(
                    input.workspace.artifactDir,
                    `integration-${attempt}.json`,
                  ),
                );
                if (
                  !owned ||
                  owned.branch !== branch ||
                  owned.revision !== expected
                )
                  throw new Error(
                    "Integration branch differs from its checkpoint",
                  );
              }
              if (
                (await git(input.project, "worktree", "list", "--porcelain"))
                  .split("\n")
                  .includes(`branch refs/heads/${branch}`)
              )
                throw new Error("Owned branch is still checked out");
              await git(
                input.project,
                "update-ref",
                "-d",
                `refs/heads/${branch}`,
                expected,
              );
            }
          }
          await writeJson(join(input.workspace.artifactDir, "cleaned.json"), {
            revision: input.integration.revision,
          });
        });
      }),
    record: async (record) => {
      const directory = runDirectory(root, record.execution.runId);
      await mkdir(directory, { recursive: true });
      const original = await readJson<RunInput>(join(directory, "input.json"));
      if (
        original &&
        JSON.stringify(original.contract) !== JSON.stringify(record.contract)
      )
        throw new Error("Cannot mutate run contract");
      const sessions: SessionReference[] = [];
      for (const attempt of record.execution.attempts) {
        for (const role of ["implementer", "reviewer"] as const) {
          const manifest = await readJson<{ id: string; path: string }>(
            join(directory, `${role}-${attempt.attempt}`, "session.json"),
          );
          if (manifest)
            sessions.push({
              role,
              attempt: attempt.attempt,
              sessionId: manifest.id,
              path: manifest.path,
            });
        }
      }
      await writeJson(join(directory, "run.json"), {
        ...record,
        execution: { ...record.execution, sessions },
      });
      return sessions;
    },
  };
}
