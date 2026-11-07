import { readFile } from "node:fs/promises";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Candidate } from "../../../domain/contracts.js";

export function createReadDiffTool(
  candidate: Pick<Candidate, "diffRef" | "revision">,
): ToolDefinition {
  return {
    name: "read_diff",
    label: "Read candidate diff",
    description: "Read the exact candidate diff",
    parameters: Type.Object({}),
    execute: async () => ({
      content: [
        { type: "text", text: await readFile(candidate.diffRef, "utf8") },
      ],
      details: { revision: candidate.revision },
    }),
  };
}
