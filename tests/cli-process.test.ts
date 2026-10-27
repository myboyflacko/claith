import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeConfiguration } from "../src/configuration.js";
import type { SessionSnapshot } from "../src/domain/contracts.js";

const doubles = vi.hoisted(() => ({
  commands: [] as string[],
  client: {
    create: vi.fn(),
    status: vi.fn(),
    close: vi.fn(),
    cancel: vi.fn(),
    conversation: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  },
}));
vi.mock("../src/runtime/client.js", () => ({
  DeliveryClient: { connect: async () => doubles.client },
}));
vi.mock("node:readline/promises", () => ({
  createInterface: () => ({
    close: () => {},
    async *[Symbol.asyncIterator]() {
      for (const command of doubles.commands) yield command;
    },
  }),
}));
import { runCli } from "../src/cli/index.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "claith-cli-"));
  await initializeConfiguration(root);
  for (const role of ["orchestrator", "implementer", "reviewer"]) {
    await writeFile(
      join(root, "agents", `${role}.toml`),
      'provider = "double"\nmodel = "double"\ninstructions = "test"\n',
    );
  }
  vi.clearAllMocks();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("CLI composition", () => {
  it("reconnects to the same pending question and quits without cancelling", async () => {
    const snapshot: SessionSnapshot = {
      sessionId: "session",
      project: root,
      state: "waiting",
      currentTask: null,
      pendingEscalation: {
        id: "same-question",
        executionId: "execution",
        kind: "repair",
        question: "Continue?",
        criteria: [],
        reminders: 0,
      },
      proposal: null,
      outline: [],
      acceptedResults: [],
      conversation: [],
      messages: [],
    };
    doubles.client.status.mockResolvedValue(snapshot);
    doubles.commands = ["/status", "/quit"];
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCli(["chat", "--project", root, "--session", "session"], root);
    await runCli(["chat", "--project", root, "--session", "session"], root);
    expect(doubles.client.create).not.toHaveBeenCalled();
    expect(doubles.client.cancel).not.toHaveBeenCalled();
    expect(doubles.client.close).toHaveBeenCalledTimes(2);
    expect(output.mock.calls.flat().join("\n")).toContain("same-question");
  });

  it("checks the project binding before opening a resumed conversation", async () => {
    doubles.client.status.mockResolvedValue({ project: "/another-project" });
    await expect(
      runCli(["chat", "--project", root, "--session", "session"], root),
    ).rejects.toThrow("another project");
    expect(doubles.client.close).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown development entrypoint commands with stderr and a failing exit", async () => {
    const exec = promisify(execFile);
    await expect(
      exec(
        process.execPath,
        ["--import", "tsx", "src/main.ts", "unknown-command"],
        { timeout: 10_000 },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("Unknown command"),
    });
  });
});
