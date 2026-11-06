import { join } from "node:path";
import { withOwnership } from "../workspace/ownership.js";
import { readJson, writeJson } from "../workspace/storage.js";
import { createBashTool } from "./tools/implementer/bash.js";
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
      return withOwnership(input.workspace.artifactDir, async () => {
        const commit = await git(input.workspace.path, "rev-parse", "HEAD");
        const bash = createBashTool({
          cwd: input.workspace.path,
          artifactDir: input.workspace.artifactDir,
          attempt: input.attempt,
          timeoutSeconds: input.configuration.runtime.checkTimeoutSeconds,
          ...(context.signal ? { signal: context.signal } : {}),
        });
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
