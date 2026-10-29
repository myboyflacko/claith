import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import { createActivities } from "../../src/runtime/activities.js";
import type { SessionFactory } from "../../src/agents/pi.js";
import { fixtureFactory } from "./agent.js";
const [root, address, queue, marker] = process.argv.slice(2) as [
  string,
  string,
  string,
  string,
];
const normal = fixtureFactory([]);
const factory: SessionFactory = async (options) => {
  const result = await normal(options);
  if (options.tools!.includes("submit_implementation")) {
    result.session.prompt = async (text) => {
      options.sessionManager!.appendMessage({
        role: "user",
        content: text,
        timestamp: Date.now(),
      });
      await writeFile(
        join(options.cwd!, "source.txt"),
        "effect-before-worker-kill",
      );
      await writeFile(marker, options.sessionManager!.getSessionId());
      await new Promise(() => {});
    };
  }
  return result;
};
const connection = await NativeConnection.connect({ address });
const worker = await Worker.create({
  connection,
  taskQueue: queue,
  workflowsPath: fileURLToPath(
    new URL("../../src/runtime/workflows.ts", import.meta.url),
  ),
  activities: createActivities(root, factory),
});
await worker.run();
