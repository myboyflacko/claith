import { describe, expect, it, vi } from "vitest";
import { displaySnapshot, submitChatLine } from "../src/cli/chat.js";
import type { ExecutionConfiguration } from "../src/configuration.js";
import type { SessionSnapshot } from "../src/domain/contracts.js";

const snapshot: SessionSnapshot = {
  sessionId: "session",
  project: "/project",
  state: "waiting",
  currentTask: null,
  pendingEscalation: {
    id: "question",
    executionId: "execution",
    kind: "repair",
    question: "Continue?",
    criteria: [],
    reminders: 2,
  },
  proposal: null,
  outline: [],
  acceptedResults: [],
  conversation: [],
  messages: [],
};
function client() {
  return {
    conversation: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
    status: vi.fn(),
    cancel: vi.fn(),
  };
}
describe("terminal control", () => {
  it("disconnects without cancelling execution", async () => {
    const c = client();
    expect(
      await submitChatLine("/quit", snapshot, c, {} as ExecutionConfiguration),
    ).toBe("quit");
    expect(c.cancel).not.toHaveBeenCalled();
  });
  it("scopes bounded continuation to the displayed question and execution", async () => {
    const c = client();
    await submitChatLine(
      "/continue question 2 Fix the input",
      snapshot,
      c,
      {} as ExecutionConfiguration,
    );
    expect(c.answer).toHaveBeenCalledWith(
      "session",
      expect.objectContaining({
        escalationId: "question",
        executionId: "execution",
        additionalRepairs: 2,
        answer: "Fix the input",
      }),
    );
    await expect(
      submitChatLine(
        "/continue old 2 Retry",
        snapshot,
        c,
        {} as ExecutionConfiguration,
      ),
    ).rejects.toThrow("current question");
    expect(displaySnapshot(snapshot)).toContain("Question question");
  });
  it("requires a displayed contract and preserves cancellation as a distinct command", async () => {
    const c = client();
    await expect(
      submitChatLine("/approve", snapshot, c, {} as ExecutionConfiguration),
    ).rejects.toThrow("No displayed contract");
    await submitChatLine("/cancel", snapshot, c, {} as ExecutionConfiguration);
    expect(c.cancel).toHaveBeenCalledWith("session");
  });
});
