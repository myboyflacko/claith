import { describe, expect, it } from "vitest";
import { implementerSystemPrompt } from "../../../../../src/infrastructure/configuration/agentProfiles/templates/implementer.js";
import { reviewerSystemPrompt } from "../../../../../src/infrastructure/configuration/agentProfiles/templates/reviewer.js";

const contract = {
  taskId: "task",
  version: 1,
  title: "Example task",
  description: 'Support "quoted" values\nand newlines.',
  acceptanceCriteria: [{ id: "works", text: "Requested behavior works" }],
};

describe("agent system prompts", () => {
  it("keeps Implementer instructions separate from per-task data", () => {
    expect(implementerSystemPrompt).toContain("# Claith Implementer");
    expect(implementerSystemPrompt).toContain(
      "Submit via submit_implementation",
    );
    expect(implementerSystemPrompt).toContain("Do not commit, merge, push");
    expect(implementerSystemPrompt).not.toContain(contract.description);
  });

  it("keeps Reviewer read-only and evidence requirements", () => {
    expect(reviewerSystemPrompt).toContain("# Claith Reviewer");
    expect(reviewerSystemPrompt).toContain("Use submit_review");
    expect(reviewerSystemPrompt).toContain("You are read-only.");
    expect(reviewerSystemPrompt).toContain(
      "Passing checks alone do not establish acceptance",
    );
    expect(reviewerSystemPrompt).not.toContain(contract.description);
  });
});
