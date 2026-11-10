import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { appSettings } from "../settings.js";
import {
  initializeConfiguration,
  loadConfiguration,
} from "../configuration.js";
import { contractSchema, runIdentity } from "../domain/contracts.js";
import { DeliveryClient } from "../runtime/client.js";
import { runRuntime } from "../runtime/worker.js";
import { bootstrap } from "../bootstrap.js";
export async function runCli(
  args = process.argv.slice(2),
  root = appSettings.configDir,
): Promise<void> {
  await bootstrap({ configDir: root });
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      project: { type: "string" },
      contract: { type: "string" },
      run: { type: "string" },
      "additional-repairs": { type: "string" },
    },
  });
  const command = positionals[0];
  if (positionals.length > 1) throw new Error("Only one command is allowed");
  if (!command) {
    console.log(
      "Claith: init | runtime | run --project <path> --contract <file.json> | status/resume/cancel --run <id>",
    );
    return;
  }
  if (
    !["init", "runtime", "run", "status", "resume", "cancel"].includes(command)
  )
    throw new Error(`Unknown command: ${command}`);
  const allowed: Record<string, string[]> = {
    init: [],
    runtime: [],
    run: ["project", "contract"],
    status: ["run"],
    resume: ["run", "additional-repairs"],
    cancel: ["run"],
  };
  for (const key of Object.keys(values))
    if (!allowed[command]!.includes(key))
      throw new Error(`${key} is not valid for ${command}`);
  if (command === "init") {
    await initializeConfiguration(root);
    console.log(`Configuration templates: ${root}`);
    return;
  }
  let contract;
  if (command === "run") {
    if (!values.project || !values.contract)
      throw new Error("run requires --project and --contract");
    contract = contractSchema.parse(
      JSON.parse(await readFile(values.contract, "utf8")),
    );
  } else if (command !== "runtime" && !values.run)
    throw new Error(`${command} requires --run`);
  if (values.run) runIdentity.parse(values.run);
  const extra = Number(values["additional-repairs"] ?? 0);
  if (!Number.isInteger(extra) || extra < 0 || extra > 20)
    throw new Error("additional-repairs must be 0..20");
  const config = await loadConfiguration(root);
  if (command === "runtime") {
    await runRuntime(root, config.runtime);
    return;
  }
  const client = await DeliveryClient.connect(config.runtime);
  try {
    if (command === "run")
      console.log(await client.run(values.project!, contract!, config));
    else if (command === "status")
      console.log(JSON.stringify(await client.status(values.run!), null, 2));
    else if (command === "resume")
      console.log(await client.resume(values.run!, extra));
    else console.log(await client.cancel(values.run!));
  } finally {
    await client.close();
  }
}
