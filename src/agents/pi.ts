import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
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
import type { ExecutionAgentProfile } from "../domain/configuration.js";
import { logEvent, readJson, writeJson } from "../workspace/storage.js";
import { createSubmitImplementationTool } from "./tools/submission/submitImplementation.js";
import { createSubmitReviewTool } from "./tools/submission/submitReview.js";
import { createSubmissionTool } from "./tools/submission/shared.js";

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
  systemPrompt?: string;
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
  const completionName = rolePolicy[request.role].completion;
  const completionOptions = {
    schema: request.schema,
    validate: (value: T) => request.validate(value),
  };
  const completion =
    request.role === "implementer"
      ? createSubmitImplementationTool(completionOptions)
      : request.role === "reviewer"
        ? createSubmitReviewTool(completionOptions)
        : createSubmissionTool(completionName, completionOptions);
  const definitions = new Map<string, ToolDefinition>();
  for (const definition of [...(request.customTools ?? []), completion.tool]) {
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
      [
        profile.instructions,
        request.systemPrompt ?? "",
        await repositoryContext(request.cwd),
      ].join("\n\n"),
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
    if (!completion.submission && !request.signal?.aborted)
      await session.prompt(
        `Correction: ${completion.failure}. Call ${completionName} once with a valid result bound to the supplied task, attempt, and revision.`,
      );
    await logging;
    if (logFailure)
      throw new Error("Could not persist agent audit log", {
        cause: logFailure,
      });
    if (request.signal?.aborted) throw new Error("Agent cancelled");
    if (!completion.submission)
      throw new Error(`Unsuccessful ${request.role}: ${completion.failure}`);
    return completion.submission;
  } finally {
    request.signal?.removeEventListener("abort", abort);
    unsubscribe();
    await session.abort();
    session.dispose();
    await logging;
  }
}
