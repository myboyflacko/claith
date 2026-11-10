import { bootstrap } from "../../infrastructure/bootstrap/bootstrap.js";
import { appSettings } from "../../infrastructure/settings.js";

const usage = "Usage: claith init";

export async function runCli(
  args = process.argv.slice(2),
  root = appSettings.configDir,
): Promise<void> {
  if (
    args.length === 0 ||
    (args.length === 1 && ["--help", "-h"].includes(args[0]!))
  ) {
    console.log(usage);
    return;
  }
  if (args.length !== 1) throw new Error(usage);
  if (args[0] !== "init")
    throw new Error(`Unknown command: ${args[0]}. ${usage}`);

  await bootstrap({ configDir: root });
  console.log(`Initialized configuration: ${root}`);
}
