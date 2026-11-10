import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrap } from "../../../src/infrastructure/bootstrap/bootstrap.js";
import { createDirectories } from "../../../src/infrastructure/configuration/directories/create.js";
import { createClaithConfig } from "../../../src/infrastructure/configuration/claithConfig/create.js";
import { createDefaultAgentProfiles } from "../../../src/infrastructure/configuration/agentProfiles/create.js";
import { appSettings } from "../../../src/infrastructure/settings.js";

vi.mock(
  "../../../src/infrastructure/configuration/directories/create.js",
  () => ({
    createDirectories: vi.fn(),
  }),
);
vi.mock(
  "../../../src/infrastructure/configuration/claithConfig/create.js",
  () => ({
    createClaithConfig: vi.fn(),
  }),
);
vi.mock(
  "../../../src/infrastructure/configuration/agentProfiles/create.js",
  () => ({
    createDefaultAgentProfiles: vi.fn(),
  }),
);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createDirectories).mockResolvedValue(undefined);
  vi.mocked(createClaithConfig).mockResolvedValue(undefined);
  vi.mocked(createDefaultAgentProfiles).mockResolvedValue(undefined);
});

describe("initialization bootstrap", () => {
  it("finishes directories before starting config and profiles concurrently, then awaits both", async () => {
    const directories = deferred();
    const config = deferred();
    const profiles = deferred();
    const settings = { configDir: "/custom/claith" };
    vi.mocked(createDirectories).mockReturnValue(directories.promise);
    vi.mocked(createClaithConfig).mockReturnValue(config.promise);
    vi.mocked(createDefaultAgentProfiles).mockReturnValue(profiles.promise);

    const work = bootstrap(settings);
    let finished = false;
    void work.then(() => {
      finished = true;
    });
    expect(createDirectories).toHaveBeenCalledExactlyOnceWith(settings);
    expect(createClaithConfig).not.toHaveBeenCalled();
    expect(createDefaultAgentProfiles).not.toHaveBeenCalled();

    directories.resolve();
    await Promise.resolve();
    expect(createClaithConfig).toHaveBeenCalledExactlyOnceWith(settings);
    expect(createDefaultAgentProfiles).toHaveBeenCalledExactlyOnceWith(
      settings,
    );
    config.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);
    profiles.resolve();
    await work;
    expect(finished).toBe(true);
  });

  it("uses the central settings by default", async () => {
    await bootstrap();
    expect(createDirectories).toHaveBeenCalledWith(appSettings);
    expect(createClaithConfig).toHaveBeenCalledWith(appSettings);
    expect(createDefaultAgentProfiles).toHaveBeenCalledWith(appSettings);
  });

  it("stops when directory creation fails", async () => {
    const failure = new Error("Blocked directory");
    vi.mocked(createDirectories).mockRejectedValue(failure);
    await expect(bootstrap()).rejects.toBe(failure);
    expect(createClaithConfig).not.toHaveBeenCalled();
    expect(createDefaultAgentProfiles).not.toHaveBeenCalled();
  });

  it.each(["config", "profiles"])(
    "propagates %s creation failures",
    async (step) => {
      const failure = new Error("Cannot create template");
      vi.mocked(
        step === "config" ? createClaithConfig : createDefaultAgentProfiles,
      ).mockRejectedValue(failure);
      await expect(bootstrap()).rejects.toBe(failure);
      expect(createClaithConfig).toHaveBeenCalledOnce();
      expect(createDefaultAgentProfiles).toHaveBeenCalledOnce();
    },
  );
});
