import { runCli } from "./cli/index.js";

try {
  await runCli();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
