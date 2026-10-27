import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { realpath } from "node:fs/promises";
import { appSettings } from "../settings.js";
import {
  initializeConfiguration,
  loadConfiguration,
} from "../configuration.js";
import { DeliveryClient } from "../runtime/client.js";
import { runRuntime } from "../runtime/worker.js";
import { displaySnapshot, submitChatLine } from "./chat.js";
import { bootstrap } from "../bootstrap.js";

export async function runCli(
  args = process.argv.slice(2),
  root = appSettings.configDir,
): Promise<void> {
  await bootstrap({ configDir: root });
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: { project: { type: "string" }, session: { type: "string" } },
  });
  const command = positionals[0];
  if (positionals.length > 1) throw new Error("Only one command is allowed");
  if (!command) {
    console.log(
      "Claith: init | runtime | chat --project <path> [--session <id>]",
    );
    return;
  }
  if (command === "init") {
    await initializeConfiguration(root);
    console.log(
      `Configuration templates: ${root}. Select Pi models before execution.`,
    );
    return;
  }
  if (command !== "runtime" && command !== "chat")
    throw new Error(`Unknown command: ${command}`);
  const config = await loadConfiguration(root);
  if (command === "runtime") {
    await runRuntime(root, config.runtime);
    return;
  }
  if (!values.project) throw new Error("chat requires --project <path>");
  const project = await realpath(values.project);
  const client = await DeliveryClient.connect(config.runtime);
  try {
    const session = values.session ?? (await client.create(project, config));
    let snapshot = await client.status(session);
    if (snapshot.project !== project)
      throw new Error("Session belongs to another project");
    console.log(displaySnapshot(snapshot));
    const terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdin.isTTY ?? false,
    });
    let stopped = false;
    let polling = false;
    let fingerprint = JSON.stringify(snapshot);
    const refresh = async () => {
      if (polling || stopped) return;
      polling = true;
      try {
        const next = await client.status(session);
        const changed = JSON.stringify(next);
        if (changed !== fingerprint) {
          snapshot = next;
          fingerprint = changed;
          console.log(displaySnapshot(snapshot));
        }
      } catch (error) {
        console.error(String(error));
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(() => {
      void refresh();
    }, 1000);
    try {
      for await (const line of terminal) {
        try {
          // Reload only for subsequent approvals; execution snapshots remain immutable.
          if (
            (await submitChatLine(
              line,
              snapshot,
              client,
              line.trim() === "/approve"
                ? await loadConfiguration(root)
                : config,
            )) === "quit"
          )
            break;
          if (line.trim() === "/status")
            console.log(displaySnapshot(await client.status(session)));
          await refresh();
        } catch (error) {
          console.error(String(error));
        }
      }
    } finally {
      stopped = true;
      clearInterval(timer);
      terminal.close();
    }
  } finally {
    await client.close();
  }
}
