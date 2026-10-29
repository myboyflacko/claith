import { Context } from "@temporalio/activity";
import { join } from "node:path";
import type { Activities, RunInput, RunRecord } from "../domain/contracts.js";
import { piActivities } from "../agents/pi.js";
import type { SessionFactory } from "../agents/pi.js";
import { workspaceActivities } from "../workspace/git.js";
import { logEvent } from "../workspace/storage.js";
export function createActivities(
  root: string,
  factory?: SessionFactory,
): Activities {
  function register<K extends keyof Activities>(name: K): Activities[K] {
    return (async (input: RunInput | RunRecord) => {
      const context = Context.current();
      const runId = "execution" in input ? input.execution.runId : input.runId;
      const configuration =
        "execution" in input
          ? input.execution.configuration
          : input.configuration;
      const event = {
        runId,
        project: "execution" in input ? input.execution.project : input.project,
        taskId: input.contract.taskId,
        taskAttempt: "attempt" in input ? input.attempt : null,
        activity: name,
        activityId: context.info.activityId,
        attempt: context.info.attempt,
      };
      const heartbeat = () => context.heartbeat(event);
      heartbeat();
      const timer = setInterval(
        heartbeat,
        configuration.runtime.heartbeatIntervalSeconds * 1000,
      );
      try {
        await logEvent(join(root, "log", `${runId}-runtime.jsonl`), {
          ...event,
          state: "start",
        });
        const adapters = {
          ...workspaceActivities(root, context.cancellationSignal),
          ...piActivities(root, context.cancellationSignal, factory),
        };
        const result = await (
          adapters[name] as (v: unknown) => Promise<unknown>
        )(input);
        await logEvent(join(root, "log", `${runId}-runtime.jsonl`), {
          ...event,
          state: "complete",
        });
        return result;
      } catch (error) {
        await logEvent(join(root, "log", `${runId}-runtime.jsonl`), {
          ...event,
          state: "failed",
          error: String(error),
        });
        throw error;
      } finally {
        clearInterval(timer);
      }
    }) as Activities[K];
  }
  return {
    prepare: register("prepare"),
    setup: register("setup"),
    implement: register("implement"),
    candidate: register("candidate"),
    check: register("check"),
    review: register("review"),
    integrate: register("integrate"),
    push: register("push"),
    cleanup: register("cleanup"),
    record: register("record"),
  };
}
