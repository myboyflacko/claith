import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "../src/agents/tools/implementer/bash.js";
import { createSubmitImplementationTool } from "../src/agents/tools/implementer/submitImplementation.js";
import { createReadDiffTool } from "../src/agents/tools/reviewer/readDiff.js";
import { createSubmitReviewTool } from "../src/agents/tools/reviewer/submitReview.js";
import { runCommand } from "../src/workspace/process.js";

vi.mock("../src/workspace/process.js", () => ({ runCommand: vi.fn() }));

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "claith-agent-tools-"));
  vi.mocked(runCommand).mockReset();
  vi.mocked(runCommand).mockImplementation(async (_command, options) => {
    await writeFile(options.output, "command output");
    return 0;
  });
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function execute(
  tool: ToolDefinition,
  parameters: Record<string, unknown>,
  id = "call",
  signal?: AbortSignal,
) {
  return tool.execute(id, parameters, signal, undefined, undefined as never);
}

function bash(signal?: AbortSignal) {
  return createBashTool({
    cwd: directory,
    artifactDir: directory,
    attempt: 2,
    timeoutSeconds: 10,
    ...(signal ? { signal } : {}),
  });
}

describe("implementer bash tool", () => {
  it.each([
    [undefined, 10000],
    [100, 10000],
    [0, 1000],
    [3, 3000],
  ])(
    "bounds timeout %s to %s ms and persists output",
    async (timeout, timeoutMs) => {
      const result = await execute(
        bash(),
        { command: "example", ...(timeout === undefined ? {} : { timeout }) },
        "call/unsafe",
      );
      const output = join(directory, "bash-2-call_unsafe.log");
      expect(runCommand).toHaveBeenCalledWith("example", {
        cwd: directory,
        output,
        timeoutMs,
      });
      expect(result).toMatchObject({
        details: { exitCode: 0, output },
        isError: false,
      });
      expect(result.content).toEqual([
        {
          type: "text",
          text: `command output\nExit: 0; full output: ${output}`,
        },
      ]);
      expect(await readFile(output, "utf8")).toBe("command output");
    },
  );

  it.each(["agent", "tool"])(
    "forwards %s cancellation to the process runner",
    async (source) => {
      const agent = new AbortController();
      const tool = new AbortController();
      await execute(
        bash(agent.signal),
        { command: "example" },
        "call",
        tool.signal,
      );
      const combined = vi.mocked(runCommand).mock.calls[0]![1].signal!;
      expect(combined.aborted).toBe(false);
      (source === "agent" ? agent : tool).abort();
      expect(combined.aborted).toBe(true);
    },
  );

  it("marks failures and limits returned output without truncating the saved log", async () => {
    const fullOutput = "prefix" + "x".repeat(48000);
    vi.mocked(runCommand).mockImplementation(async (_command, options) => {
      await writeFile(options.output, fullOutput);
      return 7;
    });
    const result = await execute(bash(), { command: "example" });
    const output = join(directory, "bash-2-call.log");
    expect(result).toMatchObject({ isError: true, details: { exitCode: 7 } });
    expect(result.content).toEqual([
      {
        type: "text",
        text: `${"x".repeat(48000)}\nExit: 7; full output: ${output}`,
      },
    ]);
    expect(await readFile(output, "utf8")).toBe(fullOutput);
  });
});

describe("reviewer diff tool", () => {
  it("returns the dispatched candidate diff and its revision", async () => {
    const diffRef = join(directory, "candidate.diff");
    await writeFile(diffRef, "+ reviewed change\n");
    const tool = createReadDiffTool({
      diffRef,
      revision: "candidate-revision",
    });
    expect(tool.name).toBe("read_diff");
    expect(await execute(tool, {})).toEqual({
      content: [{ type: "text", text: "+ reviewed change\n" }],
      details: { revision: "candidate-revision" },
    });
  });

  it("does not hide a missing candidate diff", async () => {
    const tool = createReadDiffTool({
      diffRef: join(directory, "missing.diff"),
      revision: "candidate-revision",
    });
    await expect(execute(tool, {})).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe.each([
  ["submit_implementation", createSubmitImplementationTool],
  ["submit_review", createSubmitReviewTool],
] as const)("%s tool", (name, createTool) => {
  it("rejects malformed and stale results, accepts corrections and rejects duplicates", async () => {
    const validate = vi.fn(async (value: { revision: string }) => {
      if (value.revision !== "current") throw new Error("Stale revision");
    });
    const completion = createTool({
      schema: z.strictObject({ revision: z.string() }),
      validate,
    });
    expect(completion.tool.name).toBe(name);
    expect(completion.submission).toBeNull();
    expect(completion.failure).toBe("No structured submission");
    expect(await execute(completion.tool, { result: {} })).toMatchObject({
      isError: true,
    });
    expect(validate).not.toHaveBeenCalled();
    expect(
      await execute(completion.tool, { result: { revision: "stale" } }),
    ).toMatchObject({ isError: true });
    expect(completion.submission).toBeNull();
    expect(completion.failure).toContain("Stale revision");
    expect(
      await execute(completion.tool, { result: { revision: "current" } }),
    ).toEqual({
      content: [{ type: "text", text: "Recorded. Finish your turn." }],
      details: {},
    });
    expect(completion.submission).toEqual({ revision: "current" });
    expect(
      await execute(completion.tool, { result: { revision: "other" } }),
    ).toMatchObject({ isError: true });
    expect(completion.failure).toContain("already been submitted");
    expect(completion.submission).toEqual({ revision: "current" });
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it("keeps submissions isolated between invocations", async () => {
    const options = {
      schema: z.strictObject({ revision: z.string() }),
      validate: () => {},
    };
    const first = createTool(options);
    const second = createTool(options);
    await execute(first.tool, { result: { revision: "first" } });
    expect(second.submission).toBeNull();
    expect(second.failure).toBe("No structured submission");
    await execute(second.tool, { result: { revision: "second" } });
    expect(first.submission).toEqual({ revision: "first" });
    expect(second.submission).toEqual({ revision: "second" });
  });
});
