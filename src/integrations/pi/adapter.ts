import { mkdir } from "node:fs/promises";
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
import type { AgentSession } from "../../application/agentSession.js";
import type { AgentDefinition } from "../../domain/agents.js";

export interface PiSessionOptions {
  agent: Pick<AgentDefinition, "model" | "developerInstructions" | "tools">;
  cwd: string;
  directory: string;
  systemPrompt?: string;
  reasoning?: CreateAgentSessionOptions["thinkingLevel"];
  customTools?: ToolDefinition[];
  settings?: Parameters<typeof SettingsManager.inMemory>[0];
  /** Open this transcript instead of creating a new session. */
  sessionFile?: string;
  /** Optional explicit model/auth runtime; otherwise use Pi's configured runtime. */
  modelRuntime?: ModelRuntime;
}

export interface PiSdkSession {
  prompt(text: string): Promise<unknown>;
  abort(): Promise<void>;
  dispose(): void;
}

/** Injection seam for tests; SDK types remain confined to the integration. */
export type PiSessionFactory = (
  options: CreateAgentSessionOptions,
) => Promise<{ session: PiSdkSession }>;

function resources(systemPrompt: string): ResourceLoader {
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
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

/** Translate a prepared configuration into a session, without selecting roles or tools. */
export async function createPiSession(
  options: PiSessionOptions,
  factory: PiSessionFactory = createAgentSession,
): Promise<AgentSession> {
  const runtime = options.modelRuntime ?? (await ModelRuntime.create());
  const { provider, name } = options.agent.model;
  const model = runtime.getModel(provider, name);
  if (!model || !runtime.hasConfiguredAuth(provider))
    throw new Error(`Pi model/authentication unavailable: ${provider}/${name}`);

  await mkdir(options.directory, { recursive: true });
  const manager = options.sessionFile
    ? SessionManager.open(options.sessionFile, options.directory, options.cwd)
    : SessionManager.create(options.cwd, options.directory);
  const { session } = await factory({
    cwd: options.cwd,
    modelRuntime: runtime,
    model,
    ...(options.reasoning ? { thinkingLevel: options.reasoning } : {}),
    tools: [...options.agent.tools],
    customTools: [...(options.customTools ?? [])],
    sessionManager: manager,
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: true },
      retry: { enabled: false },
      ...options.settings,
    }),
    resourceLoader: resources(
      [options.agent.developerInstructions, options.systemPrompt ?? ""].join(
        "\n\n",
      ),
    ),
  });

  let disposed = false;
  let sending = false;
  let disposal: Promise<void> | undefined;
  return {
    id: manager.getSessionId(),
    get transcriptPath() {
      return manager.getSessionFile();
    },
    async sendPrompt(prompt) {
      if (disposed) throw new Error("Agent session is disposed");
      if (sending)
        throw new Error("Agent session already has an active prompt");
      sending = true;
      try {
        await session.prompt(prompt);
      } finally {
        sending = false;
      }
    },
    async abort() {
      if (!disposed) await session.abort();
    },
    dispose() {
      disposal ??= (async () => {
        disposed = true;
        try {
          await session.abort();
        } finally {
          session.dispose();
        }
      })();
      return disposal;
    },
  };
}
