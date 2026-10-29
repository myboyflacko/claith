import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import { z } from "zod";
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  CreateAgentSessionOptions,
  ResourceLoader,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { executionProfileSchema } from "../domain/configuration.js";
import { rolePolicy, toolRegistry } from "../domain/tools.js";
import type { Role } from "../configuration.js";
import {
  assertSubmission,
  assertReview,
  implementationSchema,
  reviewSchema,
} from "../domain/contracts.js";
import type {
  Activities,
  AttemptInput,
  ReviewInput,
  Implementation,
  Review,
  AgentResult,
} from "../domain/contracts.js";
import type { ExecutionAgentProfile } from "../domain/configuration.js";
import { git, assertRevision } from "../workspace/git.js";
import { withOwnership } from "../workspace/ownership.js";
import { logEvent, readJson, writeJson } from "../workspace/storage.js";
import { runCommand } from "../workspace/process.js";

export interface RoleSession {
  prompt(text: string): Promise<unknown>;
  subscribe(listener: (event: unknown) => void): () => void;
  abort(): Promise<void>;
  dispose(): void;
}
export type SessionFactory = (
  options: CreateAgentSessionOptions,
) => Promise<{ session: RoleSession }>;
function resources(prompt: string): ResourceLoader {
  return {
    getExtensions: () => ({
      extensions: [],
      errors: [],
      runtime: createExtensionRuntime(),
    }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => prompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}
async function repositoryContext(cwd: string): Promise<string> {
  const context: string[] = [];
  for (const file of [
    "AGENTS.md",
    "INDEX.md",
    "wiki/index.md",
    "wiki/project/project_goal.md",
  ]) {
    try {
      context.push(`${file}:\n${await readFile(join(cwd, file), "utf8")}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return context.join("\n\n");
}
export interface RoleRequest<T> {
  role: Role;
  cwd: string;
  directory: string;
  logPath: string;
  profile: ExecutionAgentProfile;
  prompt: string;
  context?: string;
  schema: z.ZodType<T>;
  validate: (value: T) => void | Promise<void>;
  customTools?: ToolDefinition[];
  signal?: AbortSignal;
  correlation?: Record<string, string | number | null>;
}
/** All model calls go through this seam; ordinary tests inject a session double. */
export async function runRole<T>(
  request: RoleRequest<T>,
  factory: SessionFactory = createAgentSession,
): Promise<T> {
  const profile = executionProfileSchema(request.role).parse(request.profile);
  if (request.signal?.aborted)
    throw new Error("Agent cancelled before dispatch");
  let submission: T | null = null;
  let failure = "No structured submission";
  const completionName = rolePolicy[request.role].completion;
  const completion: ToolDefinition = {
    name: completionName,
    label: completionName,
    description:
      "Submit the structured result for this exact invocation. Invalid or stale submissions are rejected.",
    parameters: Type.Object({
      result: Type.Unsafe(
        z.toJSONSchema(request.schema, { target: "draft-7" }),
      ),
    }),
    execute: async (_id, parameters) => {
      try {
        if (submission) throw new Error("A result has already been submitted");
        const result = request.schema.parse(
          (parameters as { result: unknown }).result,
        );
        await request.validate(result);
        submission = result;
        return {
          content: [{ type: "text", text: "Recorded. Finish your turn." }],
          details: {},
        };
      } catch (error) {
        failure = String(error);
        return {
          content: [{ type: "text", text: failure }],
          details: {},
          isError: true,
        };
      }
    },
  };
  const definitions = new Map<string, ToolDefinition>();
  for (const definition of [...(request.customTools ?? []), completion]) {
    if (toolRegistry.get(definition.name)?.source !== "custom")
      throw new Error(
        `Unregistered custom tool or Pi tool override: ${definition.name}`,
      );
    if (definitions.has(definition.name))
      throw new Error(`Duplicate custom tool: ${definition.name}`);
    definitions.set(definition.name, definition);
  }
  const customTools = profile.tools
    .filter((name) => toolRegistry.get(name)!.source === "custom")
    .map((name) => {
      const definition = definitions.get(name);
      if (!definition)
        throw new Error(`Missing custom tool implementation: ${name}`);
      return definition;
    });
  await mkdir(request.directory, { recursive: true });
  const sessionFile = join(request.directory, "session.json");
  const prior = await readJson<{ path: string }>(sessionFile);
  const manager = prior
    ? SessionManager.open(prior.path, request.directory, request.cwd)
    : SessionManager.create(request.cwd, request.directory);
  const modelRuntime =
    factory === createAgentSession ? await ModelRuntime.create() : undefined;
  const model = modelRuntime?.getModel(profile.provider, profile.model);
  if (
    modelRuntime &&
    (!model || !modelRuntime.hasConfiguredAuth(profile.provider))
  ) {
    throw new Error(
      `Pi model/authentication unavailable: ${profile.provider}/${profile.model}; configure your existing Pi login and role profile`,
    );
  }
  const { session } = await factory({
    cwd: request.cwd,
    ...(modelRuntime ? { modelRuntime } : {}),
    ...(model ? { model } : {}),
    thinkingLevel: profile.reasoning,
    tools: [...profile.tools],
    customTools,
    sessionManager: manager,
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: false },
    }),
    resourceLoader: resources(
      `${profile.instructions}\n\n${request.context ?? ""}\n\n${await repositoryContext(request.cwd)}\n\n${
        request.role === "orchestrator"
          ? "Concretize only the next task. Preserve explicit dependencies. Propose local-commit contracts; never approve or execute them. Use increasing versions for revised contracts. Explain completion or ask for clarification when needed."
          : request.role === "implementer"
            ? "Implement only the approved contract. Do not merge, push, create PRs, or run nested Claith sessions. The runtime creates the candidate commit and runs checks. Include evidence for every non-human criterion; references can name approved check IDs or diff. Submit blocked when authority or inputs are missing."
            : "Review only the supplied candidate and check evidence. Use read_diff for the approved diff. Do not change files. Submit a verdict for this exact candidate."
      }`,
    ),
  });
  await writeJson(sessionFile, {
    path: manager.getSessionFile(),
    id: manager.getSessionId(),
  });
  let logging = Promise.resolve();
  let logFailure: unknown = null;
  const unsubscribe = session.subscribe((event) => {
    logging = logging
      .then(() =>
        logEvent(request.logPath, {
          ...request.correlation,
          role: request.role,
          session: manager.getSessionId(),
          event,
        }),
      )
      .catch((error) => {
        logFailure = error;
      });
  });
  const abort = () => {
    void session.abort().catch((error) => {
      logFailure = error;
    });
  };
  request.signal?.addEventListener("abort", abort, { once: true });
  try {
    await session.prompt(request.prompt);
    if (!submission && !request.signal?.aborted)
      await session.prompt(
        `Correction: ${failure}. Call ${completionName} once with a valid result bound to the supplied task, attempt, and revision.`,
      );
    await logging;
    if (logFailure)
      throw new Error("Could not persist agent audit log", {
        cause: logFailure,
      });
    if (request.signal?.aborted) throw new Error("Agent cancelled");
    if (!submission)
      throw new Error(`Unsuccessful ${request.role}: ${failure}`);
    return submission;
  } finally {
    request.signal?.removeEventListener("abort", abort);
    unsubscribe();
    await session.abort();
    session.dispose();
    await logging;
  }
}

export function piActivities(
  root: string,
  signal?: AbortSignal,
  factory?: SessionFactory,
): Pick<Activities, "implement" | "review"> {
  async function invoke<T extends Implementation | Review>(
    input: AttemptInput,
    role: "implementer" | "reviewer",
    schema: z.ZodType<T>,
    prompt: string,
    customTools: ToolDefinition[],
    boundRevision: string,
    validate: (value: T) => Promise<void> | void,
  ): Promise<AgentResult<T>> {
    const directory = join(
      input.workspace.artifactDir,
      `${role}-${input.attempt}`,
    );
    const file = join(directory, "result.json");
    const prior = await readJson<AgentResult<T>>(file);
    if (prior) {
      await validate(prior.submission);
      return prior;
    }
    const submission = await runRole(
      {
        role,
        cwd: input.workspace.path,
        directory,
        profile: input.configuration.agents[role],
        logPath: join(
          root,
          "log",
          `${input.runId}-${role}-${input.attempt}.jsonl`,
        ),
        prompt,
        schema,
        customTools,
        validate,
        ...(signal ? { signal } : {}),
        correlation: {
          runId: input.runId,
          taskId: input.contract.taskId,
          attempt: input.attempt,
        },
        context: JSON.stringify({
          contract: input.contract,
          runId: input.runId,
          attempt: input.attempt,
          revision: boundRevision,
          feedback: input.feedback,
        }),
      },
      factory,
    );
    const manifest = await readJson<{ id: string }>(
      join(directory, "session.json"),
    );
    if (!manifest?.id) throw new Error("Missing Pi session identity");
    const result = { sessionId: manifest.id, submission };
    await writeJson(file, result);
    return result;
  }
  return {
    implement: async (input) =>
      withOwnership(input.workspace.artifactDir, async () => {
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
        return invoke(
          input,
          "implementer",
          implementationSchema,
          input.contract.tasks,
          [bash],
          binding.revision,
          (value) => {
            assertSubmission(input, value, binding.revision);
            if (
              value.evidence.some(
                (e) =>
                  !input.contract.acceptanceCriteria.some(
                    (a) => a.id === e.criterionId,
                  ) ||
                  e.references.some(
                    (r) =>
                      r !== "diff" &&
                      !input.contract.checks.some((c) => c.id === r),
                  ),
              )
            )
              throw new Error("Unknown implementation evidence");
          },
        );
      }),
    review: async (input: ReviewInput) =>
      withOwnership(input.workspace.artifactDir, async () => {
        await assertRevision(input.workspace, input.candidate.revision);
        const diff: ToolDefinition = {
          name: "read_diff",
          label: "Read candidate diff",
          description: "Read the exact candidate diff",
          parameters: Type.Object({}),
          execute: async () => ({
            content: [
              {
                type: "text",
                text: await readFile(input.candidate.diffRef, "utf8"),
              },
            ],
            details: { revision: input.candidate.revision },
          }),
        };
        return invoke(
          input,
          "reviewer",
          reviewSchema,
          `${input.contract.tasks}\n\nCandidate: ${input.candidate.revision}\nChecks: ${JSON.stringify(input.checks)}`,
          [diff],
          input.candidate.revision,
          async (value) => {
            assertReview(input, value);
            await assertRevision(input.workspace, input.candidate.revision);
          },
        );
      }),
  };
}
