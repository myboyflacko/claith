import { Context } from "@temporalio/activity";
import type { Activities } from "../domain/contracts.js";
import { piActivities } from "../agents/pi.js";
import type { SessionFactory } from "../agents/pi.js";
import { workspaceActivities } from "../workspace/git.js";
import { join } from "node:path";
import { logEvent } from "../workspace/storage.js";

export function createActivities(
  root: string,
  factory?: SessionFactory,
): Activities {
  function register<K extends keyof Activities>(name: K): Activities[K] {
    return (async (input: Parameters<Activities[K]>[0]) => {
      const context = Context.current();
      const sessionId =
        "sessionId" in input ? input.sessionId : input.session.sessionId;
      const executionId =
        "executionId" in input ? input.executionId : "orchestrator";
      const path = join(root, "log", `${sessionId}-runtime.jsonl`);
      const event = {
        project: "project" in input ? input.project : input.session.project,
        taskId: "contract" in input ? input.contract.taskId : null,
        taskAttempt: "attempt" in input ? input.attempt : null,
        sessionId,
        executionId,
        activity: name,
        activityId: context.info.activityId,
        attempt: context.info.attempt,
      };
      const heartbeat = () => context.heartbeat(event);
      heartbeat();
      const timer = setInterval(
        heartbeat,
        input.configuration.runtime.heartbeatIntervalSeconds * 1000,
      );
      try {
        await logEvent(path, { ...event, state: "start" });
        const adapters: Activities = {
          ...workspaceActivities(root, context.cancellationSignal),
          ...piActivities(root, context.cancellationSignal, factory),
        };
        // Each registered method keeps its own strongly typed public signature.
        const activity = adapters[name] as (
          value: typeof input,
        ) => Promise<unknown>;
        const result = await activity(input);
        await logEvent(path, { ...event, state: "complete" });
        return result;
      } catch (error) {
        await logEvent(path, {
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
    plan: register("plan"),
    prepare: register("prepare"),
    implement: register("implement"),
    candidate: register("candidate"),
    check: register("check"),
    review: register("review"),
    accept: register("accept"),
  };
}
