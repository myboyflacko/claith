import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Type } from "typebox";
import type {
  CreateAgentSessionOptions,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { runRole } from "../src/agents/pi.js";
import type { RoleRequest, SessionFactory } from "../src/agents/pi.js";
import type { Role } from "../src/configuration.js";
import { agentProfile } from "./fixtures/profiles.js";

let temp: string;
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), "claith-pi-"));
});
afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

function request(role: Role = "implementer"): RoleRequest<{ task: string }> {
  return {
    role,
    cwd: temp,
    directory: join(temp, "session"),
    logPath: join(temp, "events.jsonl"),
    profile: agentProfile(role),
    customTools:
      role === "orchestrator"
        ? []
        : [customTool(role === "implementer" ? "bash" : "read_diff")],
    schema: z.strictObject({ task: z.string() }),
    validate: (v) => {
      if (v.task !== "current") throw new Error("Stale task");
    },
    prompt: "Execute current task",
  };
}
function customTool(name: string): ToolDefinition {
  return {
    name,
    label: name,
    description: "Test tool",
    parameters: Type.Object({}),
    execute: async () => ({
      content: [{ type: "text", text: "done" }],
      details: {},
    }),
  };
}
async function submit(tool: ToolDefinition, result: unknown) {
  return tool.execute(
    "call",
    { result },
    undefined,
    undefined,
    undefined as never,
  );
}
function successfulFactory(
  receive: (options: CreateAgentSessionOptions) => void = () => {},
): SessionFactory {
  return async (options) => {
    receive(options);
    return {
      session: {
        subscribe: () => () => {},
        abort: async () => {},
        dispose: () => {},
        prompt: async (text) => {
          options.sessionManager!.appendMessage({
            role: "user",
            content: text,
            timestamp: Date.now(),
          });
          await submit(options.customTools!.at(-1)!, { task: "current" });
        },
      },
    };
  };
}
describe("Pi role protocol without paid calls", () => {
  it("filters supplied custom tools using the saved role permissions", async () => {
    const input = request();
    input.profile = agentProfile("implementer", { permissions: "read-only" });
    input.customTools!.push(customTool("read_diff"));
    const received: CreateAgentSessionOptions[] = [];
    await runRole(
      input,
      successfulFactory((options) => received.push(options)),
    );
    expect(received[0]!.tools).toEqual([
      "read",
      "grep",
      "find",
      "ls",
      "submit_implementation",
    ]);
    expect(received[0]!.customTools!.map((tool) => tool.name)).toEqual([
      "submit_implementation",
    ]);
  });

  it("keeps a saved tool subset when resuming instead of resolving the current registry", async () => {
    const input = request("reviewer");
    input.profile.tools = ["read", "submit_review"];
    const received: CreateAgentSessionOptions[] = [];
    const factory = successfulFactory((options) => received.push(options));
    await runRole(input, factory);
    await runRole(input, factory);
    expect(received[0]!.sessionManager!.getSessionId()).toBe(
      received[1]!.sessionManager!.getSessionId(),
    );
    for (const options of received) {
      expect(options.tools).toEqual(["read", "submit_review"]);
      expect(options.customTools!.map((tool) => tool.name)).toEqual([
        "submit_review",
      ]);
    }
  });

  it.each(["orchestrator", "reviewer"] as const)(
    "rejects elevated %s permissions before creating a session",
    async (role) => {
      const input = request(role);
      input.profile.permissions = "read-write";
      const factory = vi.fn(successfulFactory());
      await expect(runRole(input, factory)).rejects.toThrow(
        "must be read-only",
      );
      expect(factory).not.toHaveBeenCalled();
    },
  );

  it.each([
    [["unregistered"], "Unregistered custom tool"],
    [["read"], "Pi tool override"],
    [["bash", "bash"], "Duplicate custom tool: bash"],
    [
      ["bash", "submit_implementation"],
      "Duplicate custom tool: submit_implementation",
    ],
    [[], "Missing custom tool implementation: bash"],
  ] as const)(
    "rejects unsafe custom tool definitions %j",
    async (names, message) => {
      const input = request();
      input.customTools = names.map(customTool);
      const factory = vi.fn(successfulFactory());
      await expect(runRole(input, factory)).rejects.toThrow(message);
      expect(factory).not.toHaveBeenCalled();
    },
  );

  it("resumes the implementer transcript for repairs and opens distinct reviewer sessions", async () => {
    const ids: string[] = [];
    const factory: SessionFactory = async (options) => {
      const manager = options.sessionManager!;
      ids.push(manager.getSessionId());
      return {
        session: {
          subscribe: () => () => {},
          abort: async () => {},
          dispose: () => {},
          prompt: async (text) => {
            manager.appendMessage({
              role: "user",
              content: text,
              timestamp: Date.now(),
            });
            await submit(options.customTools!.at(-1)!, { task: "current" });
          },
        },
      };
    };
    await runRole(request(), factory);
    await runRole({ ...request(), prompt: "Repair the same task" }, factory);
    await runRole(
      { ...request("reviewer"), directory: join(temp, "candidate-one") },
      factory,
    );
    await runRole(
      { ...request("reviewer"), directory: join(temp, "candidate-two") },
      factory,
    );
    expect(ids[0]).toBe(ids[1]);
    expect(new Set(ids).size).toBe(3);
    const manifest = JSON.parse(
      await readFile(join(temp, "session", "session.json"), "utf8"),
    ) as { path: string };
    expect(await readFile(manifest.path, "utf8")).toContain(
      "Repair the same task",
    );
  });
  it.each(["orchestrator", "implementer", "reviewer"] as const)(
    "registers only the %s allowlist and persists audit events",
    async (role) => {
      let received: CreateAgentSessionOptions | undefined;
      const factory: SessionFactory = async (options) => {
        received = options;
        let emit: (event: unknown) => void = () => {};
        return {
          session: {
            subscribe: (listener) => {
              emit = listener;
              return () => {};
            },
            prompt: async () => {
              emit({ type: "tool_execution_start", toolCallId: "call" });
              await submit(options.customTools!.at(-1)!, { task: "current" });
              emit({ type: "tool_execution_end", toolCallId: "call" });
            },
            abort: async () => {},
            dispose: () => {},
          },
        };
      };
      expect(await runRole(request(role), factory)).toEqual({
        task: "current",
      });
      const expected = {
        orchestrator: ["read", "grep", "find", "ls", "submit_proposal"],
        implementer: [
          "read",
          "grep",
          "find",
          "ls",
          "edit",
          "write",
          "bash",
          "submit_implementation",
        ],
        reviewer: ["read", "grep", "find", "ls", "read_diff", "submit_review"],
      };
      expect(received!.tools).toEqual(expected[role]);
      expect(received!.customTools!.map((tool) => tool.name)).toEqual(
        role === "orchestrator"
          ? ["submit_proposal"]
          : role === "implementer"
            ? ["bash", "submit_implementation"]
            : ["read_diff", "submit_review"],
      );
      expect(received!.resourceLoader!.getExtensions().extensions).toEqual([]);
      expect(received!.resourceLoader!.getSkills().skills).toEqual([]);
      if (role === "reviewer")
        expect(received!.tools).not.toEqual(
          expect.arrayContaining(["bash", "write", "edit"]),
        );
      expect(await readFile(join(temp, "events.jsonl"), "utf8")).toContain(
        "tool_execution_end",
      );
      expect(
        JSON.parse(
          await readFile(join(temp, "session", "session.json"), "utf8"),
        ),
      ).toHaveProperty("path");
    },
  );

  it("rejects stale/malformed submissions and gives exactly one correction", async () => {
    let prompts = 0;
    const factory: SessionFactory = async (options) => ({
      session: {
        subscribe: () => () => {},
        abort: async () => {},
        dispose: () => {},
        prompt: async () => {
          prompts++;
          await submit(options.customTools!.at(-1)!, { task: "obsolete" });
        },
      },
    });
    await expect(runRole(request(), factory)).rejects.toThrow("Stale task");
    expect(prompts).toBe(2);
  });

  it("accepts a corrected submission and waits for agent completion", async () => {
    let prompts = 0;
    let finished = false;
    const factory: SessionFactory = async (options) => ({
      session: {
        subscribe: () => () => {},
        abort: async () => {},
        dispose: () => {},
        prompt: async () => {
          prompts++;
          if (prompts === 2) {
            await submit(options.customTools!.at(-1)!, { task: "current" });
            finished = true;
          }
        },
      },
    });
    expect(await runRole(request(), factory)).toEqual({ task: "current" });
    expect(finished).toBe(true);
    expect(prompts).toBe(2);
  });

  it("aborts active work on cancellation", async () => {
    const controller = new AbortController();
    let aborted = false;
    const factory: SessionFactory = async () => {
      let release: () => void = () => {};
      return {
        session: {
          subscribe: () => () => {},
          dispose: () => {},
          abort: async () => {
            aborted = true;
            release();
          },
          prompt: () =>
            new Promise<void>((resolve) => {
              release = resolve;
              controller.abort();
            }),
        },
      };
    };
    await expect(
      runRole({ ...request(), signal: controller.signal }, factory),
    ).rejects.toThrow("cancelled");
    expect(aborted).toBe(true);
  });
});
