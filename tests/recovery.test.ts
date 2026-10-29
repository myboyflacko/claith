import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Client, Connection } from "@temporalio/client";
import {
  NativeConnection,
  Worker,
  bundleWorkflowCode,
} from "@temporalio/worker";
import { describe, expect, it } from "vitest";
import type { RunRecord } from "../src/domain/contracts.js";
import { createActivities } from "../src/runtime/activities.js";
import { fixtureFactory } from "./fixtures/agent.js";
import { projectFixture } from "./fixtures/task.js";
import { temporalFixture } from "./fixtures/temporal.js";

describe.runIf(process.env.CLAITH_RECOVERY_TESTS === "1")(
  "durable task recovery",
  () => {
    it("retains a delivery blocker across worker/service restart and resumes only cleanup", async () => {
      const fixture = await temporalFixture();
      const directory = await mkdtemp(join(tmpdir(), "claith-recovery-"));
      let connection = await Connection.connect({ address: fixture.address });
      let native = await NativeConnection.connect({ address: fixture.address });
      try {
        const f = await projectFixture(directory);
        f.input.runId = randomUUID();
        const sessions: string[] = [];
        const bundle = await bundleWorkflowCode({
          workflowsPath: fileURLToPath(
            new URL("../src/runtime/workflows.ts", import.meta.url),
          ),
        });
        const activities = createActivities(f.root, fixtureFactory(sessions));
        const original = activities.cleanup;
        let fail = true;
        activities.cleanup = async (input) => {
          if (fail) throw new Error("Interrupted cleanup");
          await original(input);
        };
        let client = new Client({ connection });
        let worker = await Worker.create({
          connection: native,
          taskQueue: f.input.runId,
          workflowBundle: bundle,
          activities,
        });
        const handle = await client.workflow.start("taskWorkflow", {
          workflowId: f.input.runId,
          taskQueue: f.input.runId,
          args: [f.input],
        });
        let blocker = "";
        await worker.runUntil(async () => {
          for (let i = 0; i < 400; i++) {
            const record = await handle.query<RunRecord>("status");
            if (record.execution.blocked) {
              blocker = record.execution.blocked.id;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          expect(blocker).not.toBe("");
        });
        await connection.close();
        await native.close();
        await fixture.restart();
        connection = await Connection.connect({ address: fixture.address });
        native = await NativeConnection.connect({ address: fixture.address });
        client = new Client({ connection });
        fail = false;
        worker = await Worker.create({
          connection: native,
          taskQueue: f.input.runId,
          workflowBundle: bundle,
          activities,
        });
        await worker.runUntil(async () => {
          const resumed = client.workflow.getHandle(f.input.runId);
          expect(
            (await resumed.query<RunRecord>("status")).execution.blocked?.id,
          ).toBe(blocker);
          await resumed.executeUpdate("resume", {
            args: [
              { commandId: "resume", blockerId: blocker, additionalRepairs: 0 },
            ],
          });
          expect(((await resumed.result()) as RunRecord).execution.status).toBe(
            "completed",
          );
          expect(sessions).toHaveLength(2);
        });
      } finally {
        await connection.close();
        await native.close();
        await fixture.close();
        await rm(directory, { recursive: true, force: true });
      }
    }, 60000);
  },
);
