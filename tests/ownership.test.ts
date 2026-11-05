import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  withOwnership,
  withQueuedOwnership,
} from "../src/workspace/ownership.js";

it("queues same-worker writers, advances after failures and keeps filesystem ownership authoritative", async () => {
  const directory = await mkdtemp(join(tmpdir(), "claith-owner-queue-"));
  const entered: string[] = [];
  let release!: () => void, started!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const first = withQueuedOwnership(directory, async () => {
    entered.push("first");
    started();
    await hold;
    throw new Error("first failed");
  });
  await ready;
  const second = withQueuedOwnership(directory, async () => {
    entered.push("second");
    return "completed";
  });
  try {
    expect(entered).toEqual(["first"]);
    release();
    expect(await Promise.allSettled([first, second])).toMatchObject([
      { status: "rejected", reason: { message: "first failed" } },
      { status: "fulfilled", value: "completed" },
    ]);
    expect(entered).toEqual(["first", "second"]);
    await withOwnership(directory, async () => {
      await expect(
        withQueuedOwnership(directory, async () => {
          throw new Error("must not enter");
        }),
      ).rejects.toThrow("already has a writer");
    });
    expect(await withQueuedOwnership(directory, async () => "released")).toBe(
      "released",
    );
  } finally {
    release();
    await Promise.allSettled([first, second]);
    await rm(directory, { recursive: true, force: true });
  }
});
