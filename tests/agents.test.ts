import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import type { ReviewInput } from "../src/domain/contracts.js";
import { createImplementer } from "../src/agents/implementer.js";
import { createReviewer } from "../src/agents/reviewer.js";
import type { SessionFactory } from "../src/agents/pi.js";
import { workspaceActivities } from "../src/workspace/git.js";
import { projectFixture } from "./fixtures/task.js";
import { fixtureFactory } from "./fixtures/agent.js";
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "claith-roles-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
describe("prepared task agents", () => {
  it.each([true, false])(
    "binds profiles, templates and runtime context outside the task (AGENTS.md: %s)",
    async (hasInstructions) => {
      const fixture = await projectFixture(directory);
      const { input, root } = fixture;
      input.configuration.agents.implementer.instructions =
        "IMPLEMENTER PROFILE INSTRUCTIONS";
      input.configuration.agents.reviewer.instructions =
        "REVIEWER PROFILE INSTRUCTIONS";
      const activities = workspaceActivities(root);
      const workspace = await activities.prepare(input);
      if (hasInstructions)
        await writeFile(
          join(workspace.path, "AGENTS.md"),
          "Use the repository's custom shell checks.",
        );
      const systems: string[] = [];
      const normal = fixtureFactory([]);
      const factory: SessionFactory = async (options) => {
        const system = options.resourceLoader!.getSystemPrompt()!;
        systems.push(system);
        expect(
          system.includes("Use the repository's custom shell checks."),
        ).toBe(hasInstructions);
        expect(system).not.toContain(input.contract.description);
        expect(system).not.toContain(
          input.configuration.agents.implementer.model,
        );
        const session = await normal(options);
        const prompt = session.session.prompt;
        session.session.prompt = async (text) => {
          const request = JSON.parse(text);
          expect(request.task).toEqual(input.contract);
          expect(request.runId).toBe(input.runId);
          expect(request).not.toHaveProperty("configuration");
          expect(request.task).not.toHaveProperty("startCommit");
          return prompt(text);
        };
        return session;
      };
      const { contract: task, ...run } = input;
      const context = {
        ...run,
        root,
        workspace,
        attempt: 0,
        feedback: "",
        factory,
      };
      const implementer = createImplementer(context);
      const result = await implementer.run(task);
      expect(result.submission.verificationPlan?.checks[0]!.command).toBe(
        "test -f source.txt",
      );
      const candidate = await activities.candidate({ ...input, ...context });
      const reviewInput: ReviewInput = {
        ...input,
        ...context,
        candidate,
        checks: [],
      };
      reviewInput.checks = await activities.check(reviewInput);
      const reviewer = createReviewer({
        ...context,
        candidate,
        checks: reviewInput.checks,
      });
      expect((await reviewer.run(task)).submission.verdict).toBe("accepted");
      expect(systems[0]).toContain("IMPLEMENTER PROFILE INSTRUCTIONS");
      expect(systems[0]).toContain("# Claith Implementer");
      expect(systems[0]).toContain("use your judgment");
      expect(systems[1]).toContain("REVIEWER PROFILE INSTRUCTIONS");
      expect(systems[1]).toContain("# Claith Reviewer");
      expect(systems[1]).toContain(
        "Passing checks alone do not establish acceptance",
      );
      expect(await readFile(join(workspace.path, "source.txt"), "utf8")).toBe(
        "implemented-0",
      );
    },
  );
});
