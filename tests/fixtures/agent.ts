import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { join } from "node:path";
import type { SessionFactory } from "../../src/agents/pi.js";
import type { TaskContract } from "../../src/domain/contracts.js";
export function fixtureFactory(
  sessions: string[],
  firstReviewFindings = false,
): SessionFactory {
  return async (options) => {
    sessions.push(options.sessionManager!.getSessionId());
    const system = options.resourceLoader!.getSystemPrompt()!;
    const line = system.split("\n").find((l) => l.startsWith('{"contract":'))!;
    const context = JSON.parse(line) as {
      contract: TaskContract;
      runId: string;
      attempt: number;
      revision: string;
      feedback: string;
    };
    const implementer = options.tools!.includes("submit_implementation");
    const identity = {
      runId: context.runId,
      taskId: context.contract.taskId,
      version: context.contract.version,
      attempt: context.attempt,
      revision: context.revision,
    };
    return {
      session: {
        subscribe: () => () => {},
        abort: async () => {},
        dispose: () => {},
        prompt: async (text) => {
          if (implementer) assert.equal(text, context.contract.tasks);
          else assert.ok(text.startsWith(context.contract.tasks));
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
