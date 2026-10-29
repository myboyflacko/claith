import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Client, Connection } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";
import { describe, expect, it } from "vitest";
import type { RunRecord } from "../src/domain/contracts.js";
import { createActivities } from "../src/runtime/activities.js";
import { fixtureFactory } from "./fixtures/agent.js";
import { projectFixture } from "./fixtures/task.js";
import { temporalFixture } from "./fixtures/temporal.js";

describe.runIf(process.env.CLAITH_RECOVERY_TESTS === "1")(
  "interrupted role recovery",
  () => {
    it("reconciles an agent effect after SIGKILL and resumes the same logical session", async () => {
      const fixture = await temporalFixture();
      const directory = await mkdtemp(join(tmpdir(), "claith-kill-"));
      const connection = await Connection.connect({ address: fixture.address });
      const native = await NativeConnection.connect({
        address: fixture.address,
      });
      let child: ReturnType<typeof spawn> | undefined;
      try {
        const f = await projectFixture(directory);
        f.input.runId = randomUUID();
        f.input.configuration.runtime.heartbeatIntervalSeconds = 1;
        f.input.configuration.runtime.heartbeatTimeoutSeconds = 3;
        const marker = join(directory, "agent-effect");
        child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            fileURLToPath(
              new URL("./fixtures/interrupted-task-worker.ts", import.meta.url),
            ),
            f.root,
            fixture.address,
            f.input.runId,
            marker,
          ],
          { stdio: "ignore" },
        );
        const closed = new Promise<void>((resolve) =>
          child!.once("close", () => resolve()),
        );
        const client = new Client({ connection });
        const handle = await client.workflow.start("taskWorkflow", {
          workflowId: f.input.runId,
          taskQueue: f.input.runId,
          args: [f.input],
        });
        let originalSession = "";
        for (let i = 0; i < 600 && !originalSession; i++) {
          try {
            originalSession = await readFile(marker, "utf8");
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        }
        expect(originalSession).not.toBe("");
        child.kill("SIGKILL");
        await closed;
        const sessions: string[] = [];
        const worker = await Worker.create({
          connection: native,
          taskQueue: f.input.runId,
          workflowsPath: fileURLToPath(
            new URL("../src/runtime/workflows.ts", import.meta.url),
          ),
          activities: createActivities(f.root, fixtureFactory(sessions)),
        });
        await worker.runUntil(async () => {
          let blocker = "";
          for (let i = 0; i < 400; i++) {
            const record = await handle.query<RunRecord>("status");
            if (record.execution.blocked) {
              blocker = record.execution.blocked.id;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          expect(blocker).not.toBe("");
          await handle.executeUpdate("resume", {
            args: [
              { commandId: "resume", blockerId: blocker, additionalRepairs: 0 },
            ],
          });
          const result = (await handle.result()) as RunRecord;
          expect(result.execution.status).toBe("completed");
          expect(result.execution.attempts).toHaveLength(1);
          expect(sessions[0]).toBe(originalSession);
        });
      } finally {
        child?.kill("SIGKILL");
        await connection.close();
        await native.close();
        await fixture.close();
        await rm(directory, { recursive: true, force: true });
      }
    }, 60000);
  },
);
