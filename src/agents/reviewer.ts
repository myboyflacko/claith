import { createReadDiffTool } from "./tools/reviewer/readDiff.js";
import { assertRevision } from "../workspace/git.js";
import { withOwnership } from "../workspace/ownership.js";
import { assertReview, reviewSchema } from "../domain/contracts.js";
import type {
  TaskContract,
  Candidate,
  CommandEvidence,
} from "../domain/contracts.js";
import { invokeAgent } from "./execution.js";
import type { AgentContext } from "./execution.js";
import { reviewerTemplate } from "./templates.js";
export interface ReviewerContext extends AgentContext {
  candidate: Candidate;
  checks: CommandEvidence[];
}
export function createReviewer(context: ReviewerContext) {
  return {
    run: async (task: TaskContract) => {
      const input = { ...context, contract: task };
      return withOwnership(input.workspace.artifactDir, async () => {
        await assertRevision(input.workspace, input.candidate.revision);
        const diff = createReadDiffTool(input.candidate);
        return invokeAgent(
          context,
          input,
          "reviewer",
          reviewSchema,
          reviewerTemplate,
          [diff],
          input.candidate.revision,
          async (value) => {
            assertReview(input, value);
            await assertRevision(input.workspace, input.candidate.revision);
          },
        );
      });
    },
  };
}
