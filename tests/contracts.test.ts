import { describe, expect, it } from "vitest";
import { assertReview, contractSchema } from "../src/domain/contracts.js";
import { taskInput, acceptedReview } from "./fixtures/task.js";
describe("task contract and review gates", () => {
  it("preserves the exact Markdown assignment and defaults setup", () => {
    const input = taskInput();
    input.contract.tasks = "  ## Assignment\nDo this.\n";
    expect(contractSchema.parse(input.contract).tasks).toBe(
      input.contract.tasks,
    );
    expect(input.contract.setup).toEqual([]);
  });
  it.each(["checks", "acceptanceCriteria"] as const)(
    "requires nonempty %s",
    (field) => {
      expect(() =>
        contractSchema.parse({ ...taskInput().contract, [field]: [] }),
      ).toThrow();
    },
  );
  it("rejects duplicate IDs and unknown check references", () => {
    const c = taskInput().contract;
    expect(() =>
      contractSchema.parse({ ...c, checks: [...c.checks, ...c.checks] }),
    ).toThrow("Duplicate");
    expect(() =>
      contractSchema.parse({
        ...c,
        acceptanceCriteria: [
          { ...c.acceptanceCriteria[0], checkId: "unknown" },
        ],
      }),
    ).toThrow("Invalid verification");
  });
  it("rejects acceptance with findings, stale revisions, omitted criteria or unrelated evidence", () => {
    const input = {
      ...taskInput(),
      workspace: {
        path: "/w",
        branch: "task",
        base: "a".repeat(40),
        artifactDir: "/a",
      },
      attempt: 0,
      feedback: "",
      candidate: { revision: "b".repeat(40), diffRef: "diff" },
      checks: [
        {
          id: "test",
          command: "test -f source.txt",
          exitCode: 0,
          outputRef: "log",
          revision: "b".repeat(40),
          unchanged: true,
        },
      ],
    };
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
        criteria: [
          { criterionId: "works", satisfied: true, references: ["diff"] },
        ],
      }),
    ).toThrow("Acceptance");
  });
});
