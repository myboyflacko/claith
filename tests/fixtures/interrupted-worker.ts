import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import type {
  DeliveryContract,
  SessionSnapshot,
} from "../../src/domain/contracts.js";
import type { SessionFactory } from "../../src/agents/pi.js";
import { createActivities } from "../../src/runtime/activities.js";

const [root, address, queue, marker] = process.argv.slice(2) as [
  string,
  string,
  string,
  string,
];
const factory: SessionFactory = async (options) => ({
  session: {
    subscribe: () => () => {},
    abort: async () => {},
    dispose: () => {},
    prompt: async (prompt) => {
      if (options.tools?.includes("submit_proposal")) {
        const session = JSON.parse(
          prompt.slice(prompt.indexOf("\n") + 1),
        ) as SessionSnapshot;
        const startingRevision = /startingRevision ([a-f0-9]+)/.exec(
          prompt,
        )![1]!;
        const contract: DeliveryContract = {
          taskId: "interrupted",
          version: 1,
          startingRevision,
          title: "Interrupted task",
          outcome: "Create file",
          boundaries: ["file"],
          dependencies: [],
          acceptance: [
            {
              id: "works",
              text: "file exists",
              mode: "check",
              checkId: "test",
            },
          ],
          setup: [],
          checks: [{ id: "test", command: "test -f interrupted.txt" }],
          review: false,
          endpoint: "local-commit",
        };
        await options.customTools!.at(-1)!.execute(
          "proposal",
          {
            result: {
              message: "Approve task",
              outline: [],
              contract: session.acceptedResults.length ? null : contract,
              goalComplete: session.acceptedResults.length > 0,
            },
          },
          undefined,
          undefined,
          undefined as never,
        );
      } else {
        await writeFile(
          join(options.cwd!, "interrupted.txt"),
          "effect happened before activity completion",
        );
        await writeFile(marker, "active");
        await new Promise(() => {});
      }
    },
  },
});
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
