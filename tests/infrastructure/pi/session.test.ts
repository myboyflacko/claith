import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
  CreateAgentSessionOptions,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createPiSession } from "../../../src/infrastructure/pi/session.js";
import type { PiSessionOptions } from "../../../src/infrastructure/pi/session.js";

let root: string;
let directory: string;
let runtime: ModelRuntime;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "claith-pi-adapter-"));
  runtime = await ModelRuntime.create({
    authPath: join(root, "auth.json"),
    modelsPath: null,
    modelsStorePath: join(root, "models-cache.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
});
beforeEach(async () => {
  directory = await mkdtemp(join(root, "session-"));
  vi.spyOn(runtime, "hasConfiguredAuth").mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function options(): PiSessionOptions {
  const model = runtime.getModels()[0];
  if (!model) throw new Error("Offline Pi catalog has no models");
  return {
    agent: {
      model: { provider: model.provider, name: model.id },
      developerInstructions: "Configured developer instructions",
      tools: ["read"],
    },
    cwd: directory,
    directory: join(directory, "transcripts"),
    systemPrompt: "Supplied system prompt",
    reasoning: "high",
    modelRuntime: runtime,
  };
}

function sdkFixture() {
  const received: CreateAgentSessionOptions[] = [];
  const session = {
    prompt: vi.fn(async (text: string) => {
      received.at(-1)!.sessionManager!.appendMessage({
        role: "user",
        content: text,
        timestamp: Date.now(),
      });
    }),
    abort: vi.fn(async () => {}),
    dispose: vi.fn(() => {}),
  };
  const factory = vi.fn(async (configuration: CreateAgentSessionOptions) => {
    received.push(configuration);
    return { session };
  });
  return { session, factory, received };
}

describe("role-neutral Pi session adapter", () => {
  it("maps supplied configuration without looking up a role or adding tools", async () => {
    const configuration = options();
    const customTool: ToolDefinition = {
      name: "custom_check",
      label: "Custom check",
      description:
        "A caller-provided tool, independent of existing role policies",
      parameters: Type.Object({}),
      execute: async () => ({ content: [], details: {} }),
    };
    configuration.agent = {
      ...configuration.agent,
      tools: ["read", "custom_check"],
    };
    configuration.customTools = [customTool];
    configuration.settings = {
      compaction: { enabled: false },
      retry: { enabled: true },
    };
    const sdk = sdkFixture();
    const session = await createPiSession(configuration, sdk.factory);
    try {
      const received = sdk.received[0]!;
      expect(received.cwd).toBe(directory);
      expect(received.modelRuntime).toBe(runtime);
      expect(received.model?.provider).toBe(configuration.agent.model.provider);
      expect(received.model?.id).toBe(configuration.agent.model.name);
      expect(received.thinkingLevel).toBe("high");
      expect(received.tools).toEqual(["read", "custom_check"]);
      expect(received.customTools).toEqual([customTool]);
      expect(received.tools).not.toBe(configuration.agent.tools);
      expect(received.customTools).not.toBe(configuration.customTools);
      expect(received.settingsManager!.getCompactionEnabled()).toBe(false);
      expect(received.settingsManager!.getRetryEnabled()).toBe(true);
      expect(received.resourceLoader!.getSystemPrompt()).toBe(
        "Configured developer instructions\n\nSupplied system prompt",
      );
      expect(session.id).toBe(received.sessionManager!.getSessionId());
      expect(session.transcriptPath).toBe(
        received.sessionManager!.getSessionFile(),
      );
    } finally {
      await session.dispose();
    }
  });

  it("does not discover repository prompts, extensions or settings implicitly", async () => {
    await mkdir(join(directory, ".pi"));
    await writeFile(join(directory, ".pi", "settings.json"), "invalid JSON");
    await writeFile(join(directory, "AGENTS.md"), "Do not load me implicitly");
    const sdk = sdkFixture();
    const session = await createPiSession(options(), sdk.factory);
    try {
      const received = sdk.received[0]!;
      const resources = received.resourceLoader!;
      await resources.reload();
      expect(resources.getExtensions().extensions).toEqual([]);
      expect(resources.getSkills().skills).toEqual([]);
      expect(resources.getPrompts().prompts).toEqual([]);
      expect(resources.getAgentsFiles().agentsFiles).toEqual([]);
      expect(resources.getAppendSystemPrompt()).toEqual([]);
      expect(resources.getSystemPrompt()).not.toContain(
        "Do not load me implicitly",
      );
      expect(received.settingsManager!.getCompactionEnabled()).toBe(true);
      expect(received.settingsManager!.getRetryEnabled()).toBe(false);
    } finally {
      await session.dispose();
    }
  });

  it("forwards sequential prompts unchanged without selecting task templates or corrections", async () => {
    const sdk = sdkFixture();
    const session = await createPiSession(options(), sdk.factory);
    try {
      await expect(
        session.sendPrompt("First arbitrary prompt"),
      ).resolves.toBeUndefined();
      await session.sendPrompt("Second arbitrary prompt");
      expect(sdk.session.prompt.mock.calls).toEqual([
        ["First arbitrary prompt"],
        ["Second arbitrary prompt"],
      ]);
      expect(sdk.session.dispose).not.toHaveBeenCalled();
    } finally {
      await session.dispose();
    }
  });

  it("restores only an explicitly supplied transcript", async () => {
    const configuration = options();
    const sdk = sdkFixture();
    const first = await createPiSession(configuration, sdk.factory);
    await first.sendPrompt("Persisted first turn");
    const sessionFile = first.transcriptPath!;
    const id = first.id;
    await first.dispose();
    const restored = await createPiSession(
      { ...configuration, sessionFile },
      sdk.factory,
    );
    try {
      expect(restored.id).toBe(id);
      await restored.sendPrompt("Continued turn");
      const transcript = await readFile(restored.transcriptPath!, "utf8");
      expect(transcript).toContain("Persisted first turn");
      expect(transcript).toContain("Continued turn");
    } finally {
      await restored.dispose();
    }
    const fresh = await createPiSession(configuration, sdk.factory);
    try {
      expect(fresh.id).not.toBe(id);
    } finally {
      await fresh.dispose();
    }
  });

  it("uses Pi's configured model runtime when none is supplied", async () => {
    const createRuntime = vi
      .spyOn(ModelRuntime, "create")
      .mockResolvedValue(runtime);
    const configuration = options();
    delete configuration.modelRuntime;
    const sdk = sdkFixture();
    const session = await createPiSession(configuration, sdk.factory);
    try {
      expect(createRuntime).toHaveBeenCalledOnce();
      expect(sdk.received[0]!.modelRuntime).toBe(runtime);
    } finally {
      await session.dispose();
    }
  });

  it.each(["model", "authentication"])(
    "fails before SDK session creation for unavailable %s",
    async (missing) => {
      const configuration = options();
      if (missing === "model")
        configuration.agent = {
          ...configuration.agent,
          model: { provider: "missing-provider", name: "missing-model" },
        };
      else vi.mocked(runtime.hasConfiguredAuth).mockReturnValue(false);
      const sdk = sdkFixture();
      await expect(createPiSession(configuration, sdk.factory)).rejects.toThrow(
        "Pi model/authentication unavailable",
      );
      expect(sdk.factory).not.toHaveBeenCalled();
    },
  );

  it("rejects concurrent sends without steering the active prompt", async () => {
    const sdk = sdkFixture();
    let finish = () => {};
    sdk.session.prompt.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const session = await createPiSession(options(), sdk.factory);
    const pending = session.sendPrompt("Active prompt");
    try {
      await expect(session.sendPrompt("Overlapping prompt")).rejects.toThrow(
        "active prompt",
      );
      expect(sdk.session.prompt).toHaveBeenCalledTimes(1);
    } finally {
      finish();
      await pending;
      await session.dispose();
    }
  });

  it("forwards abort and releases a session exactly once", async () => {
    const sdk = sdkFixture();
    const session = await createPiSession(options(), sdk.factory);
    await session.abort();
    expect(sdk.session.abort).toHaveBeenCalledOnce();
    await session.dispose();
    await session.dispose();
    await session.abort();
    expect(sdk.session.abort).toHaveBeenCalledTimes(2);
    expect(sdk.session.dispose).toHaveBeenCalledOnce();
    await expect(session.sendPrompt("Too late")).rejects.toThrow("disposed");
    expect(sdk.session.prompt).not.toHaveBeenCalled();
  });

  it("aborts active work when disposed", async () => {
    const sdk = sdkFixture();
    let finish = () => {};
    sdk.session.prompt.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    sdk.session.abort.mockImplementation(async () => {
      finish();
    });
    const session = await createPiSession(options(), sdk.factory);
    const pending = session.sendPrompt("Active prompt");
    await session.dispose();
    await pending;
    expect(sdk.session.abort).toHaveBeenCalledOnce();
    expect(sdk.session.dispose).toHaveBeenCalledOnce();
  });

  it("propagates prompt failures without performing automatic retries", async () => {
    const sdk = sdkFixture();
    sdk.session.prompt.mockRejectedValueOnce(new Error("Prompt failed"));
    const session = await createPiSession(options(), sdk.factory);
    try {
      await expect(session.sendPrompt("Failing prompt")).rejects.toThrow(
        "Prompt failed",
      );
      expect(sdk.session.prompt).toHaveBeenCalledTimes(1);
      await session.sendPrompt("Caller-controlled follow-up");
      expect(sdk.session.prompt).toHaveBeenCalledTimes(2);
    } finally {
      await session.dispose();
    }
  });

  it("still releases the SDK session when abort fails during disposal", async () => {
    const sdk = sdkFixture();
    sdk.session.abort.mockRejectedValue(new Error("Abort failed"));
    const session = await createPiSession(options(), sdk.factory);
    await expect(session.dispose()).rejects.toThrow("Abort failed");
    await expect(session.dispose()).rejects.toThrow("Abort failed");
    expect(sdk.session.dispose).toHaveBeenCalledOnce();
    expect(sdk.session.abort).toHaveBeenCalledOnce();
  });
});
