import { NativeConnection, Worker } from "@temporalio/worker";
import { fileURLToPath } from "node:url";
import type { RuntimeSettings } from "../configuration.js";
import { createActivities } from "./activities.js";
import { createProjectActivities } from "../activities/index.js";

export async function runRuntime(
  root: string,
  settings: RuntimeSettings,
): Promise<void> {
  const connection = await NativeConnection.connect({
    address: settings.address,
  });
  const workers: Worker[] = [];
  const runs: Promise<void>[] = [];
  try {
    const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
    const activities = {
      ...createActivities(root),
      ...createProjectActivities(root, { namespace: settings.namespace }),
    };
    for (const taskQueue of new Set([
      settings.taskQueue,
      "claith-orchestrator",
    ])) {
      workers.push(
        await Worker.create({
          connection,
          namespace: settings.namespace,
          taskQueue,
          workflowsPath: fileURLToPath(
            new URL(`./workflows${extension}`, import.meta.url),
          ),
          activities,
          maxConcurrentActivityTaskExecutions: 8,
          shutdownGraceTime: "30s",
          shutdownForceTime: "35s",
        }),
      );
    }
    runs.push(...workers.map((worker) => worker.run()));
    await Promise.all(runs);
  } finally {
    for (const worker of workers)
      if (worker.getState() === "RUNNING") worker.shutdown();
    await Promise.allSettled(runs);
    await connection.close();
  }
}
