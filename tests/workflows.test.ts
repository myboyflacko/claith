import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { profileSchema, runtimeSchema } from "../src/configuration.js";
import type {
  Activities,
  DeliveryContract,
  SessionSnapshot,
} from "../src/domain/contracts.js";

export const configuration = {
  runtime: runtimeSchema.parse({ reminderSeconds: 3600 }),
  agents: {
    orchestrator: profileSchema.parse({
      provider: "double",
      model: "double",
      instructions: "test",
    }),
    implementer: profileSchema.parse({
      provider: "double",
      model: "double",
      instructions: "test",
    }),
    reviewer: profileSchema.parse({
      provider: "double",
      model: "double",
      instructions: "test",
    }),
  },
};
export const contract: DeliveryContract = {
  taskId: "task-one",
  version: 1,
  startingRevision: "a".repeat(40),
  title: "Implement task",
  outcome: "Works",
  boundaries: ["Only this task"],
  dependencies: [],
  acceptance: [
    { id: "works", text: "Checks pass", mode: "check", checkId: "test" },
  ],
  setup: [],
  checks: [{ id: "test", command: "npm test" }],
  review: true,
  endpoint: "local-commit",
};

describe("durable delivery workflows", () => {
  let env: TestWorkflowEnvironment;
  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  }, 60_000);
  afterAll(async () => {
    await env?.teardown();
  });

  async function scenario(
    options: {
      review?: boolean;
      failChecks?: boolean;
      human?: boolean;
      changesRequested?: boolean;
      mixedFailures?: boolean;
    } = {},
  ) {
    const id = randomUUID();
    const calls: string[] = [];
    const c = structuredClone(contract);
    c.review = options.review ?? true;
    if (options.human)
      c.acceptance.push({
        id: "human",
        text: "Looks right",
        mode: "human",
        checkId: null,
      });
    const workspace = {
      path: "/workspace",
      branch: "task",
      base: c.startingRevision,
      artifactDir: "/evidence",
    };
    const activities: Activities = {
      plan: async ({ session }) => ({
        message: "Next",
        outline: [],
        contract: session.acceptedResults.length ? null : c,
        goalComplete: session.acceptedResults.length > 0,
      }),
      prepare: async () => {
        calls.push("prepare");
        return workspace;
      },
      implement: async () => {
        calls.push("implement");
        return {
          status: "submitted",
          summary: "Done",
          evidence: [{ criterionId: "works", references: ["test"] }],
        };
      },
      candidate: async ({ implementation }) => ({
        revision: "b".repeat(40),
        diffRef: "/diff",
        implementation,
      }),
      check: async ({ candidate, attempt }) => {
        calls.push("check");
        return [
          {
            id: "test",
            command: "npm test",
            revision: candidate.revision,
            exitCode:
              options.failChecks || (options.mixedFailures && attempt === 0)
                ? 1
                : 0,
            unchanged: true,
            outputRef: "/check",
          },
        ];
      },
      review: async ({ attempt, candidate }) => {
        calls.push("review");
        return {
          taskId: c.taskId,
          attempt,
          revision: candidate.revision,
          verdict:
            options.changesRequested || options.mixedFailures
              ? "changes_requested"
              : "accepted",
          summary: "Review",
          evidenceRefs: ["test"],
        };
      },
      accept: async () => {
        calls.push("accept");
      },
    };
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: id,
      workflowsPath: fileURLToPath(
        new URL("../src/runtime/workflows.ts", import.meta.url),
      ),
      activities,
    });
    const handle = await env.client.workflow.start("coordinator", {
      workflowId: id,
      taskQueue: id,
      args: [
        {
          sessionId: id,
          project: "/project",
          startingRevision: c.startingRevision,
          configuration,
        },
      ],
    });
    const status = () => handle.query<SessionSnapshot>("status");
    const waitState = async (state: string) => {
      for (let i = 0; i < 200; i++) {
        const s = await status();
        if (s.state === state) return s;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(
        `Did not reach ${state}: ${JSON.stringify(await status())}`,
      );
    };
    return { id, calls, c, worker, handle, status, waitState };
  }

  it.each([true, false])(
    "gates dispatch, deduplicates approval, completes with review=%s",
    async (review) => {
      const s = await scenario({ review });
      await s.worker.runUntil(async () => {
        await s.handle.executeUpdate("conversation", {
          args: [{ id: "message", text: "Do task" }],
        });
        await s.waitState("awaiting_approval");
        expect(s.calls).toEqual([]);
        await expect(
          s.handle.executeUpdate("approve", {
            args: [
              {
                commandId: "stale",
                taskId: s.c.taskId,
                version: 2,
                configuration,
              },
            ],
          }),
        ).rejects.toThrow();
        const approval = {
          commandId: "approve",
          taskId: s.c.taskId,
          version: 1,
          configuration,
        };
        const execution = await s.handle.executeUpdate("approve", {
          args: [approval],
        });
        expect(
          await s.handle.executeUpdate("approve", { args: [approval] }),
        ).toBe(execution);
        const result = (await s.handle.result()) as SessionSnapshot;
        expect(result.state).toBe("completed");
        expect(result.acceptedResults[0]?.acceptedCommit).toBe("b".repeat(40));
        expect(s.calls.filter((c) => c === "implement")).toHaveLength(1);
        expect(s.calls.includes("review")).toBe(review);
      });
    },
    60_000,
  );

  it.each(["checks", "review"])(
    "shares the repair budget for failed %s and rejects stale decisions",
    async (failure) => {
      const s = await scenario({
        failChecks: failure === "checks",
        changesRequested: failure === "review",
      });
      await s.worker.runUntil(async () => {
        await s.handle.executeUpdate("conversation", {
          args: [{ id: "message", text: "Do task" }],
        });
        await s.waitState("awaiting_approval");
        await s.handle.executeUpdate("approve", {
          args: [
            {
              commandId: "approve",
              taskId: s.c.taskId,
              version: 1,
              configuration,
            },
          ],
        });
        const waiting = await s.waitState("waiting");
        expect(s.calls.filter((c) => c === "implement")).toHaveLength(3);
        const q = waiting.pendingEscalation!;
        await expect(
          s.handle.executeUpdate("decision", {
            args: [
              {
                commandId: "stale",
                executionId: q.executionId,
                escalationId: "wrong",
                answer: "retry",
                additionalRepairs: 1,
                confirmCriteria: [],
              },
            ],
          }),
        ).rejects.toThrow();
        await env.sleep("2 hours");
        expect((await s.status()).pendingEscalation?.id).toBe(q.id);
        expect((await s.status()).pendingEscalation!.reminders).toBeGreaterThan(
          0,
        );
        await s.handle.executeUpdate("cancel", { args: ["cancel"] });
        expect(((await s.handle.result()) as SessionSnapshot).state).toBe(
          "cancelled",
        );
      });
    },
    60_000,
  );

  it("requires explicit human confirmation and rejects partial answers", async () => {
    const s = await scenario({ human: true });
    await s.worker.runUntil(async () => {
      await s.handle.executeUpdate("conversation", {
        args: [{ id: "message", text: "Do task" }],
      });
      await s.waitState("awaiting_approval");
      await s.handle.executeUpdate("approve", {
        args: [
          {
            commandId: "approve",
            taskId: s.c.taskId,
            version: 1,
            configuration,
          },
        ],
      });
      const q = (await s.waitState("waiting")).pendingEscalation!;
      const decision = {
        commandId: "answer",
        executionId: q.executionId,
        escalationId: q.id,
        answer: "Confirmed",
        additionalRepairs: 0,
        confirmCriteria: ["human"],
      };
      await expect(
        s.handle.executeUpdate("decision", {
          args: [{ ...decision, commandId: "partial", confirmCriteria: [] }],
        }),
      ).rejects.toThrow();
      await s.handle.executeUpdate("decision", { args: [decision] });
      expect(
        ((await s.handle.result()) as SessionSnapshot).acceptedResults[0]
          ?.humanConfirmations,
      ).toEqual(["human"]);
    });
  }, 60_000);

  it("shares check/review repairs and cannot use an old reply to resolve a new question", async () => {
    const s = await scenario({ mixedFailures: true });
    await s.worker.runUntil(async () => {
      await s.handle.executeUpdate("conversation", {
        args: [{ id: "goal", text: "Do task" }],
      });
      await s.waitState("awaiting_approval");
      await s.handle.executeUpdate("approve", {
        args: [
          {
            commandId: "approve",
            taskId: s.c.taskId,
            version: 1,
            configuration,
          },
        ],
      });
      const first = (await s.waitState("waiting")).pendingEscalation!;
      expect(s.calls.filter((c) => c === "implement")).toHaveLength(3);
      expect(s.calls.filter((c) => c === "review")).toHaveLength(2);
      const decision = {
        commandId: "continue",
        executionId: first.executionId,
        escalationId: first.id,
        answer: "One extra repair",
        additionalRepairs: 1,
        confirmCriteria: [],
      };
      await s.handle.executeUpdate("decision", { args: [decision] });
      let second = await s.waitState("waiting");
      for (
        let i = 0;
        second.pendingEscalation?.id === first.id && i < 100;
        i++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        second = await s.status();
      }
      expect(second.pendingEscalation?.id).not.toBe(first.id);
      expect(s.calls.filter((c) => c === "implement")).toHaveLength(4);
      await s.handle.executeUpdate("decision", { args: [decision] });
      await env.sleep("2 hours");
      expect((await s.status()).pendingEscalation?.id).toBe(
        second.pendingEscalation?.id,
      );
      expect(s.calls.filter((c) => c === "implement")).toHaveLength(4);
      await s.handle.executeUpdate("cancel", { args: ["cancel"] });
      await s.handle.result();
    });
  }, 60_000);
});
