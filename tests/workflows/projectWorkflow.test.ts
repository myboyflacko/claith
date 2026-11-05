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
import { ProjectClient } from "../../src/runtime/projectClient.js";
import type {
  ChildWorkflowInput,
  ChildWorkflowResult,
  ProjectActivities,
  ProjectConfig,
  ProjectSnapshot,
  Task,
} from "../../src/workflows/types.js";

const task = (id: string, dependsOn: string[] = [], priority = 0): Task => ({
  id,
  dependsOn,
  priority,
  payload: {},
  createdAt: "2026-01-01T00:00:00.000Z",
});
async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
): Promise<T> {
  for (let i = 0; i < 400; i++) {
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
  let childBundle: Awaited<ReturnType<typeof bundleWorkflowCode>>;
  let childWorker: Worker;
  let childRun: Promise<void>;
  let childImpl: (input: ChildWorkflowInput) => Promise<ChildWorkflowResult>;
  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
    bundle = await bundleWorkflowCode({
      workflowsPath: fileURLToPath(
        new URL("../../src/workflows/index.ts", import.meta.url),
      ),
    });
    childBundle = await bundleWorkflowCode({
      workflowsPath: fileURLToPath(
        new URL("../fixtures/project-orchestrator.ts", import.meta.url),
      ),
    });
    childWorker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: "claith-orchestrator",
      workflowBundle: childBundle,
      maxHeartbeatThrottleInterval: "20ms",
      activities: {
        runProjectTask: async (input: ChildWorkflowInput) => {
          const context = Context.current();
          const timer = setInterval(() => context.heartbeat(), 20);
          try {
            return await childImpl(input);
          } finally {
            clearInterval(timer);
          }
        },
      },
    });
    childRun = childWorker.run();
  }, 60000);
  afterAll(async () => {
    childWorker?.shutdown();
    await childRun;
    await env?.teardown();
  });
  async function scenario(
    options: {
      config?: Partial<ProjectConfig>;
      plan?: Task[] | ((contractId: string) => Task[]);
      noCache?: boolean;
      storeGate?: ReturnType<typeof gate>;
      run?: (input: ChildWorkflowInput) => Promise<ChildWorkflowResult>;
      assignGate?: ReturnType<typeof gate>;
      planGate?: ReturnType<typeof gate>;
    } = {},
  ) {
    const root = await mkdtemp(join(tmpdir(), "claith-project-wf-"));
    const taskQueue = randomUUID();
    const assigned: string[] = [],
      released: string[] = [],
      planned: string[] = [];
    const gates = new Map<string, ReturnType<typeof gate>>();
    const started: string[] = [];
    const cancelled: string[] = [];
    const storing: string[] = [];
    childImpl = async (input) => {
      started.push(input.taskId);
      Context.current().cancellationSignal.addEventListener(
        "abort",
        () => cancelled.push(input.taskId),
        { once: true },
      );
      if (options.run) return options.run(input);
      const hold = gate();
      gates.set(input.taskId, hold);
      await Promise.race([hold.promise, Context.current().cancelled]);
      return {
        success: true,
        evidence: [
          {
            id: "result",
            taskId: input.taskId,
            type: "check",
            timestamp: "2026-01-01T00:00:00.000Z",
            data: { large: "kept in SQLite" },
          },
        ],
      };
    };
    const realActivities = createProjectActivities(root);
    const activities: ProjectActivities = {
      ...realActivities,
      storeEvidence: async (input) => {
        storing.push(...input.evidence.map((e) => e.taskId));
        await options.storeGate?.promise;
        return realActivities.storeEvidence(input);
      },
      assignWorktree: async (input) => {
        assigned.push(input.taskId);
        await options.assignGate?.promise;
        return {
          id: input.leaseId,
          path: `/managed/${input.leaseId}`,
          branch: `feature/${input.taskId}`,
          taskId: input.taskId,
          baseCommit: "a".repeat(40),
          status: "assigned",
        };
      },
      releaseWorktree: async (input) => {
        released.push(input.taskId);
      },
      planTasks: async (input) => {
        planned.push(input.contractId);
        await options.planGate?.promise;
        return typeof options.plan === "function"
          ? options.plan(input.contractId)
          : (options.plan ?? []);
      },
    };
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowBundle: bundle,
      activities,
      maxCachedWorkflows: options.noCache ? 0 : 1000,
    });
    const rawClient = new Client({ connection: env.client.connection });
    const client = new ProjectClient(rawClient, taskQueue);
    const input = {
      gitUrl: `fixture:${taskQueue}`,
      config: { maxParallel: 2, ...options.config },
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
      handle,
      status,
      run,
      assigned,
      released,
      started,
      gates,
      client,
      projectId,
      input,
      planned,
      cleanup: () => rm(root, { recursive: true, force: true }),
      activities,
      cancelled,
      storing,
    };
  }
  it("starts ready children concurrently, enforces dependencies, persists evidence and replays history", async () => {
    const s = await scenario({ config: { evidenceRetention: 2 } });
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
      expect(new Set(s.assigned)).toEqual(new Set(["high", "low"]));
      expect(s.started).not.toContain("dependent");
      expect(await s.handle.query("get-backlog")).toMatchObject([
        { id: "dependent" },
      ]);
      const running =
        await s.handle.query<Record<string, unknown>>("get-running");
      expect(Object.keys(running)).toHaveLength(2);
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
      expect(s.released).toHaveLength(3);
      expect(await s.handle.query("get-completed")).toHaveLength(3);
      expect(await s.handle.query("get-failed")).toEqual({});
      expect(await s.handle.query("get-worktrees")).toEqual([]);
      expect(await s.handle.query("get-health")).toMatchObject({
        backlogSize: 0,
        runningCount: 0,
        errorRate: 0,
      });
      expect(await s.handle.query("get-evidence")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            storageRef: expect.stringContaining("sqlite:"),
          }),
        ]),
      );
      expect((await s.status()).evidence[0]).not.toHaveProperty("data");
      expect((await s.status()).evidence).toHaveLength(2);
      const history = await s.client.evidence(s.projectId, { limit: 2 });
      expect(history.total).toBe(3);
      expect(history.hasMore).toBe(true);
      expect(history.evidence[0]?.data).toEqual({ large: "kept in SQLite" });
      const workflowHistory = await s.handle.fetchHistory();
      const starts =
        workflowHistory.events?.flatMap((event) =>
          event.startChildWorkflowExecutionInitiatedEventAttributes
            ? [event.startChildWorkflowExecutionInitiatedEventAttributes]
            : [],
        ) ?? [];
      expect(starts[0]?.workflowId).toMatch(/^task-high-/);
      expect(starts[1]?.workflowId).toMatch(/^task-low-/);
      expect(starts[0]?.workflowTaskCompletedEventId?.toString()).toBe(
        starts[1]?.workflowTaskCompletedEventId?.toString(),
      );
      expect(starts[0]?.taskQueue?.name).toBe("claith-orchestrator");
      expect(starts[0]?.retryPolicy?.maximumAttempts).toBe(1);
      expect(starts[0]?.workflowRunTimeout?.seconds?.toString()).toBe("3600");
      await Worker.runReplayHistory(
        { workflowBundle: bundle },
        workflowHistory,
      );
    });
  }, 60000);
  it("queues paused commands, reorders the backlog and hot-reloads parallelism", async () => {
    const s = await scenario();
    await s.run(async () => {
      await s.handle.signal("pause", { reason: "maintenance" });
      await waitFor(s.status, (r) => r.status === "PAUSED");
      await s.handle.signal("add-batch", { tasks: [task("one"), task("two")] });
      await s.handle.signal("reorder", { taskIds: ["two", "one"] });
      await s.handle.signal("update-config", { config: { maxParallel: 1 } });
      expect((await s.status()).backlog).toEqual([]);
      await s.handle.signal("resume", {});
      await waitFor(s.status, () => s.started.length === 1);
      expect(s.started).toEqual(["two"]);
      expect(await s.handle.query("get-backlog")).toMatchObject([
        { id: "one" },
      ]);
      await s.handle.signal("pause", {});
      s.gates.get("two")!.resolve();
      await waitFor(s.status, (r) => r.completed.includes("two"));
      expect(s.started).toEqual(["two"]);
      await s.handle.signal("resume", {});
      await waitFor(s.status, () => s.started.includes("one"));
      s.gates.get("one")!.resolve();
      await waitFor(s.status, (r) => r.completed.length === 2);
    });
  }, 60000);
  it("rejects invalid batches atomically and ignores duplicates without spinning on blocked work", async () => {
    const s = await scenario({ config: { maxParallel: 1 } });
    await s.run(async () => {
      await s.handle.signal("add-batch", {
        tasks: [task("discard"), task("invalid", ["missing"])],
      });
      await s.handle.signal("add-batch", {
        tasks: [task("cycle1", ["cycle2"]), task("cycle2", ["cycle1"])],
      });
      await s.handle.signal("add-task", {
        taskId: "root",
        dependsOn: [],
        payload: {},
      });
      await waitFor(
        s.status,
        (r) => r.rejections.length === 2 && s.started.includes("root"),
      );
      await s.handle.signal("add-task", {
        taskId: "root",
        dependsOn: [],
        payload: {},
      });
      await s.handle.signal("add-task", {
        taskId: "leaf",
        dependsOn: ["root"],
        payload: {},
      });
      await s.handle.signal("remove-task", { taskId: "root" });
      await waitFor(s.status, (r) => r.rejections.length === 3);
      expect(s.assigned).toEqual(["root"]);
      expect((await s.status()).backlog.map((t) => t.id)).toEqual(["leaf"]);
      await s.handle.signal("update-config", { config: { maxParallel: 0 } });
      await waitFor(s.status, (r) => r.rejections.length === 4);
      expect((await s.status()).config.maxParallel).toBe(1);
      s.gates.get("root")!.resolve();
      await waitFor(s.status, () => s.started.includes("leaf"));
      s.gates.get("leaf")!.resolve();
      await waitFor(s.status, (r) => r.completed.length === 2);
      await s.handle.signal("add-task", {
        taskId: "root",
        dependsOn: [],
        payload: {},
      });
      expect((await s.status()).completed).toHaveLength(2);
      expect(s.assigned).toHaveLength(2);
    });
  }, 60000);
  it("aggregates contracts idempotently, records exhausted failures and only retries on an explicit signal", async () => {
    let attempts = 0;
    const s = await scenario({
      plan: [{ ...task("planned"), contractId: "contract" }],
      run: async () => {
        if (++attempts === 1)
          throw ApplicationFailure.nonRetryable("broken", "TestFailure");
        return { success: true, evidence: [] };
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
        (r) => !!r.failed.planned && r.git.worktrees.length === 0,
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
      await s.handle.signal("add-task", {
        taskId: "planned",
        contractId: "contract",
        dependsOn: [],
        payload: {},
      });
      await waitFor(
        s.status,
        (r) => r.completed.includes("planned") && r.git.worktrees.length === 0,
      );
      expect(attempts).toBe(2);
      expect(await s.handle.query("get-contracts")).toMatchObject([
        { status: "completed" },
      ]);
      expect((await s.client.evidence(s.projectId)).total).toBe(1);
    });
  }, 60000);
  it.each([false, true])(
    "handles shutdown force=%s and waits for cleanup",
    async (force) => {
      const s = await scenario();
      await s.run(async () => {
        await s.handle.signal("add-task", {
          taskId: "active",
          dependsOn: [],
          payload: {},
        });
        await waitFor(s.status, () => s.started.length === 1);
        await s.handle.signal("shutdown", { force });
        if (!force) {
          expect((await s.status()).status).toBe("SHUTTING_DOWN");
          expect(s.released).toEqual([]);
          s.gates.get("active")!.resolve();
        }
        await s.handle.result();
        expect(s.released).toEqual(["active"]);
      });
    },
    60000,
  );
  it("does not start a child when paused during worktree assignment", async () => {
    const hold = gate();
    const s = await scenario({ assignGate: hold });
    await s.run(async () => {
      await s.handle.signal("add-task", {
        taskId: "late",
        dependsOn: [],
        payload: {},
      });
      await waitFor(s.status, () => s.assigned.length === 1);
      await s.handle.signal("pause", {});
      hold.resolve();
      await waitFor(
        s.status,
        (r) => r.status === "PAUSED" && r.backlog.length === 1,
      );
      expect(s.started).toEqual([]);
      expect(s.released).toEqual(["late"]);
      await s.handle.signal("resume", {});
      await waitFor(s.status, () => s.started.length === 1);
      s.gates.get("late")!.resolve();
      await waitFor(s.status, (r) => r.completed.length === 1);
    });
  }, 60000);
  it("shuts down after an in-flight plan without waiting for another signal", async () => {
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
  it("carries completed dependencies and deferred commands across Continue-As-New", async () => {
    const s = await scenario({
      config: { historyEventLimit: 80 },
      run: async () => ({ success: true, evidence: [] }),
    });
    await s.run(async () => {
      await s.handle.signal("add-task", {
        taskId: "before",
        dependsOn: [],
        payload: {},
      });
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
      await s.handle.signal("add-task", {
        taskId: "after",
        dependsOn: ["before"],
        payload: {},
      });
      await s.handle.signal("resume", {});
      await waitFor(s.status, (r) => r.completed.includes("after"));
      expect((await s.status()).completed).toContain("before");
      expect(await s.client.start(s.input)).toBe(s.projectId);
    });
  }, 60000);
  it("times out children without automatically retrying tasks", async () => {
    const s = await scenario({ config: { taskTimeout: 200 } });
    await s.run(async () => {
      await s.handle.signal("add-task", {
        taskId: "slow",
        dependsOn: [],
        payload: {},
      });
      await waitFor(
        s.status,
        (r) => !!r.failed.slow && r.git.worktrees.length === 0,
      );
      expect(s.assigned).toEqual(["slow"]);
      expect(s.released).toEqual(["slow"]);
      expect((await s.status()).evidence).toMatchObject([{ type: "error" }]);
      s.gates.get("slow")?.resolve();
    });
  }, 60000);
  it("rejects malformed child evidence instead of hanging in persistence", async () => {
    const s = await scenario({
      run: async () => ({
        success: true,
        evidence: [
          { id: "bad", taskId: "bad", type: "check", timestamp: "not-a-date" },
        ],
      }),
    });
    await s.run(async () => {
      await s.handle.signal("add-task", {
        taskId: "malformed",
        dependsOn: [],
        payload: {},
      });
      await waitFor(
        s.status,
        (r) => !!r.failed.malformed && r.git.worktrees.length === 0,
      );
      expect((await s.status()).failed.malformed).toContain(
        "Invalid child result",
      );
    });
  }, 60000);
  it("fails closed when the production orchestrator stub is invoked", async () => {
    const s = await scenario();
    await s.run(async () => {
      const result = (await s.client.client.workflow.execute(
        "orchestratorWorkflow",
        {
          workflowId: randomUUID(),
          taskQueue: s.client.taskQueue,
          args: [{ projectId: s.projectId, taskId: "stub" }],
        },
      )) as ChildWorkflowResult;
      expect(result.success).toBe(false);
      expect(result.error).toContain("not implemented");
    });
  }, 60000);
  it("recovers active children after replacing the project worker", async () => {
    const s = await scenario({ noCache: true });
    const oldRun = s.worker.run();
    let replacement: Worker | undefined;
    try {
      await s.handle.signal("add-task", {
        taskId: "recover",
        dependsOn: [],
        payload: {},
      });
      await waitFor(s.status, () => s.started.length === 1);
      const oldId = (await s.status()).runningChildren.recover!.workflowId;
      s.worker.shutdown();
      await oldRun;
      replacement = await Worker.create({
        connection: env.nativeConnection,
        taskQueue: s.client.taskQueue,
        workflowBundle: bundle,
        activities: s.activities,
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
        expect(s.assigned).toEqual(["recover"]);
        expect(s.released).toEqual(["recover"]);
        await s.handle.signal("shutdown", {});
        await s.handle.result();
      });
    } finally {
      if (s.worker.getState() === "RUNNING") s.worker.shutdown();
      if (replacement?.getState() === "RUNNING") replacement.shutdown();
      await oldRun;
      await s.cleanup();
    }
  }, 60000);
  it("cancels outstanding children while evidence persistence is blocked", async () => {
    const storeGate = gate();
    const s = await scenario({ storeGate });
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
      storeGate.resolve();
      await s.handle.result();
      expect(new Set(s.released)).toEqual(new Set(["done", "busy"]));
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
      expect(s.assigned).toEqual(["shared"]);
      expect(state.backlog).toEqual([]);
      s.gates.get("shared")!.resolve();
      await waitFor(s.status, (r) => r.completed.includes("shared"));
      expect(
        (await s.status()).contracts.find((c) => c.contractId === "b")?.status,
      ).toBe("failed");
    });
  }, 60000);
  it("reconciles children on external workflow cancellation", async () => {
    const s = await scenario();
    // Cancellation returns a failure by design, unlike the shutdown signal.
    try {
      await s.worker.runUntil(async () => {
        await s.handle.signal("add-task", {
          taskId: "cancelled",
          dependsOn: [],
          payload: {},
        });
        await waitFor(s.status, () => s.started.length === 1);
        await s.handle.cancel();
        await expect(s.handle.result()).rejects.toThrow();
        expect(s.released).toEqual(["cancelled"]);
      });
    } finally {
      await s.cleanup();
    }
  }, 60000);
});
