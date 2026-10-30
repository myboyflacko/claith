import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { join } from "node:path";
import type { SessionFactory } from "../../src/agents/pi.js";
import { verificationPlan } from "./task.js";
import type { TaskContract } from "../../src/domain/contracts.js";
export function fixtureFactory(
  sessions: string[],
  firstReviewFindings = false,
): SessionFactory {
  return async (options) => {
    sessions.push(options.sessionManager!.getSessionId());
    const implementer = options.tools!.includes("submit_implementation");
    return {
      session: {
        subscribe: () => () => {},
        abort: async () => {},
        dispose: () => {},
        prompt: async (text) => {
          const context = JSON.parse(text) as {
            task: TaskContract;
            runId: string;
            attempt: number;
            revision: string;
            feedback: string;
          };
          assert.ok(context.task.description);
          const identity = {
            runId: context.runId,
            taskId: context.task.taskId,
            version: context.task.version,
            attempt: context.attempt,
            revision: context.revision,
          };
          if (implementer && firstReviewFindings && context.attempt > 0)
            assert.ok(context.feedback.includes("Improve behavior"));
          options.sessionManager!.appendMessage({
            role: "user",
            content: text,
            timestamp: Date.now(),
          });
          if (implementer)
            await writeFile(
              join(options.cwd!, "source.txt"),
              `implemented-${context.attempt}`,
            );
          const findings =
            !implementer && firstReviewFindings && context.attempt === 0;
          const result = implementer
            ? {
                ...identity,
                status: "submitted",
                summary: "Implemented",
                verificationPlan: verificationPlan(),
                evidence: [{ criterionId: "works", references: ["test"] }],
              }
            : {
                ...identity,
                verdict: findings ? "changes_requested" : "accepted",
                summary: findings ? "Fix behavior" : "Verified",
                findings: findings
                  ? [{ id: "fix", text: "Improve behavior" }]
                  : [],
                criteria: [
                  {
                    criterionId: "works",
                    satisfied: !findings,
                    references: ["test"],
                  },
                ],
              };
          const tool = options.customTools!.find(
            (t) =>
              t.name ===
              (implementer ? "submit_implementation" : "submit_review"),
          )!;
          const response = await tool.execute(
            "submit",
            { result },
            undefined,
            undefined,
            undefined as never,
          );
          if (response.isError) throw new Error(JSON.stringify(response));
        },
      },
    };
  };
}
