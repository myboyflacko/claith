import { join } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { z } from "zod";
import type {
  AgentResult,
  AttemptInput,
  Implementation,
  Review,
  ReviewInput,
} from "../domain/contracts.js";
import { readJson, writeJson } from "../workspace/storage.js";
import { runRole } from "./pi.js";
import type { SessionFactory } from "./pi.js";
export interface AgentContext extends Omit<AttemptInput, "contract"> {
  root: string;
  signal?: AbortSignal;
  factory?: SessionFactory;
}
export async function invokeAgent<T extends Implementation | Review>(
  context: AgentContext,
  input: AttemptInput,
  role: "implementer" | "reviewer",
  schema: z.ZodType<T>,
  template: string,
  customTools: ToolDefinition[],
  revision: string,
  validate: (value: T) => Promise<void> | void,
): Promise<AgentResult<T>> {
  const directory = join(
    input.workspace.artifactDir,
    `${role}-${input.attempt}`,
  );
  const file = join(directory, "result.json");
  const prior = await readJson<AgentResult<T>>(file);
  if (prior) {
    await validate(schema.parse(prior.submission));
    return prior;
  }
  const review = role === "reviewer" ? (input as ReviewInput) : undefined;
  const submission = await runRole(
    {
      role,
      cwd: input.workspace.path,
      directory,
      profile: input.configuration.agents[role],
      logPath: join(
        context.root,
        "log",
        `${input.runId}-${role}-${input.attempt}.jsonl`,
      ),
      systemPrompt: template,
      prompt: JSON.stringify({
        task: input.contract,
        runId: input.runId,
        attempt: input.attempt,
        revision,
        feedback: input.feedback,
        ...(review
          ? { candidate: review.candidate, checks: review.checks }
          : {}),
      }),
      schema,
      customTools,
      validate,
      ...(context.signal ? { signal: context.signal } : {}),
      correlation: {
        runId: input.runId,
        taskId: input.contract.taskId,
        attempt: input.attempt,
      },
    },
    context.factory,
  );
  const manifest = await readJson<{ id: string }>(
    join(directory, "session.json"),
  );
  if (!manifest?.id) throw new Error("Missing Pi session identity");
  const result = { sessionId: manifest.id, submission };
  await writeJson(file, result);
  return result;
}
