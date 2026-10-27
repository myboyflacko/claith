import { execFile } from "node:child_process";
import { watch } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  Activities,
  AttemptInput,
  Candidate,
  CommandEvidence,
  Implementation,
  TaskInput,
  Workspace,
} from "../domain/contracts.js";
import { runCommand } from "./process.js";
import { withOwnership } from "./ownership.js";
import { projectId, readJson, taskDirectory, writeJson } from "./storage.js";

const exec = promisify(execFile);
export async function git(cwd: string, ...args: string[]): Promise<string> {
  return (
    await exec("git", ["-C", cwd, ...args], { maxBuffer: 16 * 1024 * 1024 })
  ).stdout.trim();
}
export async function assertRevision(
  workspace: Workspace,
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
  ) {
    throw new Error(`Workspace differs from checked revision ${expected}`);
  }
}
export function workspaceActivities(
  root: string,
  signal?: AbortSignal,
): Pick<Activities, "prepare" | "candidate" | "check" | "accept"> {
  async function prepare(input: TaskInput): Promise<Workspace> {
    const artifactDir = taskDirectory(
      root,
      input.project,
      input.sessionId,
      input.executionId,
    );
    await mkdir(artifactDir, { recursive: true });
    return withOwnership(artifactDir, async () => {
      const path = join(
        root,
        "worktrees",
        projectId(input.project),
        input.executionId,
      );
      const workspace: Workspace = {
        path,
        branch: `feature/claith-${input.executionId}`,
        base: input.contract.startingRevision,
        artifactDir,
      };
      const previous = await readJson<{
        workspace: Workspace;
        input: TaskInput;
      }>(join(artifactDir, "approval.json"));
      if (previous && JSON.stringify(previous.input) !== JSON.stringify(input))
        throw new Error(
          "Execution identity already belongs to another approval",
        );
      if (!previous)
        await writeJson(join(artifactDir, "approval.json"), {
          workspace,
          input,
        });
      const worktrees = await git(
        input.project,
        "worktree",
        "list",
        "--porcelain",
      );
      if (!worktrees.split("\n").includes(`worktree ${path}`)) {
        const branch = await git(
          input.project,
          "branch",
          "--list",
          workspace.branch,
        );
        if (branch)
          throw new Error(
            "Branch exists without its recorded worktree; reconcile manually",
          );
        await mkdir(join(root, "worktrees", projectId(input.project)), {
          recursive: true,
        });
        await git(
          input.project,
          "worktree",
          "add",
          "-b",
          workspace.branch,
          path,
          workspace.base,
        );
      }
      if ((await git(path, "branch", "--show-current")) !== workspace.branch)
        throw new Error("Worktree branch ownership mismatch");
      await git(path, "merge-base", "--is-ancestor", workspace.base, "HEAD");
      return workspace;
    });
  }
  function guarded<T>(
    input: AttemptInput,
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
  return {
    prepare,
    candidate: (input: AttemptInput & { implementation: Implementation }) =>
      guarded(input, async () => {
        const file = join(
          input.workspace.artifactDir,
          `candidate-${input.attempt}.json`,
        );
        const saved = await readJson<Candidate>(file);
        if (saved) {
          await assertRevision(input.workspace, saved.revision);
          return saved;
        }
        const marker = `Claith-Operation: ${input.executionId}-${input.attempt}`;
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
        const revision = await git(input.workspace.path, "rev-parse", "HEAD");
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
            input.contract.startingRevision,
            revision,
          ),
        );
        const candidate = {
          revision,
          diffRef,
          implementation: input.implementation,
        };
        await writeJson(file, candidate);
        return candidate;
      }),
    check: (input) =>
      guarded(input, async () => {
        const { workspace, candidate, contract, attempt } = input;
        await assertRevision(workspace, candidate.revision);
        const file = join(workspace.artifactDir, `checks-${attempt}.json`);
        const saved = await readJson<CommandEvidence[]>(file);
        if (saved) return saved;
        const tracked = new Set(
          (await git(workspace.path, "ls-files")).split("\n"),
        );
        let changed = false;
        const watcher = watch(
          workspace.path,
          { recursive: true },
          (_event, path) => {
            if (path && tracked.has(path)) changed = true;
          },
        );
        const evidence: CommandEvidence[] = [];
        try {
          for (const command of contract.checks) {
            const outputRef = join(
              workspace.artifactDir,
              `check-${attempt}-${command.id}.log`,
            );
            const exitCode = await runCommand(command.command, {
              cwd: workspace.path,
              output: outputRef,
              timeoutMs: input.configuration.runtime.checkTimeoutSeconds * 1000,
              ...(signal ? { signal } : {}),
            });
            let unchanged = !changed;
            try {
              await assertRevision(workspace, candidate.revision);
            } catch {
              unchanged = false;
            }
            evidence.push({
              ...command,
              exitCode,
              outputRef,
              revision: candidate.revision,
              unchanged,
            });
            await writeJson(
              join(
                workspace.artifactDir,
                `check-${attempt}-${command.id}.json`,
              ),
              evidence.at(-1),
            );
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
      }),
    accept: (input) =>
      guarded(input, async () => {
        await assertRevision(input.workspace, input.result.acceptedCommit);
        const checks = await readJson<CommandEvidence[]>(
          join(input.workspace.artifactDir, `checks-${input.attempt}.json`),
        );
        if (
          !checks ||
          checks.length !== input.contract.checks.length ||
          input.contract.checks.some(
            (command) =>
              !checks.some(
                (c) => c.id === command.id && c.command === command.command,
              ),
          ) ||
          JSON.stringify(checks) !== JSON.stringify(input.result.checks) ||
          checks.some(
            (c) =>
              !c.unchanged ||
              c.exitCode !== 0 ||
              c.revision !== input.result.acceptedCommit,
          )
        )
          throw new Error("Acceptance evidence does not match recorded checks");
        await writeJson(
          join(input.workspace.artifactDir, "accepted.json"),
          input.result,
        );
      }),
  };
}

export async function runSetup(
  input: AttemptInput,
  signal?: AbortSignal,
): Promise<void> {
  for (const command of input.contract.setup) {
    const file = join(
      input.workspace.artifactDir,
      `setup-${input.attempt}-${command.id}`,
    );
    const done = await readJson<{ exitCode: number | null }>(file + ".json");
    if (done?.exitCode === 0) continue;
    const started = await readJson(file + ".started.json");
    if (started && !done)
      throw new Error(
        `Setup ${command.id} has an uncertain outcome; reconcile its preserved output before continuing`,
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

export async function readDiff(path: string): Promise<string> {
  return readFile(path, "utf8");
}
