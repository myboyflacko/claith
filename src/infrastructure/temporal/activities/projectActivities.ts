import { ApplicationFailure, Context } from "@temporalio/activity";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, access, realpath, readdir } from "node:fs/promises";
import { join, resolve, relative, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { withQueuedOwnership } from "../workspace/ownership.js";
import { runCommand } from "../workspace/process.js";
import { projectId, readJson, writeJson } from "../workspace/storage.js";
import { runDirectory } from "../workspace/git.js";
import { loadConfiguration } from "../configuration.js";
import { executionConfigurationSchema } from "../domain/configuration.js";
import { contractSchema } from "../domain/contracts.js";
import { collectTaskRun, hasTaskWorkspace } from "./taskRunActivities.js";
import type {
  AssignWorktreeInput,
  Evidence,
  EvidencePage,
  ProjectActivities,
  ProjectRepository,
  PreparedTaskRun,
  WorktreeState,
} from "../workflows/types.js";

interface DispatchSnapshot {
  request: Parameters<ProjectActivities["prepareTaskRun"]>[0];
  prepared: PreparedTaskRun;
  allocation: "reserved" | "retained" | "releasable" | "released";
}

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/);
const evidenceSchema = z.object({
  id: z.string().min(1),
  taskId: id,
  contractId: id.optional(),
  type: z.enum(["log", "artifact", "test-result", "check", "review", "error"]),
  timestamp: z.iso.datetime(),
  data: z.unknown().optional(),
  refs: z.array(z.string()).optional(),
});
const taskSchema = z.object({
  id,
  contractId: id.optional(),
  dependsOn: z.array(id),
  payload: z.unknown(),
  priority: z.number().finite().optional(),
  createdAt: z.iso.datetime().optional(),
});
const invalid = (message: string): never => {
  throw ApplicationFailure.nonRetryable(message, "Validation");
};
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
export interface ProjectActivityOptions {
  /** Temporal namespace is part of persistent identity, just like workflow ID. */
  namespace?: string;
  /** Resolve a secret reference on the worker, never pass key contents through history. */
  resolveSshKey?: (ref: string) => Promise<string>;
}

/** All writable repositories and worktrees are confined to this worker's managed root. */
export function createProjectActivities(
  root: string,
  options: ProjectActivityOptions = {},
): ProjectActivities {
  const namespaceKey = hash(options.namespace ?? "default");
  const managedRoot = resolve(root, "projects", namespaceKey);
  const directory = (projectId: string) => join(managedRoot, hash(projectId));
  async function guarded<T>(
    projectId: string,
    action: (dir: string) => Promise<T>,
  ): Promise<T> {
    const dir = directory(projectId);
    const lock = join(dir, "lock");
    await mkdir(lock, { recursive: true });
    return withQueuedOwnership(lock, () => action(dir));
  }
  async function environment(
    input: Pick<ProjectRepository, "sshKeyRef">,
  ): Promise<NodeJS.ProcessEnv> {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
    if (!input.sshKeyRef) return env;
    if (!options.resolveSshKey)
      invalid("sshKeyRef requires a worker secret resolver");
    const path = await options.resolveSshKey!(input.sshKeyRef);
    return {
      ...env,
      GIT_SSH_COMMAND: `ssh -oBatchMode=yes -oIdentitiesOnly=yes -i '${path.replaceAll("'", "'\\''")}'`,
    };
  }
  async function git(
    cwd: string,
    input: Pick<ProjectRepository, "sshKeyRef">,
    ...args: string[]
  ): Promise<string> {
    const projectDirectory = relative(managedRoot, cwd).split(sep)[0];
    if (!projectDirectory || projectDirectory === "..")
      invalid("Git cwd is not managed");
    const output = join(
      managedRoot,
      projectDirectory!,
      "lock",
      `git-${randomUUID()}.log`,
    );
    const stdout = output + ".stdout";
    const env = await environment(input);
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const argv = [
      "env",
      "GIT_TERMINAL_PROMPT=0",
      ...(env.GIT_SSH_COMMAND
        ? [`GIT_SSH_COMMAND=${env.GIT_SSH_COMMAND}`]
        : []),
      "git",
      "-c",
      "core.hooksPath=/dev/null",
      "-C",
      cwd,
      ...args,
    ];
    let context: Context | undefined;
    try {
      context = Context.current();
    } catch {
      /* Direct adapter tests have no Activity context. */
    }
    const timer = context
      ? setInterval(() => context.heartbeat(), 5000)
      : undefined;
    try {
      const code = await runCommand(
        `${argv.map(quote).join(" ")} > ${quote(stdout)}`,
        {
          cwd,
          output,
          timeoutMs: 90000,
          ...(context ? { signal: context.cancellationSignal } : {}),
        },
      );
      if (code !== 0)
        throw new Error(
          `Git failed (${code}): ${await readFile(output, "utf8")}`,
        );
      return (await readFile(stdout, "utf8")).trim();
    } finally {
      if (timer) clearInterval(timer);
    }
  }
  async function repository(
    dir: string,
    input: ProjectRepository,
  ): Promise<string> {
    if (!input.gitUrl?.trim() || input.gitUrl.startsWith("-"))
      invalid("Invalid gitUrl");
    const manifestPath = join(dir, "repository.json");
    const prior = await readJson<ProjectRepository>(manifestPath);
    if (
      prior &&
      (prior.gitUrl !== input.gitUrl ||
        prior.defaultBranch !== input.defaultBranch ||
        prior.sshKeyRef !== input.sshKeyRef)
    )
      invalid("Project identity belongs to another repository configuration");
    if (!prior) await writeJson(manifestPath, input);
    const repo = join(dir, "repo");
    if (
      !(await exists(join(repo, ".git"))) &&
      !(await exists(join(repo, "HEAD")))
    ) {
      await git(dir, input, "clone", "--bare", "--", input.gitUrl, repo);
    }
    if (
      (await git(repo, input, "remote", "get-url", "origin")) !== input.gitUrl
    )
      invalid("Managed repository remote changed");
    await git(
      repo,
      input,
      "check-ref-format",
      `refs/heads/${input.defaultBranch}`,
    );
    return repo;
  }
  const poolPath = (dir: string) => join(dir, "worktrees.json");
  async function pool(dir: string): Promise<WorktreeState[]> {
    return (await readJson<WorktreeState[]>(poolPath(dir))) ?? [];
  }
  async function find(
    dir: string,
    worktreeId: string,
  ): Promise<WorktreeState | undefined> {
    return (await pool(dir)).find((w) => w.id === worktreeId);
  }
  async function assign(input: AssignWorktreeInput): Promise<WorktreeState> {
    if (
      !id.safeParse(input.taskId).success ||
      !id.safeParse(input.leaseId).success ||
      !Number.isSafeInteger(input.maxWorktrees) ||
      input.maxWorktrees < 1
    )
      invalid("Invalid worktree assignment");
    return guarded(input.projectId, async (dir) => {
      const repo = await repository(dir, input);
      const worktrees = await pool(dir);
      let lease = worktrees.find((w) => w.id === input.leaseId);
      if (lease && lease.taskId !== input.taskId)
        invalid("Lease belongs to another task");
      if (!lease) {
        if (worktrees.length >= input.maxWorktrees)
          throw ApplicationFailure.nonRetryable(
            "Worktree pool exhausted",
            "WorktreeCapacity",
          );
        await git(
          repo,
          input,
          "fetch",
          "--no-tags",
          "origin",
          `+refs/heads/${input.defaultBranch}:refs/remotes/origin/${input.defaultBranch}`,
        );
        const baseCommit = await git(
          repo,
          input,
          "rev-parse",
          `refs/remotes/origin/${input.defaultBranch}`,
        );
        lease = {
          id: input.leaseId,
          taskId: input.taskId,
          path: join(dir, "worktrees", input.leaseId),
          branch: `feature/claith-${input.leaseId}`,
          baseCommit,
          status: "assigned",
        };
        worktrees.push(lease);
        // Write ownership before git's effects, so a retried Activity can reconcile them.
        await writeJson(poolPath(dir), worktrees);
      }
      const registered = (
        await git(repo, input, "worktree", "list", "--porcelain")
      )
        .split("\n")
        .includes(`worktree ${lease.path}`);
      if (!registered) {
        await mkdir(join(dir, "worktrees"), { recursive: true });
        const branch = await git(repo, input, "branch", "--list", lease.branch);
        if (branch)
          await git(repo, input, "worktree", "add", lease.path, lease.branch);
        else
          await git(
            repo,
            input,
            "worktree",
            "add",
            "-b",
            lease.branch,
            lease.path,
            lease.baseCommit,
          );
      }
      if (
        (await git(lease.path, input, "branch", "--show-current")) !==
        lease.branch
      )
        invalid("Worktree branch changed");
      return lease;
    });
  }
  async function database<T>(action: (db: DatabaseSync) => T): Promise<T> {
    await mkdir(managedRoot, { recursive: true });
    const db = new DatabaseSync(join(managedRoot, "evidence.sqlite"));
    try {
      db.exec(
        "PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS evidence (project_id TEXT NOT NULL, id TEXT NOT NULL, task_id TEXT NOT NULL, contract_id TEXT, body TEXT NOT NULL, PRIMARY KEY(project_id,id)); CREATE INDEX IF NOT EXISTS evidence_task ON evidence(project_id,task_id); CREATE INDEX IF NOT EXISTS evidence_contract ON evidence(project_id,contract_id);",
      );
      return action(db);
    } finally {
      db.close();
    }
  }
  async function allocations(dir: string): Promise<WorktreeState[]> {
    const dispatches = join(dir, "dispatches");
    let names: string[];
    try {
      names = await readdir(dispatches);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const result: WorktreeState[] = [];
    for (const name of names.filter((name) => name.endsWith(".json")).sort()) {
      const path = join(dispatches, name);
      const snapshot = await readJson<DispatchSnapshot>(path);
      if (!snapshot) continue;
      if (
        snapshot.allocation !== "released" ||
        (await hasTaskWorkspace(snapshot.prepared))
      ) {
        if (snapshot.allocation === "released") {
          snapshot.allocation = "retained";
          await writeJson(path, snapshot);
        }
        result.push({ ...snapshot.prepared.worktree, status: "error" });
      }
    }
    return result;
  }
  const dispatchPath = (dir: string, runId: string) => {
    runDirectory(root, runId);
    return join(dir, "dispatches", `${runId}.json`);
  };
  return {
    reconcileTaskRuns: (input) => guarded(input.projectId, allocations),
    abandonTaskRun: (input) =>
      guarded(input.projectId, async (dir) => {
        const path = dispatchPath(dir, input.runId);
        const snapshot = await readJson<DispatchSnapshot>(path);
        if (!snapshot || snapshot.allocation === "released") return;
        if (snapshot.allocation !== "reserved")
          invalid("Cannot abandon a finalized task dispatch");
        if (await hasTaskWorkspace(snapshot.prepared))
          invalid("Cannot abandon a dispatch whose owned workspace exists");
        snapshot.allocation = "released";
        await writeJson(path, snapshot);
      }),
    releaseTaskRunAllocation: (input) =>
      guarded(input.projectId, async (dir) => {
        const path = dispatchPath(dir, input.runId);
        const snapshot = await readJson<DispatchSnapshot>(path);
        if (
          !snapshot ||
          !["releasable", "released"].includes(snapshot.allocation)
        )
          invalid("Only finalized task allocations can be released");
        if (await hasTaskWorkspace(snapshot!.prepared))
          invalid("Cannot free capacity while owned task workspaces remain");
        snapshot!.allocation = "released";
        await writeJson(path, snapshot);
      }),
    prepareTaskRun: (input) =>
      guarded(input.projectId, async (dir) => {
        const payload = z
          .object({
            contract: contractSchema,
            configuration: executionConfigurationSchema.optional(),
          })
          .strict()
          .safeParse(input.task.payload);
        if (!payload.success || payload.data.contract.taskId !== input.task.id)
          invalid(
            "Task payload requires a matching task contract and valid execution configuration",
          );
        if (input.defaultBranch !== "dev")
          invalid("taskWorkflow currently supports delivery to dev only");
        runDirectory(root, input.runId);
        const snapshot = dispatchPath(dir, input.runId);
        const prior = await readJson<DispatchSnapshot>(snapshot);
        if (prior) {
          if (JSON.stringify(prior.request) !== JSON.stringify(input))
            invalid("Run identity belongs to another task dispatch");
          if (prior.allocation === "released")
            invalid("Task dispatch allocation has already been released");
          return prior.prepared;
        }
        if (!Number.isInteger(input.maxWorktrees) || input.maxWorktrees < 1)
          invalid("Invalid task workspace capacity");
        if ((await allocations(dir)).length >= input.maxWorktrees)
          invalid(
            "Task workspace capacity is exhausted by active, retained or uncertain allocations",
          );
        const configuration =
          payload.data!.configuration ?? (await loadConfiguration(root));
        const repo = await repository(dir, input);
        if (
          (await git(repo, input, "rev-parse", "--is-bare-repository")) !==
          "true"
        )
          invalid(
            "Task delivery requires a bare managed clone; reconcile the existing non-bare project before dispatch",
          );
        if (input.sshKeyRef) {
          const env = await environment(input);
          await git(
            repo,
            input,
            "config",
            "core.sshCommand",
            env.GIT_SSH_COMMAND!,
          );
        }
        const common = await realpath(
          resolve(
            repo,
            await git(repo, input, "rev-parse", "--git-common-dir"),
          ),
        );
        const lock = join(
          root,
          "sessions",
          ".integration-locks",
          projectId(common),
        );
        await mkdir(lock, { recursive: true });
        return withQueuedOwnership(lock, async () => {
          await git(
            repo,
            input,
            "fetch",
            "--no-tags",
            "origin",
            "+refs/heads/dev:refs/remotes/origin/dev",
          );
          const startCommit = await git(
            repo,
            input,
            "rev-parse",
            "refs/remotes/origin/dev",
          );
          const local = await git(repo, input, "rev-parse", "refs/heads/dev");
          if (local !== startCommit) {
            await git(
              repo,
              input,
              "merge-base",
              "--is-ancestor",
              local,
              startCommit,
            );
            await git(
              repo,
              input,
              "update-ref",
              "refs/heads/dev",
              startCommit,
              local,
            );
          }
          const prepared: PreparedTaskRun = {
            projectId: input.projectId,
            input: {
              runId: input.runId,
              project: repo,
              startCommit,
              contract: payload.data!.contract,
              configuration,
            },
            worktree: {
              id: input.runId,
              taskId: input.task.id,
              path: join(root, "worktrees", projectId(repo), input.runId),
              branch: `feature/claith-${input.runId}`,
              baseCommit: startCommit,
              status: "assigned",
            },
          };
          await writeJson(snapshot, {
            request: input,
            prepared,
            allocation: "reserved",
          } satisfies DispatchSnapshot);
          return prepared;
        });
      }),
    collectTaskRun: (input) =>
      guarded(input.prepared.projectId, async (dir) => {
        const path = dispatchPath(dir, input.prepared.input.runId);
        const snapshot = await readJson<DispatchSnapshot>(path);
        if (
          !snapshot ||
          JSON.stringify(snapshot.prepared) !== JSON.stringify(input.prepared)
        )
          invalid("Unknown task dispatch allocation");
        const outcome = await collectTaskRun(root, input);
        snapshot!.allocation = outcome.retainedWorktree
          ? "retained"
          : "releasable";
        await writeJson(path, snapshot);
        return outcome;
      }),
    createWorktree: assign,
    assignWorktree: assign,
    releaseWorktree: (input) =>
      guarded(input.projectId, async (dir) => {
        const worktrees = await pool(dir);
        const lease = worktrees.find((w) => w.id === input.worktreeId);
        if (!lease) return;
        if (lease.taskId !== input.taskId)
          invalid("Cannot release another task's worktree");
        const repo = join(dir, "repo");
        const registered = (
          await git(repo, {}, "worktree", "list", "--porcelain")
        )
          .split("\n")
          .includes(`worktree ${lease.path}`);
        if (registered)
          await git(repo, {}, "worktree", "remove", "--force", lease.path);
        // Preserve task branches as recovery evidence; never delete a possibly unintegrated commit.
        await writeJson(
          poolPath(dir),
          worktrees.filter((w) => w.id !== lease.id),
        );
      }),
    syncWorktree: (input) =>
      guarded(input.projectId, async (dir) => {
        const lease = await find(dir, input.worktreeId);
        if (!lease) invalid("Unknown worktree");
        const owned = lease!;
        const settings = await readJson<ProjectRepository>(
          join(dir, "repository.json"),
        );
        if (!settings) invalid("Missing repository configuration");
        await git(
          owned.path,
          settings!,
          "check-ref-format",
          `refs/heads/${input.branch}`,
        );
        await git(
          owned.path,
          settings!,
          "fetch",
          "--no-tags",
          "origin",
          `+refs/heads/${input.branch}:refs/remotes/origin/${input.branch}`,
        );
        await git(
          owned.path,
          settings!,
          "reset",
          "--hard",
          `refs/remotes/origin/${input.branch}`,
        );
        const baseCommit = await git(
          owned.path,
          settings!,
          "rev-parse",
          "HEAD",
        );
        await writeJson(
          poolPath(dir),
          (await pool(dir)).map((w) =>
            w.id === owned.id ? { ...w, baseCommit } : w,
          ),
        );
      }),
    planTasks: async (input) => {
      if (!input.contractRef)
        throw ApplicationFailure.nonRetryable(
          "contractRef must identify a JSON contract task plan",
          "Contract",
        );
      try {
        const plan = z
          .object({ contractId: id, tasks: z.array(taskSchema) })
          .parse(JSON.parse(await readFile(input.contractRef, "utf8")));
        if (
          plan.contractId !== input.contractId ||
          plan.tasks.some(
            (t) => t.contractId && t.contractId !== input.contractId,
          )
        )
          throw new Error("Contract identity mismatch");
        return plan.tasks.map((t) => ({
          id: t.id,
          dependsOn: t.dependsOn,
          payload: t.payload,
          ...(t.priority !== undefined ? { priority: t.priority } : {}),
          contractId: input.contractId,
          createdAt: t.createdAt ?? new Date().toISOString(),
        }));
      } catch (error) {
        throw ApplicationFailure.nonRetryable(
          `Cannot load contract plan: ${String(error)}`,
          "Contract",
        );
      }
    },
    storeEvidence: async (input) => {
      const evidence: Evidence[] = z
        .array(evidenceSchema)
        .parse(input.evidence)
        .map(({ contractId, refs, ...item }) => ({
          ...item,
          ...(contractId !== undefined ? { contractId } : {}),
          ...(refs !== undefined ? { refs } : {}),
        }));
      await database((db) => {
        db.exec("BEGIN IMMEDIATE");
        try {
          const insert = db.prepare(
            "INSERT INTO evidence(project_id,id,task_id,contract_id,body) VALUES(?,?,?,?,?) ON CONFLICT(project_id,id) DO NOTHING",
          );
          const existing = db.prepare(
            "SELECT body FROM evidence WHERE project_id=? AND id=?",
          );
          for (const item of evidence) {
            const body = JSON.stringify(item);
            const prior = existing.get(input.projectId, item.id);
            if (prior && prior.body !== body)
              invalid("Evidence identity reused with different content");
            insert.run(
              input.projectId,
              item.id,
              item.taskId,
              item.contractId ?? null,
              body,
            );
          }
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      });
      return evidence.map((item) => {
        const ref = {
          ...item,
          storageRef: `sqlite:${namespaceKey}:${hash(input.projectId)}:${item.id}`,
        };
        delete ref.data;
        return ref;
      });
    },
    queryEvidence: async (input) => {
      const query = z
        .object({
          taskId: id.optional(),
          contractId: id.optional(),
          offset: z.number().int().nonnegative().default(0),
          limit: z.number().int().min(1).max(1000).default(100),
        })
        .parse(input.query);
      return database((db): EvidencePage => {
        const where =
          "project_id=? AND (? IS NULL OR task_id=?) AND (? IS NULL OR contract_id=?)";
        const args = [
          input.projectId,
          query.taskId ?? null,
          query.taskId ?? null,
          query.contractId ?? null,
          query.contractId ?? null,
        ];
        // A read transaction keeps count and page consistent with concurrent writers.
        db.exec("BEGIN");
        const total = Number(
          db
            .prepare(`SELECT count(*) AS total FROM evidence WHERE ${where}`)
            .get(...args)!.total,
        );
        const rows = db
          .prepare(
            `SELECT body FROM evidence WHERE ${where} ORDER BY rowid LIMIT ? OFFSET ?`,
          )
          .all(...args, query.limit, query.offset);
        db.exec("COMMIT");
        return {
          evidence: rows.map((row) => JSON.parse(String(row.body)) as Evidence),
          total,
          hasMore: query.offset + rows.length < total,
        };
      });
    },
  };
}
