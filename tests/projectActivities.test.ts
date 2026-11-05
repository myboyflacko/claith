import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  access,
  readdir,
  readFile,
  unlink,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir, hostname } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createProjectActivities } from "../src/activities/projectActivities.js";
import { collectTaskRun } from "../src/activities/taskRunActivities.js";
import { git } from "../src/workspace/git.js";
import type { AssignWorktreeInput, Evidence } from "../src/workflows/types.js";
import {
  createConfig,
  DEFAULT_PROJECT_CONFIG,
} from "../src/workflows/config.js";
import { projectWorkflowId } from "../src/runtime/projectClient.js";
import { taskInput, completedTaskRun } from "./fixtures/task.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "claith project act-'"));
  roots.push(root);
  const source = join(root, "source");
  await git(root, "init", "--initial-branch=dev", source);
  await git(
    source,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "initial",
  );
  const input: AssignWorktreeInput = {
    projectId: "project-fixture",
    gitUrl: source,
    defaultBranch: "dev",
    taskId: "one",
    leaseId: "lease-one",
    maxWorktrees: 2,
  };
  return { root, source, input, act: createProjectActivities(root) };
}
describe("project activities", { timeout: 30000 }, () => {
  it("creates idempotent isolated worktrees, enforces pool capacity and releases only owned leases", async () => {
    const { act, root, source, input } = await fixture();
    const [one, two] = await Promise.all([
      act.assignWorktree(input),
      act.createWorktree({ ...input, taskId: "two", leaseId: "lease-two" }),
    ]);
    expect(one.path.startsWith(join(root, "projects"))).toBe(true);
    expect(await git(one.path, "rev-parse", "HEAD")).toBe(
      await git(source, "rev-parse", "HEAD"),
    );
    await writeFile(join(one.path, "untouched.txt"), "survives a retry");
    expect(await act.assignWorktree(input)).toEqual(one);
    await access(join(one.path, "untouched.txt"));
    await expect(
      act.assignWorktree({ ...input, taskId: "third", leaseId: "lease-three" }),
    ).rejects.toThrow("pool exhausted");
    await expect(
      act.releaseWorktree({
        projectId: input.projectId,
        taskId: "wrong",
        worktreeId: one.id,
      }),
    ).rejects.toThrow("another task");
    await act.releaseWorktree({
      projectId: input.projectId,
      taskId: input.taskId,
      worktreeId: one.id,
    });
    await act.releaseWorktree({
      projectId: input.projectId,
      taskId: input.taskId,
      worktreeId: one.id,
    });
    await expect(access(one.path)).rejects.toThrow();
    await access(two.path);
    const three = await act.assignWorktree({
      ...input,
      taskId: "third",
      leaseId: "lease-three",
    });
    await access(three.path);
    await expect(
      act.assignWorktree({ ...input, leaseId: "../escape" }),
    ).rejects.toThrow("Invalid worktree");
  });
  it("syncs only managed worktrees to a fetched branch", async () => {
    const { act, input, source } = await fixture();
    const worktree = await act.assignWorktree(input);
    await writeFile(join(source, "changed.txt"), "new remote state");
    await git(source, "add", "--all");
    await git(
      source,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "change",
    );
    await act.syncWorktree({
      projectId: input.projectId,
      worktreeId: worktree.id,
      branch: "dev",
    });
    expect(await git(worktree.path, "rev-parse", "HEAD")).toBe(
      await git(source, "rev-parse", "HEAD"),
    );
    await expect(
      act.syncWorktree({
        projectId: input.projectId,
        worktreeId: "missing",
        branch: "dev",
      }),
    ).rejects.toThrow("Unknown worktree");
  });
  it("stores evidence transactionally, isolates projects and supports paging and immutable identities", async () => {
    const { act, root } = await fixture();
    const evidence: Evidence = {
      id: "e1",
      taskId: "one",
      contractId: "contract",
      type: "check",
      timestamp: "2026-01-01T00:00:00.000Z",
      data: { output: "large" },
    };
    const refs = await act.storeEvidence({
      projectId: "p1",
      evidence: [evidence],
    });
    expect(refs[0]).not.toHaveProperty("data");
    await act.storeEvidence({ projectId: "p1", evidence: [evidence] });
    await act.storeEvidence({
      projectId: "p1",
      evidence: [{ ...evidence, id: "e2", taskId: "two" }],
    });
    await act.storeEvidence({ projectId: "p2", evidence: [evidence] });
    const restarted = createProjectActivities(root);
    const page = await restarted.queryEvidence({
      projectId: "p1",
      query: { limit: 1 },
    });
    expect(page).toEqual({ evidence: [evidence], total: 2, hasMore: true });
    expect(
      (await act.queryEvidence({ projectId: "p1", query: { taskId: "two" } }))
        .total,
    ).toBe(1);
    expect(
      (await act.queryEvidence({ projectId: "p2", query: {} })).total,
    ).toBe(1);
    await expect(
      act.storeEvidence({
        projectId: "p1",
        evidence: [
          { ...evidence, id: "new" },
          { ...evidence, data: "changed" },
        ],
      }),
    ).rejects.toThrow("identity reused");
    expect(
      (await act.queryEvidence({ projectId: "p1", query: {} })).total,
    ).toBe(2);
  });
  it("isolates repository leases and evidence across Temporal namespaces", async () => {
    const { root, input } = await fixture();
    const a = createProjectActivities(root, { namespace: "alpha" });
    const b = createProjectActivities(root, { namespace: "beta" });
    const one = await a.assignWorktree({ ...input, maxWorktrees: 1 });
    const two = await b.assignWorktree({ ...input, maxWorktrees: 1 });
    expect(one.path).not.toBe(two.path);
    const evidence: Evidence = {
      id: "e",
      taskId: "one",
      type: "check",
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    await a.storeEvidence({ projectId: input.projectId, evidence: [evidence] });
    expect(
      (await b.queryEvidence({ projectId: input.projectId, query: {} })).total,
    ).toBe(0);
    await a.releaseWorktree({
      projectId: input.projectId,
      taskId: "one",
      worktreeId: one.id,
    });
    await access(two.path);
  });
  it("records Git process groups and refuses recovery while a previous group is alive", async () => {
    const { act, input } = await fixture();
    const worktree = await act.assignWorktree(input);
    const lock = join(dirname(dirname(worktree.path)), "lock");
    const records = (await readdir(lock)).filter((name) =>
      name.endsWith(".process.json"),
    );
    expect(records.length).toBeGreaterThan(0);
    for (const name of records)
      expect(
        JSON.parse(await readFile(join(lock, name), "utf8")),
      ).toMatchObject({ host: hostname(), stopped: true });
    const stat = await readFile("/proc/self/stat", "utf8");
    const group = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]);
    const orphan = join(lock, "interrupted.process.json");
    await writeFile(orphan, JSON.stringify({ host: hostname(), group }));
    await expect(act.assignWorktree(input)).rejects.toThrow("live writer");
    await unlink(orphan);
    expect(await act.assignWorktree(input)).toEqual(worktree);
  });
  it("snapshots real Taskflow inputs against current dev without creating a second worktree", async () => {
    const { act, input, source } = await fixture();
    const execution = taskInput();
    const task = {
      id: execution.contract.taskId,
      dependsOn: [],
      payload: {
        contract: execution.contract,
        configuration: execution.configuration,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const request = { ...input, task, runId: "dispatch-one" };
    const first = await act.prepareTaskRun(request);
    expect(first.input.contract).toEqual(execution.contract);
    expect(first.input.configuration).toEqual(execution.configuration);
    expect(first.input.startCommit).toBe(
      await git(source, "rev-parse", "HEAD"),
    );
    expect(
      await git(first.input.project, "rev-parse", "--is-bare-repository"),
    ).toBe("true");
    await expect(access(first.worktree.path)).rejects.toThrow();
    await git(
      source,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "next",
    );
    expect(await act.prepareTaskRun(request)).toEqual(first);
    const next = await act.prepareTaskRun({
      ...request,
      runId: "dispatch-two",
    });
    expect(next.input.startCommit).toBe(await git(source, "rev-parse", "HEAD"));
    expect(next.input.startCommit).not.toBe(first.input.startCommit);
    await expect(
      act.prepareTaskRun({ ...request, task: { ...task, priority: 2 } }),
    ).rejects.toThrow("another task dispatch");
    await expect(
      act.prepareTaskRun({
        ...request,
        runId: "bad",
        task: { ...task, id: "different" },
      }),
    ).rejects.toThrow("matching task contract");
    await expect(
      act.prepareTaskRun({ ...request, runId: "main", defaultBranch: "main" }),
    ).rejects.toThrow("dev only");
  });
  it("reconciles durable candidate allocations across fresh adapters and releases only unstarted dispatches", async () => {
    const { root, act, input } = await fixture();
    const task = {
      id: taskInput().contract.taskId,
      dependsOn: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      payload: {
        contract: taskInput().contract,
        configuration: taskInput().configuration,
      },
    };
    const request = { ...input, maxWorktrees: 1, task, runId: "durable-one" };
    const prepared = await act.prepareTaskRun(request);
    await mkdir(prepared.worktree.path, { recursive: true });
    await writeFile(join(prepared.worktree.path, "preserved"), "candidate");
    const cancelled = completedTaskRun(prepared.input);
    cancelled.execution.workspace!.path = prepared.worktree.path;
    cancelled.execution.status = "cancelled";
    cancelled.execution.cleaned = false;
    expect(
      (
        await act.collectTaskRun({
          prepared,
          timestamp: task.createdAt,
          record: cancelled,
        })
      ).retainedWorktree?.id,
    ).toBe(prepared.worktree.id);
    const restarted = createProjectActivities(root);
    expect(await restarted.reconcileTaskRuns(input)).toMatchObject([
      { id: "durable-one", status: "error" },
    ]);
    await expect(
      restarted.prepareTaskRun({ ...request, runId: "durable-two" }),
    ).rejects.toThrow("capacity is exhausted");
    await expect(
      restarted.abandonTaskRun({
        projectId: input.projectId,
        runId: "durable-one",
      }),
    ).rejects.toThrow("finalized task dispatch");
    await access(join(prepared.worktree.path, "preserved"));
    await rm(prepared.worktree.path, { recursive: true });
    cancelled.execution.cleaned = true;
    const terminal = await restarted.collectTaskRun({
      prepared,
      timestamp: task.createdAt,
      record: cancelled,
    });
    await restarted.storeEvidence({
      projectId: input.projectId,
      evidence: terminal.evidence,
    });
    await restarted.releaseTaskRunAllocation({
      projectId: input.projectId,
      runId: "durable-one",
    });
    const unstarted = await restarted.prepareTaskRun({
      ...request,
      runId: "durable-two",
    });
    expect(
      await createProjectActivities(root).reconcileTaskRuns(input),
    ).toMatchObject([{ id: unstarted.worktree.id }]);
    await restarted.abandonTaskRun({
      projectId: input.projectId,
      runId: unstarted.input.runId,
    });
    expect(await restarted.reconcileTaskRuns(input)).toEqual([]);
    await expect(
      restarted.prepareTaskRun({ ...request, runId: "durable-two" }),
    ).rejects.toThrow("already been released");
    const uncertain = await restarted.prepareTaskRun({
      ...request,
      runId: "durable-uncertain",
    });
    expect(
      (
        await restarted.collectTaskRun({
          prepared: uncertain,
          timestamp: task.createdAt,
          error: "Workflow timed out",
        })
      ).retainedWorktree,
    ).not.toBeNull();
    expect(
      await createProjectActivities(root).reconcileTaskRuns(input),
    ).toMatchObject([{ id: uncertain.input.runId }]);
    await expect(
      restarted.releaseTaskRunAllocation({
        projectId: input.projectId,
        runId: uncertain.input.runId,
      }),
    ).rejects.toThrow("Only finalized");
  });
  it("projects only verified delivery and preserves failed or uncertain task workspaces", async () => {
    const { root } = await fixture();
    const act = {
      collectTaskRun: (input: Parameters<typeof collectTaskRun>[1]) =>
        collectTaskRun(root, input),
    };
    const input = taskInput();
    const path = join(root, "owned-candidate");
    const prepared = {
      projectId: "project",
      input,
      worktree: {
        id: input.runId,
        taskId: input.contract.taskId,
        path,
        branch: `feature/claith-${input.runId}`,
        baseCommit: input.startCommit,
        status: "assigned" as const,
      },
    };
    const record = completedTaskRun(input);
    record.execution.workspace!.path = path;
    const request = { prepared, timestamp: "2026-01-01T00:00:00.000Z", record };
    const success = await act.collectTaskRun(request);
    expect(success.success).toBe(true);
    expect(success.retainedWorktree).toBeNull();
    expect(success.evidence.some((e) => e.type === "review")).toBe(true);
    expect(success.evidence.filter((e) => e.type === "check")).toHaveLength(2);
    const timedOutPreparation = structuredClone(record);
    timedOutPreparation.execution.status = "cancelled";
    timedOutPreparation.execution.workspace = null;
    timedOutPreparation.execution.cleaned = false;
    expect(
      (await act.collectTaskRun({ ...request, record: timedOutPreparation }))
        .retainedWorktree,
    ).toMatchObject({ id: input.runId, status: "error" });
    record.execution.pushed = false;
    expect((await act.collectTaskRun(request)).error).toContain(
      "verified delivery",
    );
    record.execution.pushed = true;
    record.execution.attempts[0]!.review!.submission.revision = "c".repeat(40);
    expect((await act.collectTaskRun(request)).success).toBe(false);
    await mkdir(path);
    await writeFile(join(path, "preserved"), "failed work");
    const failed = await act.collectTaskRun({
      prepared,
      timestamp: request.timestamp,
      error: "Task timed out",
    });
    expect(failed).toMatchObject({
      success: false,
      error: "Task timed out",
      retainedWorktree: { path, status: "error" },
    });
    await access(join(path, "preserved"));
    record.execution.attempts[0]!.review!.submission.revision = "b".repeat(40);
    expect((await act.collectTaskRun(request)).error).toContain(
      "worktrees remain",
    );
  });
  it("loads validated contract plans and reports nonretryable contract failures", async () => {
    const { act, root, input } = await fixture();
    const contractRef = join(root, "contract.json");
    await writeFile(
      contractRef,
      JSON.stringify({
        contractId: "c1",
        tasks: [{ id: "t1", dependsOn: [], payload: { work: "specified" } }],
      }),
    );
    const planned = await act.planTasks({
      ...input,
      contractId: "c1",
      contractRef,
    });
    expect(planned).toMatchObject([
      {
        id: "t1",
        contractId: "c1",
        dependsOn: [],
        payload: { work: "specified" },
      },
    ]);
    await expect(
      act.planTasks({ ...input, contractId: "different", contractRef }),
    ).rejects.toMatchObject({ type: "Contract", nonRetryable: true });
    await expect(
      act.planTasks({ ...input, contractId: "c1" }),
    ).rejects.toMatchObject({ type: "Contract", nonRetryable: true });
  });
  it("validates configuration and uses real stable repository hashes", () => {
    expect(createConfig().maxParallel).toBe(1);
    expect(createConfig().maxWorktrees).toBe(3);
    expect(createConfig({ maxParallel: 6 }).maxWorktrees).toBe(8);
    for (const maxParallel of [0, -1, 0.5, Infinity, NaN])
      expect(() => createConfig({ maxParallel })).toThrow(
        "Invalid project configuration",
      );
    expect(() => createConfig({ maxParallel: 3, maxWorktrees: 2 })).toThrow();
    expect(
      createConfig({ maxParallel: 4, maxWorktrees: 6 }, createConfig())
        .maxParallel,
    ).toBe(4);
    const config = createConfig();
    config.taskRetryPolicy.maximumAttempts = 8;
    expect(DEFAULT_PROJECT_CONFIG.taskRetryPolicy.maximumAttempts).toBe(1);
    expect(projectWorkflowId("ssh://repo")).toMatch(/^project-[a-f0-9]{64}$/);
    expect(projectWorkflowId("ssh://repo")).toBe(
      projectWorkflowId("ssh://repo"),
    );
    expect(projectWorkflowId("ssh://repo")).not.toBe(
      projectWorkflowId("ssh://other"),
    );
  });
});
