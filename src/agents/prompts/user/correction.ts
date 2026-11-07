/** Shared follow-up when an invocation has not produced a valid submission. */
export function buildCorrectionPrompt(
  failure: string,
  completionTool: string,
): string {
  return `Correction: ${failure}. Call ${completionTool} once with a valid result bound to the supplied task, attempt, and revision.`;
}
