import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeConfiguration } from "../src/configuration.js";
import type { SessionSnapshot } from "../src/domain/contracts.js";

const doubles = vi.hoisted(() => ({
  commands: [] as string[],
  connect: vi.fn(),
  runtime: vi.fn(),
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
  DeliveryClient: { connect: doubles.connect },
}));
vi.mock("../src/runtime/worker.js", () => ({ runRuntime: doubles.runtime }));
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
  vi.resetAllMocks();
  doubles.connect.mockResolvedValue(doubles.client);
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

function statusSnapshot(populated: boolean): SessionSnapshot {
  const contract = {
    taskId: "task",
    version: 1,
    startingRevision: "a".repeat(40),
    title: "Example",
    outcome: "Example outcome",
    boundaries: ["Local only"],
    dependencies: [],
    acceptance: [
      {
        id: "test",
        text: "Test passes",
        mode: "check" as const,
        checkId: "test",
      },
    ],
    setup: [],
    checks: [{ id: "test", command: "npm test" }],
    review: true,
    endpoint: "local-commit" as const,
  };
  return {
    sessionId: "session",
    project: "/existing/project",
    state: populated ? "waiting" : "idle",
    currentTask: populated
      ? {
          executionId: "execution",
          contract,
          attempt: 2,
          repairsUsed: 1,
          state: "waiting",
        }
      : null,
    pendingEscalation: populated
      ? {
          id: "question",
          executionId: "execution",
          kind: "repair",
          question: "Continue?",
          criteria: ["test"],
          reminders: 2,
        }
      : null,
    proposal: populated
      ? {
          message: "Proposed",
          outline: [{ taskId: "task", title: "Example", dependencies: [] }],
          contract,
          goalComplete: false,
        }
      : null,
    outline: [{ taskId: "task", title: "Example", dependencies: [] }],
    acceptedResults: [
      {
        taskId: "previous",
        executionId: "previous-execution",
        acceptedCommit: "b".repeat(40),
        workspace: {
          path: "/worktree",
          branch: "feature/example",
          base: "a".repeat(40),
          artifactDir: "/artifacts",
        },
        checks: [
          {
            id: "test",
            command: "npm test",
            exitCode: null,
            outputRef: "/output",
            revision: "b".repeat(40),
            unchanged: true,
          },
        ],
        review: null,
        evidence: [{ criterionId: "test", references: ["/output"] }],
        humanConfirmations: [],
        blockers: [],
      },
    ],
    conversation: [{ id: "message", text: "A message\nwith a newline" }],
    messages: ["A diagnostic stored in the snapshot"],
  };
}

describe("read-only JSON status", () => {
  it.each([false, true])(
    "preserves the entire snapshot (populated=%s)",
    async (populated) => {
      const snapshot = statusSnapshot(populated);
      doubles.client.status.mockResolvedValue(snapshot);
      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      await runCli(["status", "--session", "session", "--json"], root);
      expect(doubles.connect).toHaveBeenCalledTimes(1);
      expect(doubles.client.status).toHaveBeenCalledExactlyOnceWith("session");
      expect(output).toHaveBeenCalledExactlyOnceWith(JSON.stringify(snapshot));
      expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual(snapshot);
      expect(errors).not.toHaveBeenCalled();
      expect(doubles.client.close).toHaveBeenCalledTimes(1);
      for (const method of [
        "create",
        "cancel",
        "conversation",
        "approve",
        "answer",
      ] as const)
        expect(doubles.client[method]).not.toHaveBeenCalled();
      expect(doubles.runtime).not.toHaveBeenCalled();
    },
  );

  it.each([
    { args: ["status", "--json"], diagnostic: "requires --session" },
    {
      args: ["status", "--session", "", "--json"],
      diagnostic: "requires --session",
    },
    { args: ["status", "--session", "session"], diagnostic: "requires --json" },
  ])(
    "validates arguments before connecting: $args",
    async ({ args, diagnostic }) => {
      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      await expect(runCli(args, root)).rejects.toThrow(diagnostic);
      expect(output).not.toHaveBeenCalled();
      expect(doubles.connect).not.toHaveBeenCalled();
    },
  );

  it.each(["Unknown session", "Query failed"])(
    "closes after %s without output",
    async (message) => {
      doubles.client.status.mockRejectedValue(new Error(message));
      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      await expect(
        runCli(["status", "--session", "session", "--json"], root),
      ).rejects.toThrow(message);
      expect(output).not.toHaveBeenCalled();
      expect(doubles.client.close).toHaveBeenCalledTimes(1);
    },
  );

  it("does not output or close an unconnected client", async () => {
    doubles.connect.mockRejectedValue(new Error("Connection failed"));
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(
      runCli(["status", "--session", "session", "--json"], root),
    ).rejects.toThrow("Connection failed");
    expect(output).not.toHaveBeenCalled();
    expect(doubles.client.close).not.toHaveBeenCalled();
  });
});

// Node's process-local module hook replaces only the client boundary. Both real
// entrypoints, argument parsing, configuration loading and top-level errors run.
const clientHook = `
import { registerHooks } from "node:module";
registerHooks({
  load(url, context, nextLoad) {
    if (!/\\/src\\/runtime\\/client\\.ts$|\\/dist\\/runtime\\/client\\.js$/.test(url))
      return nextLoad(url, context);
    return { format: "module", shortCircuit: true, source: \`
      import { appendFileSync } from "node:fs";
      const record = (event) => appendFileSync(process.env.CLAITH_TEST_TRACE, JSON.stringify(event) + "\\\\n");
      export const DeliveryClient = {
        async connect(settings) {
          record(["connect", settings.address]);
          if (process.env.CLAITH_TEST_FAILURE === "connection") throw new Error("Connection failed");
          return {
            async status(session) {
              record(["status", session]);
              if (session !== "session") throw new Error("Unknown session: " + session);
              if (process.env.CLAITH_TEST_FAILURE === "query") throw new Error("Query failed");
              return JSON.parse(process.env.CLAITH_TEST_SNAPSHOT);
            },
            async close() { record(["close"]); }
          };
        }
      };
    \` };
  }
});
`;

describe.each(["development", "compiled"] as const)(
  "%s status entrypoint",
  (entrypoint) => {
    async function execute(args: string[], failure = "") {
      const home = join(root, "home");
      await initializeConfiguration(join(home, ".claith"));
      for (const role of ["orchestrator", "implementer", "reviewer"]) {
        await writeFile(
          join(home, ".claith", "agents", `${role}.toml`),
          'provider = "double"\nmodel = "double"\ninstructions = "test"\n',
        );
      }
      const hook = join(root, "client-hook.mjs");
      const trace = join(root, "trace.jsonl");
      await writeFile(hook, clientHook);
      await writeFile(trace, "");
      const result = await promisify(execFile)(
        "npm",
        [
          "--silent",
          ...(entrypoint === "development" ? ["run", "dev"] : ["start"]),
          "--",
          ...args,
        ],
        {
          timeout: 20_000,
          env: {
            ...process.env,
            HOME: home,
            NODE_OPTIONS: `--import=${pathToFileURL(hook).href}`,
            CLAITH_TEST_TRACE: trace,
            CLAITH_TEST_SNAPSHOT: JSON.stringify(statusSnapshot(true)),
            CLAITH_TEST_FAILURE: failure,
          },
        },
      ).then(
        (output) => ({ ...output, code: 0 }),
        (error: unknown) => {
          const result = error as {
            stdout: string;
            stderr: string;
            code: number;
          };
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            code: result.code,
          };
        },
      );
      const events: unknown[] = (await readFile(trace, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      return { ...result, events };
    }

    it("emits exactly one complete JSON document", async () => {
      const result = await execute([
        "status",
        "--session",
        "session",
        "--json",
      ]);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe(JSON.stringify(statusSnapshot(true)) + "\n");
      expect(JSON.parse(result.stdout)).toEqual(statusSnapshot(true));
      expect(result.events).toEqual([
        ["connect", "127.0.0.1:7233"],
        ["status", "session"],
        ["close"],
      ]);
    });

    it.each([
      {
        session: "unknown",
        failure: "",
        diagnostic: "Unknown session: unknown",
        events: [
          ["connect", "127.0.0.1:7233"],
          ["status", "unknown"],
          ["close"],
        ],
      },
      {
        session: "session",
        failure: "connection",
        diagnostic: "Connection failed",
        events: [["connect", "127.0.0.1:7233"]],
      },
      {
        session: "session",
        failure: "query",
        diagnostic: "Query failed",
        events: [
          ["connect", "127.0.0.1:7233"],
          ["status", "session"],
          ["close"],
        ],
      },
      {
        session: null,
        failure: "",
        diagnostic: "status requires --session",
        events: [],
      },
    ])(
      "fails without JSON: $diagnostic",
      async ({ session, failure, diagnostic, events }) => {
        const result = await execute(
          ["status", ...(session ? ["--session", session] : []), "--json"],
          failure,
        );
        expect(result.code).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain(diagnostic);
        expect(result.events).toEqual(events);
      },
    );
  },
);
