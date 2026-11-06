import { createSubmissionTool } from "../shared/submission.js";
import type {
  SubmissionOptions,
  SubmissionTool,
} from "../shared/submission.js";

export function createSubmitImplementationTool<T>(
  options: SubmissionOptions<T>,
): SubmissionTool<T> {
  return createSubmissionTool("submit_implementation", options);
}
