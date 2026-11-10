import { Type } from "typebox";
import { z } from "zod";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

export interface SubmissionOptions<T> {
  schema: z.ZodType<T>;
  validate: (value: T) => void | Promise<void>;
}

export interface SubmissionTool<T> {
  tool: ToolDefinition;
  readonly submission: T | null;
  readonly failure: string;
}

/** One invocation's result protocol, shared by the role-specific submission tools. */
export function createSubmissionTool<T>(
  name: string,
  options: SubmissionOptions<T>,
): SubmissionTool<T> {
  let submission: T | null = null;
  let failure = "No structured submission";
  const tool: ToolDefinition = {
    name,
    label: name,
    description:
      "Submit the structured result for this exact invocation. Invalid or stale submissions are rejected.",
    parameters: Type.Object({
      result: Type.Unsafe(
        z.toJSONSchema(options.schema, { target: "draft-7" }),
      ),
    }),
    execute: async (_id, parameters) => {
      try {
        if (submission) throw new Error("A result has already been submitted");
        const result = options.schema.parse(
          (parameters as { result: unknown }).result,
        );
        await options.validate(result);
        submission = result;
        return {
          content: [{ type: "text", text: "Recorded. Finish your turn." }],
          details: {},
        };
      } catch (error) {
        failure = String(error);
        return {
          content: [{ type: "text", text: failure }],
          details: {},
          isError: true,
        };
      }
    },
  };
  return {
    tool,
    get submission() {
      return submission;
    },
    get failure() {
      return failure;
    },
  };
}
