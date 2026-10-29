import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeConfiguration } from "../src/configuration.js";
import { taskInput } from "./fixtures/task.js";
const doubles = vi.hoisted(() => ({
  client: {
    run: vi.fn(),
    status: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    close: vi.fn(),
  },
  connect: vi.fn(),
}));
vi.mock("../src/runtime/client.js", () => ({
  DeliveryClient: { connect: doubles.connect },
}));
import { runCli } from "../src/cli/index.js";
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "claith-cli-"));
  await initializeConfiguration(root);
  for (const role of ["orchestrator", "implementer", "reviewer"])
    await writeFile(
      join(root, "agents", `${role}.toml`),
      `provider = "double"\nmodel = "double"\ninstructions = "test"\npermissions = "${role === "implementer" ? "read-write" : "read-only"}"\n`,
    );
  vi.clearAllMocks();
  doubles.connect.mockResolvedValue(doubles.client);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
describe("direct task CLI", () => {
  it("submits a JSON contract directly and closes the client", async () => {
    const input = taskInput();
    await writeFile(join(root, "task.json"), JSON.stringify(input.contract));
    doubles.client.run.mockResolvedValue("run-1");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCli(
      ["run", "--project", root, "--contract", join(root, "task.json")],
      root,
    );
    expect(doubles.client.run).toHaveBeenCalledWith(
      root,
      input.contract,
      expect.anything(),
    );
    expect(output).toHaveBeenCalledWith("run-1");
    expect(doubles.client.close).toHaveBeenCalledOnce();
  });
  it("prints status as JSON and passes explicit extra repair authority", async () => {
    doubles.client.status.mockResolvedValue({
      execution: { status: "blocked" },
    });
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCli(["status", "--run", "run-1"], root);
    expect(
      JSON.parse(output.mock.calls[0]![0] as string).execution.status,
    ).toBe("blocked");
    await runCli(
      ["resume", "--run", "run-1", "--additional-repairs", "2"],
      root,
    );
    expect(doubles.client.resume).toHaveBeenCalledWith("run-1", 2);
    await runCli(["cancel", "--run", "run-1"], root);
    expect(doubles.client.cancel).toHaveBeenCalledWith("run-1");
  });
  it.each([
    ["chat"],
    ["status"],
    ["resume", "--run", "run-1", "--additional-repairs", "-1"],
    ["run", "--run", "run-1"],
  ])(
    "rejects obsolete or invalid arguments %j before connecting",
    async (...args) => {
      await expect(runCli(args, root)).rejects.toThrow();
      expect(doubles.connect).not.toHaveBeenCalled();
    },
  );
});
