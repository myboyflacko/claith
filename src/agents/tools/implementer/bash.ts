import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { runCommand } from "../../../workspace/process.js";

export interface BashToolOptions {
  cwd: string;
  artifactDir: string;
  attempt: number;
  timeoutSeconds: number;
  signal?: AbortSignal;
}

export function createBashTool(options: BashToolOptions): ToolDefinition {
  return {
    name: "bash",
    label: "Bash",
    description: "Execute a command in the task worktree; output is persisted",
    parameters: Type.Object({
      command: Type.String(),
      timeout: Type.Optional(Type.Number()),
    }),
    execute: async (id, parameters, toolSignal) => {
      const args = parameters as { command: string; timeout?: number };
      const output = join(
        options.artifactDir,
        `bash-${options.attempt}-${id.replace(/[^A-Za-z0-9_-]/g, "_")}.log`,
      );
      const signals = [options.signal, toolSignal].filter(
        (signal): signal is AbortSignal => !!signal,
      );
      const exitCode = await runCommand(args.command, {
        cwd: options.cwd,
        output,
        timeoutMs:
          Math.max(
            1,
            Math.min(
              args.timeout ?? options.timeoutSeconds,
              options.timeoutSeconds,
            ),
          ) * 1000,
        ...(signals.length ? { signal: AbortSignal.any(signals) } : {}),
      });
      return {
        content: [
          {
            type: "text",
            text: `${(await readFile(output, "utf8")).slice(-48000)}\nExit: ${exitCode}; full output: ${output}`,
          },
        ],
        details: { exitCode, output },
        isError: exitCode !== 0,
      };
    },
  };
}
