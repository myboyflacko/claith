import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type {
  CreateAgentSessionOptions,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { roleTools, runRole } from "../src/agents/pi.js";
import type { RoleRequest, SessionFactory } from "../src/agents/pi.js";
import type { Role } from "../src/configuration.js";

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
    profile: {
      provider: "double",
      model: "double",
      reasoning: "medium",
      instructions: "Test role",
    },
    schema: z.strictObject({ task: z.string() }),
    validate: (v) => {
      if (v.task !== "current") throw new Error("Stale task");
    },
    prompt: "Execute current task",
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
describe("Pi role protocol without paid calls", () => {
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
      expect(received!.tools).toEqual(roleTools[role]);
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
