import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Client, Connection } from "@temporalio/client";
import {
  NativeConnection,
  Worker,
  bundleWorkflowCode,
} from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runtimeSchema } from "../src/configuration.js";
import { agentProfiles } from "./fixtures/profiles.js";
import type {
  Activities,
  DeliveryContract,
  SessionSnapshot,
} from "../src/domain/contracts.js";
import { git, workspaceActivities } from "../src/workspace/git.js";
import { withOwnership } from "../src/workspace/ownership.js";
import { writeJson } from "../src/workspace/storage.js";
import { temporalFixture } from "./fixtures/temporal.js";

describe.runIf(process.env.CLAITH_RECOVERY_TESTS === "1")(
  "persistent service and worker recovery",
  () => {
    let fixture: Awaited<ReturnType<typeof temporalFixture>>;
    let connection: Connection;
    let native: NativeConnection;
    let client: Client;
    let bundle: Awaited<ReturnType<typeof bundleWorkflowCode>>;
    let directory: string;
    beforeAll(async () => {
      fixture = await temporalFixture();
      directory = await mkdtemp(join(tmpdir(), "claith-recovery-"));
      connection = await Connection.connect({ address: fixture.address });
      native = await NativeConnection.connect({ address: fixture.address });
      client = new Client({ connection });
      bundle = await bundleWorkflowCode({
        workflowsPath: fileURLToPath(
          new URL("../src/runtime/workflows.ts", import.meta.url),
        ),
      });
    }, 60_000);
    afterAll(async () => {
      await connection?.close();
      await native?.close();
      await fixture?.close();
      if (directory) await rm(directory, { recursive: true, force: true });
    });

    it("preserves a question across worker/service restarts, ignores stale replies, then chains two real worktrees", async () => {
      const id = randomUUID();
      const project = join(directory, id);
      await mkdir(project);
      await git(project, "init", "-b", "dev");
      await git(project, "config", "user.name", "Test");
      await git(project, "config", "user.email", "test@example.invalid");
      await writeFile(join(project, "seed"), "seed");
      await git(project, "add", ".");
      await git(project, "commit", "-m", "seed");
      const startingRevision = await git(project, "rev-parse", "HEAD");
      const configuration = {
        runtime: runtimeSchema.parse({ maxRepairs: 0 }),
        agents: agentProfiles(),
      };
      let fail = true;
      let interrupted = true;
      const workspace = workspaceActivities(directory);
      const activities: Activities = {
        ...workspace,
        plan: async ({ session, startingRevision: base }) => {
          const number = session.acceptedResults.length;
          if (number === 2)
            return {
              message: "Goal complete",
              outline: [],
              contract: null,
              goalComplete: true,
            };
          const contract: DeliveryContract = {
            taskId: `task${number + 1}`,
            version: 1,
            startingRevision: base,
            title: `Task ${number + 1}`,
            outcome: "Create a file",
            boundaries: ["task files"],
            dependencies: number ? ["task1"] : [],
            acceptance: [
              {
                id: "works",
                text: "file exists",
                mode: "check",
                checkId: "test",
              },
            ],
            setup: [],
            checks: [{ id: "test", command: `test -f task${number + 1}.txt` }],
            review: true,
            endpoint: "local-commit",
          };
          return {
            message: "Approve",
            outline: [],
            contract,
            goalComplete: false,
          };
        },
        implement: async (input) =>
          withOwnership(input.workspace.artifactDir, async () => {
            await writeFile(
              join(input.workspace.path, `${input.contract.taskId}.txt`),
              "implemented",
            );
            return {
              status: "submitted",
              summary: "done",
              evidence: [{ criterionId: "works", references: ["test"] }],
            };
          }),
        candidate: async (input) => {
          const result = await workspace.candidate(input);
          if (interrupted) {
            interrupted = false;
            throw new Error("Injected loss after commit/evidence checkpoint");
          }
          return result;
        },
        check: async (input) => {
          if (fail)
            return [
              {
                id: "test",
                command: input.contract.checks[0]!.command,
                exitCode: 1,
                outputRef: "/failed-check",
                revision: input.candidate.revision,
                unchanged: true,
              },
            ];
          return workspace.check(input);
        },
        review: async (input) => ({
          taskId: input.contract.taskId,
          attempt: input.attempt,
          revision: input.candidate.revision,
          verdict: "accepted",
          summary: "verified",
          evidenceRefs: ["test"],
        }),
      };
      const handle = await client.workflow.start("coordinator", {
        workflowId: id,
        taskQueue: id,
        args: [{ sessionId: id, project, startingRevision, configuration }],
      });
      const status = () => handle.query<SessionSnapshot>("status");
      async function wait(state: string) {
        for (let i = 0; i < 500; i++) {
          const s = await status();
          if (s.state === state) return s;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error(`Timed out waiting for ${state}`);
      }
      const makeWorker = () =>
        Worker.create({
          connection: native,
          taskQueue: id,
          workflowBundle: bundle,
          activities,
        });
      const first = await makeWorker();
      let pending: SessionSnapshot["pendingEscalation"] = null;
      await first.runUntil(async () => {
        await handle.executeUpdate("conversation", {
          args: [{ id: "goal", text: "Deliver two sequential tasks" }],
        });
        await wait("awaiting_approval");
        await handle.executeUpdate("approve", {
          args: [
            {
              commandId: "approve1",
              taskId: "task1",
              version: 1,
              configuration,
            },
          ],
        });
        pending = (await wait("waiting")).pendingEscalation;
        expect(pending?.kind).toBe("recovery");
      });
      await fixture.restart();
      const second = await makeWorker();
      await second.runUntil(async () => {
        expect((await status()).pendingEscalation?.id).toBe(pending!.id);
        await expect(
          handle.executeUpdate("decision", {
            args: [
              {
                commandId: "stale",
                escalationId: "obsolete",
                executionId: pending!.executionId,
                answer: "retry",
                additionalRepairs: 1,
                confirmCriteria: [],
              },
            ],
          }),
        ).rejects.toThrow();
        fail = false;
        const decision = {
          commandId: "resume",
          escalationId: pending!.id,
          executionId: pending!.executionId,
          answer: "Reconciled saved commit; continue",
          additionalRepairs: 1,
          confirmCriteria: [],
        };
        await handle.executeUpdate("decision", { args: [decision] });
        await handle.executeUpdate("decision", { args: [decision] });
        const next = await wait("awaiting_approval");
        expect(next.acceptedResults).toHaveLength(1);
        expect(next.proposal?.contract?.startingRevision).toBe(
          next.acceptedResults[0]!.acceptedCommit,
        );
        const base = next.acceptedResults[0]!.acceptedCommit;
        await handle.executeUpdate("approve", {
          args: [
            {
              commandId: "approve2",
              taskId: "task2",
              version: 1,
              configuration,
            },
          ],
        });
        const complete = (await handle.result()) as SessionSnapshot;
        expect(complete.state).toBe("completed");
        expect(complete.acceptedResults).toHaveLength(2);
        const [one, two] = complete.acceptedResults;
        expect(one!.workspace.path).not.toBe(two!.workspace.path);
        expect(await git(two!.workspace.path, "rev-parse", "HEAD^")).toBe(base);
        expect(
          two!.checks.every(
            (c) => c.revision === two!.acceptedCommit && c.exitCode === 0,
          ),
        ).toBe(true);
        await writeJson(join(directory, "recovery-result.json"), complete);
      });
    }, 60_000);
    it("reconciles a worker killed during an agent effect before granting a new writer", async () => {
      const id = randomUUID();
      const project = join(directory, id);
      await mkdir(project);
      await git(project, "init", "-b", "dev");
      await git(project, "config", "user.name", "Test");
      await git(project, "config", "user.email", "test@example.invalid");
      await writeFile(join(project, "seed"), "seed");
      await git(project, "add", ".");
      await git(project, "commit", "-m", "seed");
      const startingRevision = await git(project, "rev-parse", "HEAD");
      const configuration = {
        runtime: runtimeSchema.parse({
          maxRepairs: 0,
          heartbeatIntervalSeconds: 1,
          heartbeatTimeoutSeconds: 3,
        }),
        agents: agentProfiles(),
      };
      const marker = join(directory, `${id}-active`);
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          fileURLToPath(
            new URL("./fixtures/interrupted-worker.ts", import.meta.url),
          ),
          directory,
          fixture.address,
          id,
          marker,
        ],
        { stdio: "ignore" },
      );
      const exited = new Promise<void>((resolve, reject) => {
        child.once("exit", () => resolve());
        child.once("error", reject);
      });
      const handle = await client.workflow.start("coordinator", {
        workflowId: id,
        taskQueue: id,
        args: [{ sessionId: id, project, startingRevision, configuration }],
      });
      async function wait(state: string) {
        for (let i = 0; i < 1000; i++) {
          const s = await handle.query<SessionSnapshot>("status");
          if (s.state === state) return s;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error(`Timed out waiting for ${state}`);
      }
      try {
        await handle.executeUpdate("conversation", {
          args: [{ id: "goal", text: "Perform interruptible task" }],
        });
        await wait("awaiting_approval");
        await handle.executeUpdate("approve", {
          args: [
            {
              commandId: "approve",
              taskId: "interrupted",
              version: 1,
              configuration,
            },
          ],
        });
        for (let i = 0; i < 1000; i++) {
          try {
            if ((await readFile(marker, "utf8")) === "active") break;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(await readFile(marker, "utf8")).toBe("active");
        child.kill("SIGKILL");
        await exited;
        const workspace = workspaceActivities(directory);
        const activities: Activities = {
          ...workspace,
          plan: async () => ({
            message: "complete",
            outline: [],
            contract: null,
            goalComplete: true,
          }),
          implement: async (input) =>
            withOwnership(input.workspace.artifactDir, async () => {
              expect(
                await readFile(
                  join(input.workspace.path, "interrupted.txt"),
                  "utf8",
                ),
              ).toContain("effect happened");
              return {
                status: "submitted",
                summary: "Reconciled interrupted effect",
                evidence: [{ criterionId: "works", references: ["test"] }],
              };
            }),
          review: async () => {
            throw new Error("Review disabled");
          },
        };
        const replacement = await Worker.create({
          connection: native,
          taskQueue: id,
          workflowBundle: bundle,
          activities,
        });
        await replacement.runUntil(async () => {
          const waiting = await wait("waiting");
          const q = waiting.pendingEscalation!;
          expect(q.kind).toBe("recovery");
          await handle.executeUpdate("decision", {
            args: [
              {
                commandId: "reconcile",
                escalationId: q.id,
                executionId: q.executionId,
                answer:
                  "Previous process is dead; inspect and retain its file effect",
                additionalRepairs: 1,
                confirmCriteria: [],
              },
            ],
          });
          const result = (await handle.result()) as SessionSnapshot;
          expect(result.state).toBe("completed");
          expect(result.acceptedResults).toHaveLength(1);
        });
      } finally {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
        await exited;
      }
    }, 60_000);
  },
);
