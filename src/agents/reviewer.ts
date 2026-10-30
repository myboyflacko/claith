import { readFile } from "node:fs/promises";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
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
        const diff: ToolDefinition = {
          name: "read_diff",
          label: "Read candidate diff",
          description: "Read the exact candidate diff",
          parameters: Type.Object({}),
          execute: async () => ({
            content: [
              {
                type: "text",
                text: await readFile(input.candidate.diffRef, "utf8"),
              },
            ],
            details: { revision: input.candidate.revision },
          }),
        };
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
