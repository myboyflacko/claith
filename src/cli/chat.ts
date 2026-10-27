import { randomUUID } from "node:crypto";
import type { ExecutionConfiguration } from "../configuration.js";
import type { DeliveryClient } from "../runtime/client.js";
import type { SessionSnapshot } from "../domain/contracts.js";

export function displaySnapshot(s: SessionSnapshot): string {
  const lines = [`Session ${s.sessionId}: ${s.state}`];
  if (s.proposal) lines.push(s.proposal.message);
  if (s.state === "awaiting_approval" && s.proposal?.contract) {
    lines.push(
      JSON.stringify(s.proposal.contract, null, 2),
      "Approve this exact contract: /approve",
    );
  }
  if (s.currentTask)
    lines.push(
      `Task ${s.currentTask.contract.taskId}, attempt ${s.currentTask.attempt}, repairs ${s.currentTask.repairsUsed}`,
    );
  if (s.pendingEscalation) {
    const q = s.pendingEscalation;
    lines.push(
      `Question ${q.id} (${q.kind}, reminders ${q.reminders}): ${q.question}`,
    );
    lines.push(
      q.kind === "acceptance"
        ? `/answer ${q.id} confirm ${q.criteria.join(",")} <reason>`
        : `/continue ${q.id} <additional rounds 1..20> <answer>`,
    );
  }
  for (const result of s.acceptedResults) {
    lines.push(
      `Accepted ${result.taskId}: ${result.acceptedCommit}`,
      `Evidence: ${result.workspace.artifactDir}`,
    );
  }
  return lines.join("\n");
}

export async function submitChatLine(
  line: string,
  displayed: SessionSnapshot,
  client: Pick<
    DeliveryClient,
    "conversation" | "approve" | "status" | "answer" | "cancel"
  >,
  configuration: ExecutionConfiguration,
): Promise<"quit" | void> {
  const [command, ...words] = line.trim().split(/\s+/);
  const session = displayed.sessionId;
  if (!command) return;
  if (command === "/quit") return "quit";
  if (command === "/status") return;
  if (command === "/cancel") {
    await client.cancel(session);
    return;
  }
  if (command === "/approve") {
    const c = displayed.proposal?.contract;
    if (!c || displayed.state !== "awaiting_approval")
      throw new Error("No displayed contract awaiting approval");
    await client.approve(session, {
      commandId: randomUUID(),
      taskId: c.taskId,
      version: c.version,
      configuration,
    });
    return;
  }
  if (command === "/answer" || command === "/continue") {
    const q = displayed.pendingEscalation;
    if (!q || words[0] !== q.id)
      throw new Error("Specify the current question ID");
    const additionalRepairs = command === "/continue" ? Number(words[1]) : 0;
    const confirmCriteria =
      command === "/answer" && words[1] === "confirm"
        ? (words[2] ?? "").split(",").filter(Boolean)
        : [];
    const answer = words
      .slice(command === "/continue" ? 2 : confirmCriteria.length ? 3 : 1)
      .join(" ");
    await client.answer(session, {
      commandId: randomUUID(),
      executionId: q.executionId,
      escalationId: q.id,
      additionalRepairs,
      confirmCriteria,
      answer,
    });
    return;
  }
  if (command.startsWith("/"))
    throw new Error(
      "Commands: /approve /status /answer /continue /cancel /quit",
    );
  await client.conversation(session, { id: randomUUID(), text: line });
}
