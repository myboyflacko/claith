import { defineQuery, defineSignal, defineUpdate } from "@temporalio/workflow";
import type {
  Approval,
  Conversation,
  Decision,
  Escalation,
  SessionSnapshot,
  TaskSnapshot,
} from "../domain/contracts.js";
export const statusQuery = defineQuery<SessionSnapshot>("status");
export const conversationUpdate = defineUpdate<string, [Conversation]>(
  "conversation",
);
export const approveUpdate = defineUpdate<string, [Approval]>("approve");
export const decisionUpdate = defineUpdate<string, [Decision]>("decision");
export const cancelUpdate = defineUpdate<string, [string]>("cancel");
export const progressSignal =
  defineSignal<[TaskSnapshot, Escalation | null]>("progress");
export const decisionSignal = defineSignal<[Decision]>("decision");
export const taskCancelSignal = defineSignal("taskCancel");
