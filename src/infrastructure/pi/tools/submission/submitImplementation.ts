import { createSubmissionTool } from "./shared.js";
import type { SubmissionOptions, SubmissionTool } from "./shared.js";

export function createSubmitImplementationTool<T>(
  options: SubmissionOptions<T>,
): SubmissionTool<T> {
  return createSubmissionTool("submit_implementation", options);
}
