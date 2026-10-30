import { describe, expect, it } from "vitest";
import {
  assertReview,
  assertImplementation,
  contractSchema,
  verificationPlanSchema,
} from "../src/domain/contracts.js";
import {
  taskInput,
  acceptedReview,
  verificationPlan,
} from "./fixtures/task.js";
function reviewInput() {
  return {
    ...taskInput(),
    workspace: {
      path: "/w",
      branch: "task",
      base: "a".repeat(40),
      artifactDir: "/a",
    },
    attempt: 0,
    feedback: "",
    candidate: {
      revision: "b".repeat(40),
      diffRef: "diff",
      verificationPlan: verificationPlan(),
    },
    checks: [
      {
        ...verificationPlan().checks[0]!,
        exitCode: 0,
        outputRef: "log",
        revision: "b".repeat(40),
        unchanged: true,
      },
    ],
  };
}
describe("task contract and review gates", () => {
  it("preserves Markdown in a five-field task", () => {
    const task = {
      ...taskInput().contract,
      description: "  ## Assignment\nDo this.\n",
    };
    expect(contractSchema.parse(task)).toEqual(task);
    expect(Object.keys(task).sort()).toEqual([
      "acceptanceCriteria",
      "description",
      "taskId",
      "title",
      "version",
    ]);
  });
  it.each([
    "startCommit",
    "setup",
    "checks",
    "configuration",
    "model",
    "tools",
    "tasks",
  ])("rejects execution field %s in a task", (field) => {
    expect(() =>
      contractSchema.parse({ ...taskInput().contract, [field]: "technical" }),
    ).toThrow();
  });
  it("requires nonempty description and unique behavioral criteria without check mapping", () => {
    const task = taskInput().contract;
    expect(() =>
      contractSchema.parse({ ...task, description: "  " }),
    ).toThrow();
    expect(() =>
      contractSchema.parse({ ...task, acceptanceCriteria: [] }),
    ).toThrow();
    expect(() =>
      contractSchema.parse({
        ...task,
        acceptanceCriteria: [
          ...task.acceptanceCriteria,
          ...task.acceptanceCriteria,
        ],
      }),
    ).toThrow("Duplicate");
    expect(() =>
      contractSchema.parse({
        ...task,
        acceptanceCriteria: [
          { ...task.acceptanceCriteria[0], mode: "check", checkId: "test" },
        ],
      }),
    ).toThrow();
  });
  it("requires executable checks and rejects duplicate or reserved plan IDs", () => {
    expect(() => verificationPlanSchema.parse({ checks: [] })).toThrow();
    expect(() =>
      verificationPlanSchema.parse({
        setup: verificationPlan().checks,
        checks: verificationPlan().checks,
      }),
    ).toThrow("Duplicate");
    expect(() =>
      verificationPlanSchema.parse({
        checks: [{ id: "diff", command: "true" }],
      }),
    ).toThrow("reserved");
  });
  it("requires submitted implementations to provide a plan and valid evidence", () => {
    const input = reviewInput();
    const value = {
      runId: input.runId,
      taskId: input.contract.taskId,
      version: 1,
      attempt: 0,
      revision: input.startCommit,
      status: "submitted" as const,
      summary: "Done",
      verificationPlan: null,
      evidence: [],
    };
    expect(() => assertImplementation(input, value, input.startCommit)).toThrow(
      "verification plan",
    );
    expect(() =>
      assertImplementation(
        input,
        {
          ...value,
          verificationPlan: verificationPlan(),
          evidence: [{ criterionId: "works", references: ["unknown"] }],
        },
        input.startCommit,
      ),
    ).toThrow("Unknown");
    expect(() =>
      assertImplementation(
        input,
        { ...value, status: "blocked" },
        input.startCommit,
      ),
    ).not.toThrow();
  });
  it("rejects acceptance with findings, stale revisions, omitted criteria or unrelated evidence", () => {
    const input = reviewInput();
    const review = acceptedReview(input);
    expect(() => assertReview(input, review)).not.toThrow();
    expect(() =>
      assertReview(input, {
        ...review,
        findings: [{ id: "finding", text: "Fix" }],
      }),
    ).toThrow("Acceptance");
    expect(() =>
      assertReview(input, { ...review, revision: "c".repeat(40) }),
    ).toThrow("Stale");
    expect(() => assertReview(input, { ...review, criteria: [] })).toThrow(
      "Acceptance",
    );
    expect(() =>
      assertReview(input, {
        ...review,
        criteria: [{ criterionId: "works", satisfied: true, references: [] }],
      }),
    ).toThrow("Acceptance");
    expect(() =>
      assertReview(input, {
        ...review,
        criteria: [
          { criterionId: "works", satisfied: true, references: ["unknown"] },
        ],
      }),
    ).toThrow("Unknown");
    input.checks[0]!.exitCode = 1;
    expect(() => assertReview(input, review)).toThrow("Acceptance");
  });
});
