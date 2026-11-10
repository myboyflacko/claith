import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";

const exec = promisify(execFile);
/** A separate Compose project, ephemeral port, and named volume; never touches dev data. */
export async function temporalFixture() {
  const directory = await mkdtemp(join(tmpdir(), "claith-temporal-"));
  const project = `claith-test-${randomUUID()}`;
  const file = join(directory, "compose.json");
  const reservation = createServer();
  await new Promise<void>((resolve) =>
    reservation.listen(0, "127.0.0.1", resolve),
  );
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  await writeFile(
    file,
    JSON.stringify({
      services: {
        temporal: {
          image: "temporalio/temporal:1.9.1",
          command: [
            "server",
            "start-dev",
            "--ip",
            "0.0.0.0",
            "--db-filename",
            "/home/temporal/temporal.db",
          ],
          ports: [`127.0.0.1:${port}:7233`],
          volumes: ["state:/home/temporal"],
          healthcheck: {
            test: [
              "CMD",
              "temporal",
              "--address",
              "127.0.0.1:7233",
              "operator",
              "cluster",
              "health",
            ],
            interval: "1s",
            timeout: "2s",
            retries: 60,
          },
        },
      },
      volumes: { state: {} },
    }),
  );
  const compose = (...args: string[]) =>
    exec("docker", ["compose", "-p", project, "-f", file, ...args], {
      timeout: 90_000,
    });
  try {
    await compose("up", "-d", "--wait");
    const address = (await compose("port", "temporal", "7233")).stdout.trim();
    return {
      address,
      restart: async () => {
        await compose("restart", "temporal");
        await compose("up", "-d", "--wait");
      },
      close: async () => {
        await compose("down", "--volumes");
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await compose("down", "--volumes");
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
