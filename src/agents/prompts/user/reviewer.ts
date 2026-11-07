import type { ReviewInput } from "../../../domain/contracts.js";

export function buildReviewerPrompt(
  input: Pick<
    ReviewInput,
    "contract" | "runId" | "attempt" | "feedback" | "candidate" | "checks"
  >,
  revision: string,
): string {
  return JSON.stringify({
    task: input.contract,
    runId: input.runId,
    attempt: input.attempt,
    revision,
    feedback: input.feedback,
    candidate: input.candidate,
    checks: input.checks,
  });
}
