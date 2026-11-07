import type { AttemptInput } from "../../../domain/contracts.js";

export function buildImplementerPrompt(
  input: Pick<AttemptInput, "contract" | "runId" | "attempt" | "feedback">,
  revision: string,
): string {
  return JSON.stringify({
    task: input.contract,
    runId: input.runId,
    attempt: input.attempt,
    revision,
    feedback: input.feedback,
  });
}
