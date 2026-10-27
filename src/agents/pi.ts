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
import type { Role } from "../configuration.js";
import { contractSchema, identity, revision } from "../domain/contracts.js";
import type {
  Activities,
  AttemptInput,
  Implementation,
  PlanInput,
  Proposal,
  Review,
} from "../domain/contracts.js";
import { assertRevision, git, readDiff, runSetup } from "../workspace/git.js";
import { withOwnership } from "../workspace/ownership.js";
import {
  logEvent,
  projectId,
  readJson,
  taskDirectory,
  writeJson,
} from "../workspace/storage.js";
import { runCommand } from "../workspace/process.js";

const evidence = z.array(
  z.strictObject({ criterionId: identity, references: z.array(z.string()) }),
);
const implementationSchema = z.strictObject({
  taskId: identity,
  attempt: z.number().int().nonnegative(),
  revision,
  status: z.enum(["submitted", "blocked"]),
  summary: z.string().min(1),
  evidence,
});
const reviewSchema = z.strictObject({
  taskId: identity,
  attempt: z.number().int().nonnegative(),
  revision,
  verdict: z.enum(["accepted", "changes_requested", "blocked"]),
  summary: z.string().min(1),
  evidenceRefs: z.array(z.string()),
});
const proposalSchema = z.strictObject({
  message: z.string().min(1),
  outline: z.array(
    z.strictObject({
      taskId: identity,
      title: z.string(),
      dependencies: z.array(identity),
    }),
  ),
  contract: contractSchema.nullable(),
  goalComplete: z.boolean(),
});
export interface RoleSession {
  prompt(text: string): Promise<unknown>;
  subscribe(listener: (event: unknown) => void): () => void;
  abort(): Promise<void>;
  dispose(): void;
}
export type SessionFactory = (
  options: CreateAgentSessionOptions,
) => Promise<{ session: RoleSession }>;
export const roleTools: Record<Role, string[]> = {
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
  profile: PlanInput["configuration"]["agents"][Role];
  prompt: string;
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
  await mkdir(request.directory, { recursive: true });
  if (request.signal?.aborted)
    throw new Error("Agent cancelled before dispatch");
  let submission: T | null = null;
  let failure = "No structured submission";
  const completionName =
    request.role === "orchestrator"
      ? "submit_proposal"
      : request.role === "implementer"
        ? "submit_implementation"
        : "submit_review";
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
  const sessionFile = join(request.directory, "session.json");
  const prior = await readJson<{ path: string }>(sessionFile);
  const manager = prior
    ? SessionManager.open(prior.path, request.directory, request.cwd)
    : SessionManager.create(request.cwd, request.directory);
  const modelRuntime =
    factory === createAgentSession ? await ModelRuntime.create() : undefined;
  const model = modelRuntime?.getModel(
    request.profile.provider,
    request.profile.model,
  );
  if (
    modelRuntime &&
    (!model || !modelRuntime.hasConfiguredAuth(request.profile.provider))
  ) {
    throw new Error(
      `Pi model/authentication unavailable: ${request.profile.provider}/${request.profile.model}; configure your existing Pi login and role profile`,
    );
  }
  const { session } = await factory({
    cwd: request.cwd,
    ...(modelRuntime ? { modelRuntime } : {}),
    ...(model ? { model } : {}),
    thinkingLevel: request.profile.reasoning,
    tools: [...roleTools[request.role]],
    customTools: [...(request.customTools ?? []), completion],
    sessionManager: manager,
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: false },
    }),
    resourceLoader: resources(
      `${request.profile.instructions}\n\n${await repositoryContext(request.cwd)}\n\n${
        request.role === "orchestrator"
          ? "Concretize only the next task. Preserve explicit dependencies. Propose local-commit contracts; never approve or execute them. Use increasing versions for revised contracts. Explain completion or ask for clarification when needed."
          : request.role === "implementer"
            ? "Implement only the approved contract. Do not merge, push, create PRs, or run nested Claith sessions. The runtime creates the candidate commit and runs checks. Include evidence for every non-human criterion; references can name approved check IDs or diff. Submit blocked when authority or inputs are missing."
            : "Review only the supplied candidate and check evidence. Use read_diff for the approved diff. Do not change files. Submit a verdict for this exact candidate."
      }`,
    ),
  });
  await writeJson(sessionFile, { path: manager.getSessionFile() });
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
): Pick<Activities, "plan" | "implement" | "review"> {
  const cancellation = signal ? { signal } : {};
  const logs = (session: string, operation: string) =>
    join(root, "log", `${session}-${operation}.jsonl`);
  return {
    plan: async (input: PlanInput): Promise<Proposal> => {
      const directory = taskDirectory(
        root,
        input.session.project,
        input.session.sessionId,
        "orchestrator",
      );
      await mkdir(directory, { recursive: true });
      return withOwnership(directory, async () => {
        const key = `${input.session.conversation.length}-${input.session.acceptedResults.length}-${input.session.messages.length}`;
        const file = join(directory, `proposal-${key}.json`);
        const prior = await readJson<Proposal>(file);
        if (prior) return prior;
        await writeJson(join(directory, `input-${key}.json`), input);
        const result = await runRole(
          {
            role: "orchestrator",
            cwd: input.session.project,
            directory,
            logPath: logs(input.session.sessionId, "orchestrator"),
            profile: input.configuration.agents.orchestrator,
            correlation: {
              projectId: projectId(input.session.project),
              sessionId: input.session.sessionId,
              executionId: "orchestrator",
              taskId: null,
              attempt: 0,
              revision: input.startingRevision,
            },
            schema: proposalSchema,
            validate: () => {},
            ...cancellation,
            prompt: `Prepare the next contract, clarify the goal, or report completion. Use startingRevision ${input.startingRevision}.\n${JSON.stringify(input.session)}`,
          },
          factory,
        );
        await writeJson(file, result);
        return result;
      });
    },
    implement: async (input: AttemptInput): Promise<Implementation> =>
      withOwnership(input.workspace.artifactDir, async () => {
        const file = join(
          input.workspace.artifactDir,
          `implementation-${input.attempt}.json`,
        );
        const prior = await readJson<Implementation>(file);
        if (prior) return prior;
        await runSetup(input, signal);
        const currentRevision = await git(
          input.workspace.path,
          "rev-parse",
          "HEAD",
        );
        const directory = join(input.workspace.artifactDir, "implementer");
        const bash: ToolDefinition = {
          name: "bash",
          label: "Bash",
          description:
            "Execute a command in this task's worktree; output is persisted",
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
            const timeoutMs =
              Math.max(
                1,
                Math.min(
                  args.timeout ??
                    input.configuration.runtime.checkTimeoutSeconds,
                  input.configuration.runtime.checkTimeoutSeconds,
                ),
              ) * 1000;
            const exitCode = await runCommand(args.command, {
              cwd: input.workspace.path,
              output,
              timeoutMs,
              ...(toolSignal || signal
                ? {
                    signal:
                      toolSignal && signal
                        ? AbortSignal.any([toolSignal, signal])
                        : (toolSignal ?? signal)!,
                  }
                : {}),
            });
            const text = (await readFile(output, "utf8")).slice(-48_000);
            return {
              content: [
                {
                  type: "text",
                  text: `${text}\nExit: ${exitCode}. Full output: ${output}`,
                },
              ],
              details: { exitCode, output },
              isError: exitCode !== 0,
            };
          },
        };
        const result = await runRole(
          {
            role: "implementer",
            cwd: input.workspace.path,
            directory,
            logPath: logs(input.sessionId, `${input.executionId}-implementer`),
            profile: input.configuration.agents.implementer,
            correlation: {
              projectId: projectId(input.project),
              sessionId: input.sessionId,
              executionId: input.executionId,
              taskId: input.contract.taskId,
              attempt: input.attempt,
              revision: currentRevision,
            },
            schema: implementationSchema,
            customTools: [bash],
            ...cancellation,
            prompt: `Approved contract and explicit dependency results: ${JSON.stringify(input.contract)}\n${JSON.stringify(input.dependencies)}\nTask ${input.contract.taskId}, attempt ${input.attempt}, revision ${currentRevision}.\nRepair feedback: ${input.feedback}`,
            validate: (value) => {
              if (
                value.taskId !== input.contract.taskId ||
                value.attempt !== input.attempt ||
                value.revision !== currentRevision
              )
                throw new Error("Stale implementation submission");
              if (
                value.evidence.some(
                  (e) =>
                    !input.contract.acceptance.some(
                      (a) => a.id === e.criterionId,
                    ) ||
                    e.references.some(
                      (r) =>
                        r !== "diff" &&
                        !input.contract.checks.some((c) => c.id === r),
                    ),
                )
              )
                throw new Error("Unknown acceptance evidence");
            },
          },
          factory,
        );
        const implementation: Implementation = {
          status: result.status,
          summary: result.summary,
          evidence: result.evidence,
        };
        await writeJson(file, implementation);
        return implementation;
      }),
    review: async (input): Promise<Review> =>
      withOwnership(input.workspace.artifactDir, async () => {
        await assertRevision(input.workspace, input.candidate.revision);
        const file = join(
          input.workspace.artifactDir,
          `review-${input.attempt}.json`,
        );
        const prior = await readJson<Review>(file);
        if (prior) return prior;
        const readDiffTool: ToolDefinition = {
          name: "read_diff",
          label: "Read candidate diff",
          description: "Read the exact approved candidate diff",
          parameters: Type.Object({}),
          execute: async () => ({
            content: [
              { type: "text", text: await readDiff(input.candidate.diffRef) },
            ],
            details: { revision: input.candidate.revision },
          }),
        };
        const result = await runRole(
          {
            role: "reviewer",
            cwd: input.workspace.path,
            directory: join(
              input.workspace.artifactDir,
              `reviewer-${input.candidate.revision}`,
            ),
            logPath: logs(
              input.sessionId,
              `${input.executionId}-reviewer-${input.attempt}`,
            ),
            profile: input.configuration.agents.reviewer,
            correlation: {
              projectId: projectId(input.project),
              sessionId: input.sessionId,
              executionId: input.executionId,
              taskId: input.contract.taskId,
              attempt: input.attempt,
              revision: input.candidate.revision,
            },
            schema: reviewSchema,
            customTools: [readDiffTool],
            ...cancellation,
            prompt: `Review task ${input.contract.taskId}, attempt ${input.attempt}, revision ${input.candidate.revision}.\n${JSON.stringify(input.contract)}\nRecorded checks: ${JSON.stringify(input.checks)}\nImplementation: ${JSON.stringify(input.candidate.implementation)}`,
            validate: (value) => {
              if (
                value.taskId !== input.contract.taskId ||
                value.attempt !== input.attempt ||
                value.revision !== input.candidate.revision
              )
                throw new Error("Stale review submission");
              if (
                value.evidenceRefs.some(
                  (ref) =>
                    ref !== "diff" && !input.checks.some((c) => c.id === ref),
                )
              )
                throw new Error("Unknown review evidence");
            },
          },
          factory,
        );
        await assertRevision(input.workspace, input.candidate.revision);
        await writeJson(file, result);
        return result;
      }),
  };
}
