import { describe, expect, it } from "vitest";
import { buildImplementerPrompt } from "../../../src/agents/prompts/user/implementer.js";
import { buildReviewerPrompt } from "../../../src/agents/prompts/user/reviewer.js";
import { buildCorrectionPrompt } from "../../../src/agents/prompts/user/correction.js";

const contract = {
  taskId: "task",
  version: 1,
  title: "Example task",
  description: 'Support "quoted" values\nand newlines.',
  acceptanceCriteria: [{ id: "works", text: "Requested behavior works" }],
};
const candidate = {
  revision: "b".repeat(40),
  diffRef: "/artifacts/candidate.diff",
  verificationPlan: {
    setup: [],
    checks: [{ id: "test", command: "npm test" }],
  },
};
const checks = [
  {
    id: "test",
    command: "npm test",
    exitCode: 0,
    outputRef: "/artifacts/check.log",
    revision: candidate.revision,
    unchanged: true,
  },
];

describe("agent request prompts", () => {
  it.each([
    [0, ""],
    [2, 'Address finding "fix"\nand retain unrelated work.'],
  ] as const)(
    "preserves the Implementer JSON protocol for attempt %s",
    (attempt, feedback) => {
      const revision = "a".repeat(40);
      const input = {
        contract,
        runId: "run-1",
        attempt,
        feedback,
        configuration: { secret: "not for the prompt" },
        workspace: { path: "/private/worktree" },
      };
      const prompt = buildImplementerPrompt(input, revision);
      expect(prompt).toBe(
        JSON.stringify({
          task: contract,
          runId: "run-1",
          attempt,
          revision,
          feedback,
        }),
      );
      expect(JSON.parse(prompt)).not.toHaveProperty("configuration");
      expect(JSON.parse(prompt)).not.toHaveProperty("workspace");
    },
  );

  it.each([0, 2])(
    "preserves the Reviewer JSON protocol for attempt %s",
    (attempt) => {
      const input = {
        contract,
        runId: "run-1",
        attempt,
        feedback: "Check the previous findings again.",
        candidate,
        checks,
        configuration: { secret: "not for the prompt" },
      };
      expect(buildReviewerPrompt(input, candidate.revision)).toBe(
        JSON.stringify({
          task: contract,
          runId: "run-1",
          attempt,
          revision: candidate.revision,
          feedback: input.feedback,
          candidate,
          checks,
        }),
      );
    },
  );

  it.each(["submit_implementation", "submit_review", "submit_proposal"])(
    "preserves the correction message for %s",
    (completionTool) => {
      expect(buildCorrectionPrompt("Stale task", completionTool)).toBe(
        `Correction: Stale task. Call ${completionTool} once with a valid result bound to the supplied task, attempt, and revision.`,
      );
    },
  );
});
