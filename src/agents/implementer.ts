import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { withOwnership } from "../workspace/ownership.js";
import { readJson, writeJson } from "../workspace/storage.js";
import { runCommand } from "../workspace/process.js";
import { git } from "../workspace/git.js";
import {
  assertImplementation,
  implementationSchema,
} from "../domain/contracts.js";
import type { TaskContract } from "../domain/contracts.js";
import { invokeAgent } from "./execution.js";
import type { AgentContext } from "./execution.js";
import { implementerTemplate } from "./templates.js";
export function createImplementer(context: AgentContext) {
  return {
    run: async (task: TaskContract) => {
      const input = { ...context, contract: task };
      const signal = context.signal;
      return withOwnership(input.workspace.artifactDir, async () => {
        const commit = await git(input.workspace.path, "rev-parse", "HEAD");
        const bash: ToolDefinition = {
          name: "bash",
          label: "Bash",
          description:
            "Execute a command in the task worktree; output is persisted",
          parameters: Type.Object({
            command: Type.String(),
            timeout: Type.Optional(Type.Number()),
          }),
          execute: async (id, parameters, toolSignal) => {
            const args = parameters as { command: string; timeout?: number };
            const output = join(
              input.workspace.artifactDir,
              `bash-${input.attempt}-${id.replace(/[^A-Za-z0-9_-]/g, "_")}.log`,
            );
            const signals = [signal, toolSignal].filter(
              (s): s is AbortSignal => !!s,
            );
            const exitCode = await runCommand(args.command, {
              cwd: input.workspace.path,
              output,
              timeoutMs:
                Math.max(
                  1,
                  Math.min(
                    args.timeout ??
                      input.configuration.runtime.checkTimeoutSeconds,
                    input.configuration.runtime.checkTimeoutSeconds,
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
        // Preserve the original input revision across recovery after agent effects.
        const bindingFile = join(
          input.workspace.artifactDir,
          `implementer-${input.attempt}-input.json`,
        );
        const binding = (await readJson<{ revision: string }>(bindingFile)) ?? {
          revision: commit,
        };
        await writeJson(bindingFile, binding);
        return invokeAgent(
          context,
          input,
          "implementer",
          implementationSchema,
          implementerTemplate,
          [bash],
          binding.revision,
          (value) => {
            assertImplementation(input, value, binding.revision);
          },
        );
      });
    },
  };
}
