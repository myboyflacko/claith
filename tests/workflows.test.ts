import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Context } from "@temporalio/activity";
import { Worker, bundleWorkflowCode } from "@temporalio/worker";
import type { Activities, RunRecord } from "../src/domain/contracts.js";
import {
  taskInput,
  acceptedReview,
  projectFixture,
  verificationPlan,
} from "./fixtures/task.js";
import { createActivities } from "../src/runtime/activities.js";
import { fixtureFactory } from "./fixtures/agent.js";
import { git } from "../src/workspace/git.js";
import { DeliveryClient } from "../src/runtime/client.js";
import { readJson } from "../src/workspace/storage.js";

export async function waitFor(
  query: () => Promise<RunRecord>,
  predicate: (record: RunRecord) => boolean,
) {
  for (let i = 0; i < 300; i++) {
    const record = await query();
    if (predicate(record)) return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out: ${JSON.stringify(await query())}`);
}
describe("single-task delivery workflows", () => {
  let env: TestWorkflowEnvironment;
  let bundle: Awaited<ReturnType<typeof bundleWorkflowCode>>;
  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
    bundle = await bundleWorkflowCode({
      workflowsPath: fileURLToPath(
        new URL("../src/runtime/workflows.ts", import.meta.url),
      ),
    });
  }, 60000);
  afterAll(async () => {
    await env?.teardown();
  });
  async function scenario(
    options: {
      findings?: boolean;
      endless?: boolean;
      pushFailure?: boolean;
      cleanupFailure?: boolean;
      baseChanged?: boolean;
      stale?: boolean;
      failedChecks?: boolean;
      integrationFailure?: boolean;
      longImplement?: boolean;
      finalRecordFailure?: boolean;
    } = {},
  ) {
    const input = taskInput();
    input.runId = randomUUID();
    const calls: string[] = [];
    let finalRecordFailure = options.finalRecordFailure;
    let pushFailure = options.pushFailure;
    let cleanupFailure = options.cleanupFailure;
    const activities: Activities = {
      record: async (r) => {
        if (r.execution.status === "completed" && finalRecordFailure) {
          finalRecordFailure = false;
          throw new Error("Storage unavailable");
        }
        return r.execution.sessions;
      },
      prepare: async () => ({
        path: "/work",
        branch: "task",
        base: input.startCommit,
        artifactDir: "/artifacts",
      }),
      implement: async (i) => {
        calls.push(`implement-${i.attempt}`);
        if (options.longImplement) {
          const context = Context.current();
          const timer = setInterval(() => context.heartbeat(), 20);
          try {
            await new Promise<void>((resolve) => {
              const stop = () => {
                calls.push("implement-stopped");
                resolve();
              };
              if (context.cancellationSignal.aborted) stop();
              else
                context.cancellationSignal.addEventListener("abort", stop, {
                  once: true,
                });
            });
          } finally {
            clearInterval(timer);
          }
        }
        return {
          sessionId: `implement-${i.attempt}`,
          submission: {
            runId: i.runId,
            taskId: i.contract.taskId,
            version: i.contract.version,
            attempt: i.attempt,
            revision: i.startCommit,
            status: "submitted",
            summary: "Done",
            verificationPlan: verificationPlan(),
            evidence: [{ criterionId: "works", references: ["test"] }],
          },
        };
      },
      candidate: async (i) => ({
        revision: (i.attempt ? "c" : "b").repeat(40),
        diffRef: "diff",
        verificationPlan: verificationPlan(),
      }),
      check: async (i) =>
        i.candidate.verificationPlan.checks.map((c) => ({
          ...c,
          exitCode: options.failedChecks && i.attempt === 0 ? 1 : 0,
          outputRef: "log",
          revision: i.candidate.revision,
          unchanged: true,
        })),
      review: async (i) => {
        calls.push(`review-${i.attempt}`);
        const value = acceptedReview(i);
        if (options.endless || (options.findings && i.attempt === 0)) {
          value.verdict = "changes_requested";
          value.findings = [{ id: "fix", text: "Fix behavior" }];
        }
        if (options.stale) value.revision = "d".repeat(40);
        return { sessionId: `review-${i.attempt}`, submission: value };
      },
      integrate: async (i) => {
        calls.push(`integrate-${i.attempt}`);
        if (options.baseChanged)
          throw new Error("Development base changed; new contract required");
        return {
          verificationPlan: i.candidate.verificationPlan,
          path: "/integration",
          branch: "integration",
          revision: "e".repeat(40),
          checks: i.checks.map((c) => ({
            ...c,
            revision: "e".repeat(40),
            exitCode: options.integrationFailure && i.attempt === 0 ? 1 : 0,
          })),
        };
      },
      push: async () => {
        calls.push("push");
        if (pushFailure) {
          pushFailure = false;
          throw new Error("Push unavailable");
        }
      },
      cleanup: async () => {
        calls.push("cleanup");
        if (cleanupFailure) {
          cleanupFailure = false;
          throw new Error("Cleanup unavailable");
        }
      },
    };
    const worker = await Worker.create({
      connection: env.nativeConnection,
      maxHeartbeatThrottleInterval: "50ms",
      taskQueue: input.runId,
      workflowBundle: bundle,
      activities,
    });
    const handle = await env.client.workflow.start("taskWorkflow", {
      workflowId: input.runId,
      taskQueue: input.runId,
      args: [input],
    });
    const status = () => handle.query<RunRecord>("status");
    return { input, worker, handle, status, calls };
  }
  it("uses separate role children per repair and completes only after delivery", async () => {
    const s = await scenario({ findings: true });
    await s.worker.runUntil(async () => {
      const result = (await s.handle.result()) as RunRecord;
      expect(result.execution.status).toBe("completed");
      expect(
        result.execution.attempts.map(
          (a) => a.result!.implementation.sessionId,
        ),
      ).toEqual(["implement-0", "implement-1"]);
      expect(
        new Set(
          result.execution.attempts.flatMap((a) => [
            a.implementerWorkflowId,
            a.reviewerWorkflowId,
          ]),
        ).size,
      ).toBe(4);
      expect(s.calls).toEqual([
        "implement-0",
        "review-0",
        "implement-1",
        "review-1",
        "integrate-1",
        "push",
        "cleanup",
      ]);
      expect(result.execution).toMatchObject({
        pushed: true,
        cleaned: true,
        repairsUsed: 1,
      });
      expect(result.contract).toEqual(s.input.contract);
    });
  });
  it("blocks after two repairs, rejects stale decisions and requires extra budget", async () => {
    const s = await scenario({ endless: true });
    await s.worker.runUntil(async () => {
      const blocked = await waitFor(
        s.status,
        (r) => r.execution.blocked?.kind === "repair",
      );
      expect(blocked.execution.attempts).toHaveLength(3);
      await expect(
        s.handle.executeUpdate("resume", {
          args: [
            { commandId: "stale", blockerId: "wrong", additionalRepairs: 1 },
          ],
        }),
      ).rejects.toThrow();
      await expect(
        s.handle.executeUpdate("resume", {
          args: [
            {
              commandId: "empty",
              blockerId: blocked.execution.blocked!.id,
              additionalRepairs: 0,
            },
          ],
        }),
      ).rejects.toThrow();
      const command = {
        commandId: "continue",
        blockerId: blocked.execution.blocked!.id,
        additionalRepairs: 1,
      };
      await s.handle.executeUpdate("resume", { args: [command] });
      await s.handle.executeUpdate("resume", { args: [command] });
      const next = await waitFor(
        s.status,
        (r) =>
          r.execution.blocked?.kind === "repair" &&
          r.execution.repairsUsed === 3,
      );
      expect(next.execution.attempts).toHaveLength(4);
      await s.handle.executeUpdate("cancel", { args: ["cancel"] });
      expect(((await s.handle.result()) as RunRecord).execution.status).toBe(
        "cancelled",
      );
    });
  });
  it.each(["pushFailure", "cleanupFailure"] as const)(
    "resumes %s without repeating successful agent work",
    async (failure) => {
      const s = await scenario({ [failure]: true });
      await s.worker.runUntil(async () => {
        const blocked = await waitFor(
          s.status,
          (r) => r.execution.blocked?.kind === "delivery",
        );
        await s.handle.executeUpdate("resume", {
          args: [
            {
              commandId: "resume",
              blockerId: blocked.execution.blocked!.id,
              additionalRepairs: 0,
            },
          ],
        });
        expect(((await s.handle.result()) as RunRecord).execution.status).toBe(
          "completed",
        );
        expect(s.calls.filter((c) => c.startsWith("implement"))).toHaveLength(
          1,
        );
        expect(s.calls.filter((c) => c.startsWith("review"))).toHaveLength(1);
      });
    },
  );
  it.each(["baseChanged", "stale"] as const)(
    "does not deliver with %s",
    async (failure) => {
      const s = await scenario({ [failure]: true });
      await s.worker.runUntil(async () => {
        const blocked = await waitFor(
          s.status,
          (r) => r.execution.status === "blocked",
        );
        if (failure === "baseChanged")
          await expect(
            s.handle.executeUpdate("resume", {
              args: [
                {
                  commandId: "resume",
                  blockerId: blocked.execution.blocked!.id,
                  additionalRepairs: 1,
                },
              ],
            }),
          ).rejects.toThrow();
        expect(s.calls).not.toContain("push");
        await s.handle.executeUpdate("cancel", { args: ["cancel"] });
        await s.handle.result();
      });
    },
  );
  it.each(["failedChecks", "integrationFailure"] as const)(
    "repairs %s inside the same budget",
    async (failure) => {
      const s = await scenario({ [failure]: true });
      await s.worker.runUntil(async () => {
        const result = (await s.handle.result()) as RunRecord;
        expect(result.execution.repairsUsed).toBe(1);
        if (failure === "failedChecks")
          expect(s.calls).not.toContain("review-0");
        expect(s.calls).toContain("review-1");
      });
    },
  );
  it("waits for an active child to stop on cancellation", async () => {
    const s = await scenario({ longImplement: true });
    await s.worker.runUntil(async () => {
      for (let i = 0; i < 300 && !s.calls.includes("implement-0"); i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      expect(s.calls).toContain("implement-0");
      await s.handle.executeUpdate("cancel", { args: ["cancel"] });
      expect(((await s.handle.result()) as RunRecord).execution.status).toBe(
        "cancelled",
      );
      expect(s.calls).toContain("implement-stopped");
      expect(s.calls).not.toContain("push");
    });
  });
  it("resumes final artifact persistence without losing completed status", async () => {
    const s = await scenario({ finalRecordFailure: true });
    await s.worker.runUntil(async () => {
      const blocked = await waitFor(
        s.status,
        (r) => r.execution.blocked?.kind === "recovery" && r.execution.cleaned,
      );
      await s.handle.executeUpdate("resume", {
        args: [
          {
            commandId: "resume",
            blockerId: blocked.execution.blocked!.id,
            additionalRepairs: 0,
          },
        ],
      });
      expect(((await s.handle.result()) as RunRecord).execution.status).toBe(
        "completed",
      );
      expect(s.calls.filter((c) => c === "push")).toHaveLength(1);
    });
  });
  it("runs real Git, Pi adapters, fix sessions, integration, push and cleanup end to end", async () => {
    const directory = await mkdtemp(join(tmpdir(), "claith-e2e-"));
    try {
      const f = await projectFixture(directory);
      f.input.runId = randomUUID();
      const sessions: string[] = [];
      const worker = await Worker.create({
        connection: env.nativeConnection,
        taskQueue: f.input.runId,
        workflowBundle: bundle,
        activities: createActivities(f.root, fixtureFactory(sessions, true)),
      });
      const client = new DeliveryClient(env.client, f.input.runId);
      const runId = await client.run(
        f.project,
        f.input.contract,
        f.input.configuration,
      );
      const handle = env.client.workflow.getHandle(runId);
      await worker.runUntil(async () => {
        const result = (await handle.result()) as RunRecord;
        expect(result.execution.status).toBe("completed");
        expect(new Set(sessions).size).toBe(4);
        expect(result.execution.sessions).toHaveLength(4);
        expect(
          await client.run(f.project, f.input.contract, f.input.configuration),
        ).toBe(runId);
        await expect(
          client.run(
            f.project,
            { ...f.input.contract, title: "Different" },
            f.input.configuration,
          ),
        ).rejects.toThrow("different input");
        expect(result.execution.attempts).toHaveLength(2);
        expect(await git(f.remote, "rev-parse", "dev")).toBe(
          result.execution.integration!.revision,
        );
        expect(
          await git(
            f.project,
            "branch",
            "--list",
            result.execution.workspace!.branch,
          ),
        ).toBe("");
        const saved = await readJson<RunRecord>(
          join(result.execution.workspace!.artifactDir, "run.json"),
        );
        expect(saved?.contract).toEqual(f.input.contract);
        expect(saved?.execution.cleaned).toBe(true);
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60000);
});
