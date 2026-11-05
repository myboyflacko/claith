import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ApplicationFailure, Context } from "@temporalio/activity";
import { Client } from "@temporalio/client";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker, bundleWorkflowCode } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProjectActivities } from "../../src/activities/projectActivities.js";
import { collectTaskRun } from "../../src/activities/taskRunActivities.js";
import { createActivities } from "../../src/runtime/activities.js";
import { ProjectClient } from "../../src/runtime/projectClient.js";
import { git } from "../../src/workspace/git.js";
import { fixtureFactory } from "../fixtures/agent.js";
import {
  taskInput,
  completedTaskRun,
  projectFixture,
} from "../fixtures/task.js";
import type { RunInput, RunRecord } from "../../src/domain/contracts.js";
import type {
  PreparedTaskRun,
  ProjectActivities,
  ProjectConfig,
  ProjectSnapshot,
  Task,
} from "../../src/workflows/types.js";

const task = (id: string, dependsOn: string[] = [], priority = 0): Task => ({
  id,
  dependsOn,
  priority,
  payload: {
    contract: { ...taskInput().contract, taskId: id },
    configuration: taskInput().configuration,
  },
  createdAt: "2026-01-01T00:00:00.000Z",
});
async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 15000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out: ${JSON.stringify(await read())}`);
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("repository project workflow", () => {
  let env: TestWorkflowEnvironment;
  let bundle: Awaited<ReturnType<typeof bundleWorkflowCode>>;
  let realBundle: Awaited<ReturnType<typeof bundleWorkflowCode>>;
  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
    bundle = await bundleWorkflowCode({
      workflowsPath: fileURLToPath(
        new URL("../fixtures/project-task.ts", import.meta.url),
      ),
    });
    realBundle = await bundleWorkflowCode({
      workflowsPath: fileURLToPath(
        new URL("../../src/workflows/index.ts", import.meta.url),
      ),
    });
  }, 60000);
  afterAll(async () => {
    await env?.teardown();
  });
  async function scenario(
    options: {
      config?: Partial<ProjectConfig>;
      plan?: Task[] | ((contractId: string) => Task[]);
      noCache?: boolean;
      storeGate?: ReturnType<typeof gate>;
      prepareGate?: ReturnType<typeof gate>;
      planGate?: ReturnType<typeof gate>;
      run?: (input: RunInput) => Promise<RunRecord>;
      retainOnFailure?: boolean;
    } = {},
  ) {
    const root = await mkdtemp(join(tmpdir(), "claith-project-wf-"));
    const taskQueue = randomUUID();
    const prepared: string[] = [],
      collected: string[] = [],
      planned: string[] = [],
      settled: string[] = [];
    const released: string[] = [],
      started: string[] = [],
      cancelled: string[] = [],
      storing: string[] = [];
    const gates = new Map<string, ReturnType<typeof gate>>();
    const realActivities = createProjectActivities(root);
    const projectActivities: ProjectActivities = {
      ...realActivities,
      storeEvidence: async (input) => {
        storing.push(...input.evidence.map((e) => e.taskId));
        await options.storeGate?.promise;
        return realActivities.storeEvidence(input);
      },
      prepareTaskRun: async (input) => {
        prepared.push(input.task.id);
        await options.prepareGate?.promise;
        const run = taskInput("/managed-project");
        run.runId = input.runId;
        run.contract.taskId = input.task.id;
        return {
          projectId: input.projectId,
          input: run,
          worktree: {
            id: input.runId,
            taskId: input.task.id,
            path: `/managed/${input.runId}`,
            branch: `feature/claith-${input.runId}`,
            baseCommit: run.startCommit,
            status: "assigned",
          },
        };
      },
      collectTaskRun: async (input) => {
        collected.push(input.prepared.input.contract.taskId);
        const outcome = await collectTaskRun(root, input);
        return options.retainOnFailure && !outcome.success
          ? {
              ...outcome,
              retainedWorktree: {
                ...input.prepared.worktree,
                status: "error",
              } as const,
            }
          : outcome;
      },
      releaseTaskRunAllocation: async (input) => {
        settled.push(input.runId);
      },
      assignWorktree: async () => {
        throw new Error("Project must delegate workspace creation to Taskflow");
      },
      releaseWorktree: async (input) => {
        released.push(input.taskId);
        throw new Error("Project must not delete Taskflow-owned workspaces");
      },
      planTasks: async (input) => {
        planned.push(input.contractId);
        await options.planGate?.promise;
        return typeof options.plan === "function"
          ? options.plan(input.contractId)
          : (options.plan ?? []);
      },
    };
    const workerActivities = {
      ...projectActivities,
      runProjectTask: async (input: RunInput) => {
        started.push(input.contract.taskId);
        const context = Context.current();
        context.cancellationSignal.addEventListener(
          "abort",
          () => cancelled.push(input.contract.taskId),
          { once: true },
        );
        const timer = setInterval(() => context.heartbeat(), 20);
        try {
          if (options.run) return await options.run(input);
          const hold = gate();
          gates.set(input.contract.taskId, hold);
          await Promise.race([hold.promise, context.cancelled]);
          return completedTaskRun(input);
        } finally {
          clearInterval(timer);
        }
      },
    };
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowBundle: bundle,
      ...(options.noCache ? {} : { activities: workerActivities }),
      maxHeartbeatThrottleInterval: "20ms",
      maxCachedWorkflows: options.noCache ? 0 : 1000,
    });
    const rawClient = new Client({ connection: env.client.connection });
    const client = new ProjectClient(rawClient, taskQueue);
    const input = {
      gitUrl: `fixture:${taskQueue}`,
      ...(options.config ? { config: options.config } : {}),
    };
    const projectId = await client.start(input);
    const handle = rawClient.workflow.getHandle(projectId);
    const status = () => handle.query<ProjectSnapshot>("get-full-state");
    async function run(body: () => Promise<void>) {
      try {
        await worker.runUntil(async () => {
          try {
            await body();
          } finally {
            options.storeGate?.resolve();
            options.prepareGate?.resolve();
            options.planGate?.resolve();
            if ((await handle.describe()).status.name === "RUNNING")
              await handle.signal("shutdown", { force: true });
            await handle.result();
          }
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
    return {
      worker,
      workerActivities,
      handle,
      status,
      run,
      prepared,
      collected,
      released,
      planned,
      started,
      cancelled,
      storing,
      settled,
      gates,
      client,
      projectId,
      input,
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  }
  it("defaults to one Taskflow and starts the next independent task only after completion", async () => {
    const s = await scenario();
    await s.run(async () => {
      await s.handle.signal("add-batch", { tasks: [task("one"), task("two")] });
      await waitFor(s.status, () => s.started.length === 1);
      expect((await s.status()).config.maxParallel).toBe(1);
      expect(s.prepared).toEqual(["one"]);
      expect((await s.status()).backlog.map((t) => t.id)).toEqual(["two"]);
      s.gates.get("one")!.resolve();
      await waitFor(s.status, () => s.started.length === 2);
      expect((await s.status()).completed).toContain("one");
      s.gates.get("two")!.resolve();
      await waitFor(
        s.status,
        (r) => r.completed.length === 2 && r.git.worktrees.length === 0,
      );
      expect(s.released).toEqual([]);
    });
  }, 60000);
  it("starts configured parallel Taskflows in one workflow task, enforces dependencies and replays history", async () => {
    const s = await scenario({
      config: { maxParallel: 2, evidenceRetention: 2 },
    });
    await s.run(async () => {
      await s.handle.signal("add-batch", {
        tasks: [
          task("dependent", ["high"]),
          task("low", [], 1),
          task("high", [], 10),
        ],
      });
      await waitFor(
        s.status,
        (r) =>
          Object.keys(r.runningChildren).length === 2 && s.started.length === 2,
      );
      expect(new Set(s.prepared)).toEqual(new Set(["high", "low"]));
      expect(s.started).not.toContain("dependent");
      expect(await s.handle.query("get-backlog")).toMatchObject([
        { id: "dependent" },
      ]);
      expect(
        Object.keys(
          await s.handle.query<Record<string, unknown>>("get-running"),
        ),
      ).toHaveLength(2);
      s.gates.get("high")!.resolve();
      await waitFor(
        s.status,
        (r) => r.completed.includes("high") && s.started.includes("dependent"),
      );
      s.gates.get("low")!.resolve();
      s.gates.get("dependent")!.resolve();
      await waitFor(
        s.status,
        (r) => r.completed.length === 3 && r.git.worktrees.length === 0,
      );
      expect(s.collected).toHaveLength(3);
      expect(s.released).toEqual([]);
      expect(await s.handle.query("get-completed")).toHaveLength(3);
      expect(await s.handle.query("get-failed")).toEqual({});
      expect(await s.handle.query("get-worktrees")).toEqual([]);
      expect(await s.handle.query("get-health")).toMatchObject({
        backlogSize: 0,
        runningCount: 0,
        errorRate: 0,
      });
      expect((await s.status()).evidence).toHaveLength(2);
      expect((await s.status()).evidence[0]).not.toHaveProperty("data");
      expect(await s.handle.query("get-evidence")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            storageRef: expect.stringContaining("sqlite:"),
          }),
        ]),
      );
      const history = await s.client.evidence(s.projectId, { limit: 2 });
      expect(history.total).toBe(15);
      expect(history.hasMore).toBe(true);
      expect(history.evidence[1]?.type).toBe("check");
      const workflowHistory = await s.handle.fetchHistory();
      const starts =
        workflowHistory.events?.flatMap((e) =>
          e.startChildWorkflowExecutionInitiatedEventAttributes
            ? [e.startChildWorkflowExecutionInitiatedEventAttributes]
            : [],
        ) ?? [];
      expect(starts).toHaveLength(3);
      expect(starts[0]?.workflowType?.name).toBe("taskWorkflow");
      expect(starts[1]?.workflowType?.name).toBe("taskWorkflow");
      expect(starts[0]?.workflowTaskCompletedEventId?.toString()).toBe(
        starts[1]?.workflowTaskCompletedEventId?.toString(),
      );
      expect(starts[0]?.taskQueue?.name).toBe(s.client.taskQueue);
      expect(starts[0]?.retryPolicy?.maximumAttempts).toBe(1);
      expect(starts[0]?.workflowRunTimeout?.seconds?.toString()).toBe("3600");
      await Worker.runReplayHistory(
        { workflowBundle: bundle },
        workflowHistory,
      );
    });
  }, 60000);
  it("hot-reloads maxParallel upwards and never interrupts active tasks when reducing it", async () => {
    const s = await scenario();
    await s.run(async () => {
      await s.handle.signal("add-batch", {
        tasks: [task("one"), task("two"), task("three")],
      });
      await waitFor(s.status, () => s.started.length === 1);
      await s.handle.signal("update-config", { config: { maxParallel: 2 } });
      await waitFor(s.status, () => s.started.length === 2);
      await s.handle.signal("update-config", { config: { maxParallel: 1 } });
      await waitFor(s.status, (r) => r.config.maxParallel === 1);
      expect(Object.keys((await s.status()).runningChildren)).toHaveLength(2);
      s.gates.get("one")!.resolve();
      await waitFor(s.status, (r) => r.completed.includes("one"));
      expect(s.started).toEqual(["one", "two"]);
      s.gates.get("two")!.resolve();
      await waitFor(s.status, () => s.started.includes("three"));
      s.gates.get("three")!.resolve();
      await waitFor(s.status, (r) => r.completed.length === 3);
    });
  }, 60000);
  it("queues paused commands and reorders the backlog while reconciling active children", async () => {
    const s = await scenario();
    await s.run(async () => {
      await s.handle.signal("pause", { reason: "maintenance" });
      await waitFor(s.status, (r) => r.status === "PAUSED");
      await s.handle.signal("add-batch", { tasks: [task("one"), task("two")] });
      await s.handle.signal("reorder", { taskIds: ["two", "one"] });
      expect((await s.status()).backlog).toEqual([]);
      await s.handle.signal("resume", {});
      await waitFor(s.status, () => s.started.length === 1);
      expect(s.started).toEqual(["two"]);
      await s.handle.signal("pause", {});
      s.gates.get("two")!.resolve();
      await waitFor(s.status, (r) => r.completed.includes("two"));
      expect(s.started).toEqual(["two"]);
      expect(await s.handle.query("get-backlog")).toMatchObject([
        { id: "one" },
      ]);
      await s.handle.signal("resume", {});
      await waitFor(s.status, () => s.started.includes("one"));
      s.gates.get("one")!.resolve();
      await waitFor(s.status, (r) => r.completed.length === 2);
    });
  }, 60000);
  it("rejects invalid batches atomically, ignores duplicates and waits on blocked dependencies", async () => {
    const s = await scenario();
    await s.run(async () => {
      await s.handle.signal("add-batch", {
        tasks: [task("discard"), task("invalid", ["missing"])],
      });
      await s.handle.signal("add-batch", {
        tasks: [task("cycle1", ["cycle2"]), task("cycle2", ["cycle1"])],
      });
      await s.handle.signal("add-batch", { tasks: [task("root")] });
      await waitFor(
        s.status,
        (r) => r.rejections.length === 2 && s.started.includes("root"),
      );
      await s.handle.signal("add-batch", {
        tasks: [task("root"), task("leaf", ["root"])],
      });
      await s.handle.signal("remove-task", { taskId: "root" });
      await waitFor(s.status, (r) => r.rejections.length === 3);
      expect(s.prepared).toEqual(["root"]);
      expect((await s.status()).backlog.map((t) => t.id)).toEqual(["leaf"]);
      await s.handle.signal("update-config", { config: { maxParallel: 0 } });
      await waitFor(s.status, (r) => r.rejections.length === 4);
      expect((await s.status()).config.maxParallel).toBe(1);
      s.gates.get("root")!.resolve();
      await waitFor(s.status, () => s.started.includes("leaf"));
      s.gates.get("leaf")!.resolve();
      await waitFor(s.status, (r) => r.completed.length === 2);
      await s.handle.signal("add-batch", { tasks: [task("root")] });
      expect((await s.status()).completed).toHaveLength(2);
      expect(s.prepared).toHaveLength(2);
    });
  }, 60000);
  it("aggregates contracts idempotently and only retries failed tasks on explicit submission", async () => {
    let attempts = 0;
    const s = await scenario({
      plan: [{ ...task("planned"), contractId: "contract" }],
      run: async (input) => {
        if (++attempts === 1)
          throw ApplicationFailure.nonRetryable("broken", "TestFailure");
        return completedTaskRun(input);
      },
    });
    await s.run(async () => {
      await s.handle.signal("new-contract", {
        contractId: "contract",
        contractRef: "fixture",
      });
      await s.handle.signal("new-contract", {
        contractId: "contract",
        contractRef: "fixture",
      });
      await waitFor(
        s.status,
        (r) => !!r.failed.planned && r.git.worktrees.length === 1,
      );
      expect(s.planned).toEqual(["contract"]);
      expect(attempts).toBe(1);
      expect((await s.status()).failed.planned).toContain("broken");
      expect(await s.handle.query("get-contracts")).toMatchObject([
        { status: "failed", tasks: ["planned"], evidence: [{ type: "error" }] },
      ]);
      expect(await s.handle.query("get-health")).toMatchObject({
        errorRate: 1,
      });
      await s.handle.signal("add-batch", {
        tasks: [{ ...task("planned"), contractId: "contract" }],
      });
      await waitFor(
        s.status,
        (r) => r.completed.includes("planned") && r.git.worktrees.length === 1,
      );
      expect(attempts).toBe(2);
      expect(await s.handle.query("get-contracts")).toMatchObject([
        { status: "completed" },
      ]);
      expect((await s.client.evidence(s.projectId)).total).toBe(6);
    });
  }, 60000);
  it.each([false, true])(
    "handles shutdown force=%s without deleting Taskflow workspaces",
    async (force) => {
      const s = await scenario();
      await s.run(async () => {
        await s.handle.signal("add-batch", { tasks: [task("active")] });
        await waitFor(s.status, () => s.started.length === 1);
        await s.handle.signal("shutdown", { force });
        if (!force) {
          expect((await s.status()).status).toBe("SHUTTING_DOWN");
          expect(s.collected).toEqual([]);
          s.gates.get("active")!.resolve();
        }
        await s.handle.result();
        expect(s.collected).toEqual(["active"]);
        expect(s.released).toEqual([]);
      });
    },
    60000,
  );
  it("does not start a child when paused during input preparation", async () => {
    const hold = gate();
    const s = await scenario({ prepareGate: hold });
    await s.run(async () => {
      await s.handle.signal("add-batch", { tasks: [task("late")] });
      await waitFor(s.status, () => s.prepared.length === 1);
      await s.handle.signal("pause", {});
      hold.resolve();
      await waitFor(
        s.status,
        (r) => r.status === "PAUSED" && r.backlog.length === 1,
      );
      expect(s.started).toEqual([]);
      expect(s.released).toEqual([]);
      expect(s.collected).toEqual([]);
      await s.handle.signal("resume", {});
      await waitFor(s.status, () => s.started.length === 1);
      s.gates.get("late")!.resolve();
      await waitFor(s.status, (r) => r.completed.length === 1);
    });
  }, 60000);
  it("shuts down after an in-flight plan without another signal", async () => {
    const hold = gate();
    const s = await scenario({
      planGate: hold,
      plan: [{ ...task("never"), contractId: "c" }],
    });
    await s.run(async () => {
      await s.handle.signal("new-contract", { contractId: "c" });
      await waitFor(s.status, () => s.planned.length === 1);
      await s.handle.signal("shutdown", {});
      hold.resolve();
      await s.handle.result();
      expect(s.started).toEqual([]);
    });
  }, 60000);
  it("carries completed dependencies, config and deferred commands across Continue-As-New", async () => {
    const s = await scenario({
      config: { historyEventLimit: 80 },
      run: async (input) => completedTaskRun(input),
    });
    await s.run(async () => {
      await s.handle.signal("add-batch", { tasks: [task("before")] });
      await waitFor(s.status, (r) => r.completed.includes("before"));
      const first = (await s.handle.describe()).runId;
      await s.handle.signal("pause", {});
      for (let i = 0; i < 90; i++)
        await s.handle.signal("update-config", { config: { maxParallel: 2 } });
      await waitFor(
        async () => (await s.handle.describe()).runId,
        (id) => id !== first,
      );
      expect((await s.status()).status).toBe("PAUSED");
      await s.handle.signal("add-batch", {
        tasks: [task("after", ["before"])],
      });
      await s.handle.signal("resume", {});
      await waitFor(s.status, (r) => r.completed.includes("after"));
      expect((await s.status()).completed).toContain("before");
      expect((await s.status()).config.maxParallel).toBe(2);
      expect(await s.client.start(s.input)).toBe(s.projectId);
    });
  }, 60000);
  it("records child timeouts without automatically requeueing tasks", async () => {
    const s = await scenario({ config: { taskTimeout: 200 } });
    await s.run(async () => {
      await s.handle.signal("add-batch", { tasks: [task("slow")] });
      await waitFor(
        s.status,
        (r) => !!r.failed.slow && r.git.worktrees.length === 1,
      );
      expect(s.prepared).toEqual(["slow"]);
      expect(s.collected).toEqual(["slow"]);
      expect(s.released).toEqual([]);
      expect((await s.status()).evidence).toMatchObject([{ type: "error" }]);
      s.gates.get("slow")?.resolve();
    });
  }, 60000);
  it("does not accept an unverified completion record", async () => {
    const s = await scenario({
      run: async (input) => {
        const record = completedTaskRun(input);
        record.execution.integration!.checks = [];
        return record;
      },
    });
    await s.run(async () => {
      await s.handle.signal("add-batch", { tasks: [task("malformed")] });
      await waitFor(
        s.status,
        (r) => !!r.failed.malformed && r.git.worktrees.length === 1,
      );
      expect((await s.status()).failed.malformed).toContain(
        "Task did not complete verified delivery",
      );
    });
  }, 60000);
  it("recovers active Taskflow children after replacing the project worker", async () => {
    const s = await scenario({ noCache: true });
    const activityWorker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: s.client.taskQueue,
      activities: s.workerActivities,
      maxHeartbeatThrottleInterval: "20ms",
    });
    const activityRun = activityWorker.run();
    const oldRun = s.worker.run();
    let replacement: Worker | undefined;
    try {
      await s.handle.signal("add-batch", { tasks: [task("recover")] });
      await waitFor(s.status, () => s.started.length === 1);
      const oldId = (await s.status()).runningChildren.recover!.workflowId;
      s.worker.shutdown();
      await oldRun;
      replacement = await Worker.create({
        connection: env.nativeConnection,
        taskQueue: s.client.taskQueue,
        workflowBundle: bundle,
      });
      await replacement.runUntil(async () => {
        expect((await s.status()).runningChildren.recover!.workflowId).toBe(
          oldId,
        );
        s.gates.get("recover")!.resolve();
        await waitFor(
          s.status,
          (r) =>
            r.completed.includes("recover") && r.git.worktrees.length === 0,
        );
        expect(s.prepared).toEqual(["recover"]);
        expect(s.collected).toEqual(["recover"]);
        expect(s.released).toEqual([]);
        await s.handle.signal("shutdown", {});
        await s.handle.result();
      });
    } finally {
      if (s.worker.getState() === "RUNNING") s.worker.shutdown();
      if (replacement?.getState() === "RUNNING") replacement.shutdown();
      await oldRun;
      activityWorker.shutdown();
      await activityRun;
      await s.cleanup();
    }
  }, 60000);
  it("cancels outstanding children while evidence persistence is blocked", async () => {
    const storeGate = gate();
    const s = await scenario({ storeGate, config: { maxParallel: 2 } });
    await s.run(async () => {
      await s.handle.signal("add-batch", {
        tasks: [task("done"), task("busy")],
      });
      await waitFor(s.status, () => s.started.length === 2);
      s.gates.get("done")!.resolve();
      await waitFor(s.status, () => s.storing.includes("done"));
      await s.handle.signal("shutdown", { force: true });
      await waitFor(s.status, () => s.cancelled.includes("busy"));
      expect(s.released).toEqual([]);
      expect(s.settled).toEqual([]);
      storeGate.resolve();
      await s.handle.result();
      expect(new Set(s.collected)).toEqual(new Set(["done", "busy"]));
      expect(s.released).toEqual([]);
      expect(s.settled).toHaveLength(1);
    });
  }, 60000);
  it("rejects cross-contract task collisions without completing the rejected contract", async () => {
    const s = await scenario({
      plan: (contractId) => [
        { ...task("shared"), contractId },
        ...(contractId === "b" ? [{ ...task("discarded"), contractId }] : []),
      ],
    });
    await s.run(async () => {
      await s.handle.signal("new-contract", { contractId: "a" });
      await waitFor(s.status, () => s.started.includes("shared"));
      await s.handle.signal("new-contract", { contractId: "b" });
      const state = await waitFor(s.status, (r) =>
        r.contracts.some((c) => c.contractId === "b" && c.status === "failed"),
      );
      expect(
        state.contracts.find((c) => c.contractId === "b")?.error,
      ).toContain("another contract");
      expect(s.prepared).toEqual(["shared"]);
      expect(state.backlog).toEqual([]);
      s.gates.get("shared")!.resolve();
      await waitFor(s.status, (r) => r.completed.includes("shared"));
      expect(
        (await s.status()).contracts.find((c) => c.contractId === "b")?.status,
      ).toBe("failed");
    });
  }, 60000);
  it("retains failed candidate slots and waits for explicit capacity instead of overfilling the pool", async () => {
    const s = await scenario({
      config: { maxWorktrees: 1 },
      retainOnFailure: true,
      run: async (input) => {
        const record = completedTaskRun(input);
        if (input.contract.taskId === "failed") {
          record.execution.status = "cancelled";
          record.execution.cleaned = false;
        }
        return record;
      },
    });
    await s.run(async () => {
      await s.handle.signal("add-batch", {
        tasks: [task("failed"), task("waiting")],
      });
      await waitFor(
        s.status,
        (r) =>
          !!r.failed.failed &&
          r.git.worktrees.some((w) => w.status === "error"),
      );
      expect(s.started).toEqual(["failed"]);
      expect((await s.status()).backlog.map((t) => t.id)).toEqual(["waiting"]);
      expect(await s.handle.query("get-health")).toMatchObject({
        runningCount: 0,
        backlogSize: 1,
      });
      await s.handle.signal("update-config", { config: { maxWorktrees: 2 } });
      await waitFor(
        s.status,
        (r) => r.completed.includes("waiting") && r.git.worktrees.length === 1,
      );
      expect((await s.status()).git.worktrees).toHaveLength(1);
      expect(s.released).toEqual([]);
    });
  }, 60000);
  it("reconciles children on external workflow cancellation", async () => {
    const s = await scenario();
    try {
      await s.worker.runUntil(async () => {
        await s.handle.signal("add-batch", { tasks: [task("cancelled")] });
        await waitFor(s.status, () => s.started.length === 1);
        await s.handle.cancel();
        await expect(s.handle.result()).rejects.toThrow();
        expect(s.collected).toEqual(["cancelled"]);
        expect(s.released).toEqual([]);
      });
    } finally {
      await s.cleanup();
    }
  }, 60000);
  it("runs real implementers concurrently when configured and preserves base_changed and retained capacity across project restarts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "claith-project-parallel-"));
    try {
      const f = await projectFixture(directory);
      const taskQueue = randomUUID();
      const sessions: string[] = [];
      const runs: PreparedTaskRun[] = [];
      const implementing: string[] = [];
      const holds = new Map([
        ["first", gate()],
        ["second", gate()],
      ]);
      const native = createActivities(f.root, fixtureFactory(sessions));
      const project = createProjectActivities(f.root);
      const activities = {
        ...native,
        ...project,
        prepareTaskRun: async (
          input: Parameters<ProjectActivities["prepareTaskRun"]>[0],
        ) => {
          const prepared = await project.prepareTaskRun(input);
          await git(prepared.input.project, "config", "user.name", "Test");
          await git(
            prepared.input.project,
            "config",
            "user.email",
            "test@example.invalid",
          );
          runs.push(prepared);
          return prepared;
        },
        implement: async (input: Parameters<typeof native.implement>[0]) => {
          implementing.push(input.contract.taskId);
          const context = Context.current();
          const timer = setInterval(() => context.heartbeat(), 20);
          try {
            await Promise.race([
              holds.get(input.contract.taskId)!.promise,
              context.cancelled,
            ]);
            return await native.implement(input);
          } finally {
            clearInterval(timer);
          }
        },
        assignWorktree: async () => {
          throw new Error("Unexpected duplicate workspace");
        },
        releaseWorktree: async () => {
          throw new Error("Unexpected project cleanup of a Taskflow workspace");
        },
      };
      const worker = await Worker.create({
        connection: env.nativeConnection,
        taskQueue,
        workflowBundle: realBundle,
        activities,
        maxConcurrentActivityTaskExecutions: 8,
        maxHeartbeatThrottleInterval: "20ms",
      });
      const client = new ProjectClient(
        new Client({ connection: env.client.connection }),
        taskQueue,
      );
      const projectId = await client.start({
        gitUrl: f.remote,
        config: { maxParallel: 2 },
      });
      const handle = client.client.workflow.getHandle(projectId);
      const status = () => handle.query<ProjectSnapshot>("get-full-state");
      await worker.runUntil(async () => {
        try {
          await handle.signal("add-batch", {
            tasks: [task("first"), task("second")],
          });
          await waitFor(status, () => implementing.length === 2, 90000);
          expect(new Set(implementing)).toEqual(new Set(["first", "second"]));
          expect(runs).toHaveLength(2);
          expect(runs[0]!.input.startCommit).toBe(runs[1]!.input.startCommit);
          expect(Object.keys((await status()).runningChildren)).toHaveLength(2);
          holds.get("first")!.resolve();
          await waitFor(status, (r) => r.completed.includes("first"), 90000);
          holds.get("second")!.resolve();
          const second = runs.find(
            (r) => r.input.contract.taskId === "second",
          )!;
          const child = client.client.workflow.getHandle(second.input.runId);
          await waitFor(
            () => child.query<RunRecord>("status"),
            (r) =>
              r.execution.status === "blocked" &&
              r.execution.blocked?.kind === "base_changed",
            90000,
          );
          expect((await status()).completed).toEqual(["first"]);
          expect((await status()).failed).toEqual({});
          await handle.signal("shutdown", { force: true });
          await handle.result();
          expect(
            (await child.query<RunRecord>("status")).execution.status,
          ).toBe("cancelled");
          expect(
            await git(second.worktree.path, "rev-parse", "--show-toplevel"),
          ).toBe(second.worktree.path);
          expect(
            await client.start({
              gitUrl: f.remote,
              config: { maxWorktrees: 1 },
            }),
          ).toBe(projectId);
          await waitFor(status, (r) => r.git.worktrees.length === 1);
          await handle.signal("add-batch", { tasks: [task("after-restart")] });
          const restarted = await waitFor(status, (r) =>
            r.backlog.some((t) => t.id === "after-restart"),
          );
          expect(restarted.git.worktrees[0]?.id).toBe(second.input.runId);
          expect(restarted.runningChildren).toEqual({});
          expect(runs).toHaveLength(2);
        } finally {
          holds.forEach((hold) => hold.resolve());
          if ((await handle.describe()).status.name === "RUNNING") {
            await handle.signal("shutdown", { force: true });
            await handle.result();
          }
        }
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 180000);
  it("replays an independent pre-patch stub-dispatch history without switching its child type", async () => {
    const legacyBundle = await bundleWorkflowCode({
      workflowsPath: fileURLToPath(
        new URL("../fixtures/legacy-project.ts", import.meta.url),
      ),
    });
    const childBundle = await bundleWorkflowCode({
      workflowsPath: fileURLToPath(
        new URL("../fixtures/project-orchestrator.ts", import.meta.url),
      ),
    });
    const taskQueue = randomUUID();
    let started = false;
    const parentWorker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowBundle: legacyBundle,
      activities: {
        assignWorktree: async (
          input: Parameters<ProjectActivities["assignWorktree"]>[0],
        ) => ({
          id: input.leaseId,
          taskId: input.taskId,
          path: "/legacy",
          branch: "feature/legacy",
          baseCommit: "a".repeat(40),
          status: "assigned",
        }),
      },
    });
    const childWorker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: "claith-orchestrator",
      workflowBundle: childBundle,
      maxHeartbeatThrottleInterval: "20ms",
      activities: {
        runProjectTask: async () => {
          const context = Context.current();
          const timer = setInterval(() => context.heartbeat(), 20);
          started = true;
          try {
            await context.cancelled;
          } finally {
            clearInterval(timer);
          }
        },
      },
    });
    const parentRun = parentWorker.run(),
      childRun = childWorker.run();
    const client = new Client({ connection: env.client.connection });
    const handle = await client.workflow.start("projectWorkflow", {
      workflowId: randomUUID(),
      taskQueue,
      args: [{ gitUrl: "fixture:legacy" }],
    });
    try {
      await handle.signal("add-batch", { tasks: [task("legacy")] });
      await waitFor(
        async () => started,
        (value) => value,
      );
      const history = await handle.fetchHistory();
      expect(
        history.events?.some(
          (e) =>
            e.startChildWorkflowExecutionInitiatedEventAttributes?.workflowType
              ?.name === "orchestratorWorkflow",
        ),
      ).toBe(true);
      await Worker.runReplayHistory({ workflowBundle: realBundle }, history);
    } finally {
      await handle.terminate();
      parentWorker.shutdown();
      childWorker.shutdown();
      await Promise.all([parentRun, childRun]);
    }
  }, 60000);
  it("runs two independent real Taskflows serially against refreshed dev, with review, repair, push and cleanup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "claith-project-delivery-"));
    try {
      const f = await projectFixture(directory);
      const taskQueue = randomUUID();
      const sessions: string[] = [];
      const runs: PreparedTaskRun[] = [];
      const projectActivities = createProjectActivities(f.root);
      const activities = {
        ...createActivities(f.root, fixtureFactory(sessions, true)),
        ...projectActivities,
        prepareTaskRun: async (
          input: Parameters<ProjectActivities["prepareTaskRun"]>[0],
        ) => {
          const prepared = await projectActivities.prepareTaskRun(input);
          await git(prepared.input.project, "config", "user.name", "Test");
          await git(
            prepared.input.project,
            "config",
            "user.email",
            "test@example.invalid",
          );
          runs.push(prepared);
          return prepared;
        },
        assignWorktree: async () => {
          throw new Error("Unexpected duplicate workspace");
        },
        releaseWorktree: async () => {
          throw new Error("Project must not release Taskflow workspaces");
        },
      };
      const worker = await Worker.create({
        connection: env.nativeConnection,
        taskQueue,
        workflowBundle: realBundle,
        activities,
      });
      const client = new ProjectClient(
        new Client({ connection: env.client.connection }),
        taskQueue,
      );
      const projectId = await client.start({ gitUrl: f.remote });
      const handle = client.client.workflow.getHandle(projectId);
      const status = () => handle.query<ProjectSnapshot>("get-full-state");
      await worker.runUntil(async () => {
        try {
          await handle.signal("add-batch", {
            tasks: [task("first"), task("second")],
          });
          const state = await waitFor(
            status,
            (r) => r.completed.length === 2 && r.git.worktrees.length === 0,
            90000,
          );
          expect(state.config.maxParallel).toBe(1);
          expect(state.failed).toEqual({});
          expect(runs).toHaveLength(2);
          expect(runs[1]!.input.startCommit).not.toBe(
            runs[0]!.input.startCommit,
          );
          expect(new Set(sessions).size).toBe(8);
          const results = await Promise.all(
            runs.map((r) =>
              client.client.workflow
                .getHandle(r.input.runId)
                .query<RunRecord>("status"),
            ),
          );
          expect(runs[1]!.input.startCommit).toBe(
            results[0]!.execution.integration!.revision,
          );
          expect(await git(f.remote, "rev-parse", "dev")).toBe(
            results[1]!.execution.integration!.revision,
          );
          for (const result of results) {
            expect(result.execution).toMatchObject({
              status: "completed",
              pushed: true,
              cleaned: true,
              repairsUsed: 1,
            });
          }
          expect(
            (
              await client.evidence(projectId, { taskId: "first" })
            ).evidence.some((e) => e.type === "review"),
          ).toBe(true);
          expect(
            (
              await client.evidence(projectId, { taskId: "second" })
            ).evidence.some((e) => e.type === "check"),
          ).toBe(true);
          const history = await handle.fetchHistory();
          const starts =
            history.events?.flatMap((e) =>
              e.startChildWorkflowExecutionInitiatedEventAttributes
                ? [e.startChildWorkflowExecutionInitiatedEventAttributes]
                : [],
            ) ?? [];
          expect(starts.map((s) => s.workflowType?.name)).toEqual([
            "taskWorkflow",
            "taskWorkflow",
          ]);
          expect(starts.map((s) => s.workflowId)).toEqual(
            runs.map((r) => r.input.runId),
          );
          await Worker.runReplayHistory(
            { workflowBundle: realBundle },
            history,
          );
        } finally {
          await handle.signal("shutdown", { force: true });
          await handle.result();
        }
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120000);
});
