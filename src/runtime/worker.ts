import { NativeConnection, Worker } from "@temporalio/worker";
import { fileURLToPath } from "node:url";
import type { RuntimeSettings } from "../configuration.js";
import { createActivities } from "./activities.js";

export async function runRuntime(
  root: string,
  settings: RuntimeSettings,
): Promise<void> {
  const connection = await NativeConnection.connect({
    address: settings.address,
  });
  try {
    const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
    const worker = await Worker.create({
      connection,
      namespace: settings.namespace,
      taskQueue: settings.taskQueue,
      workflowsPath: fileURLToPath(
        new URL(`./workflows${extension}`, import.meta.url),
      ),
      activities: createActivities(root),
      maxConcurrentActivityTaskExecutions: 1,
      shutdownGraceTime: "30s",
      shutdownForceTime: "35s",
    });
    await worker.run();
  } finally {
    await connection.close();
  }
}
