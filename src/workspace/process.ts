import { spawn } from "node:child_process";
import { open, readFile, readdir } from "node:fs/promises";
import { hostname } from "node:os";
import { writeJson } from "./storage.js";

async function groupAlive(group: number): Promise<boolean> {
  for (const pid of await readdir("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (fields[0] !== "Z" && Number(fields[2]) === group) return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return false;
}

export interface ProcessOptions {
  cwd: string;
  output: string;
  timeoutMs: number;
  signal?: AbortSignal;
}
/** Wait for process-group termination before releasing workspace ownership. */
export async function runCommand(
  command: string,
  options: ProcessOptions,
): Promise<number | null> {
  const output = await open(options.output, "w");
  try {
    if (options.signal?.aborted)
      throw new Error("Command cancelled before dispatch");
    return await new Promise<number | null>((resolve, reject) => {
      // The child waits until its group identity is durable before executing user code.
      const child = spawn(
        "/bin/bash",
        [
          "-o",
          "pipefail",
          "-c",
          `read -r claith_start_signal || exit 125\n${command}`,
        ],
        {
          cwd: options.cwd,
          detached: true,
          stdio: ["pipe", output.fd, output.fd],
        },
      );
      let killed = false;
      function kill() {
        killed = true;
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") reject(error);
        }
      }
      const timer = setTimeout(kill, options.timeoutMs);
      options.signal?.addEventListener("abort", kill, { once: true });
      if (options.signal?.aborted) kill();
      void writeJson(options.output + ".process.json", {
        host: hostname(),
        group: child.pid,
      })
        .then(() => {
          if (!killed) child.stdin?.end("start\n");
        })
        .catch((error) => {
          kill();
          reject(error);
        });
      child.once("error", reject);
      child.once("close", (code) => {
        void finish(code).catch(reject);
      });
      async function finish(code: number | null) {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", kill);
        // Also stop daemonized children that kept the original process group.
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            /* exited */
          }
        }
        if (child.pid) {
          for (
            let round = 0;
            round < 100 && (await groupAlive(child.pid));
            round++
          ) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          if (await groupAlive(child.pid))
            throw new Error(
              `Subprocess group ${child.pid} is still running; preserve ownership for reconciliation`,
            );
          await writeJson(options.output + ".process.json", {
            host: hostname(),
            group: child.pid,
            stopped: true,
          });
        }
        resolve(killed ? null : code);
      }
    });
  } finally {
    await output.close();
  }
}
