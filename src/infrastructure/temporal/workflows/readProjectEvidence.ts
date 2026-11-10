import { proxyActivities } from "@temporalio/workflow";
import type {
  EvidencePage,
  EvidenceQuery,
  ProjectActivities,
} from "./types.js";

/** Queries cannot execute Activities; this short workflow is the full-history read API. */
export async function readProjectEvidence(input: {
  projectId: string;
  query?: EvidenceQuery;
}): Promise<EvidencePage> {
  const { queryEvidence } = proxyActivities<ProjectActivities>({
    startToCloseTimeout: "30s",
    retry: { maximumAttempts: 3 },
  });
  return queryEvidence({
    projectId: input.projectId,
    query: input.query ?? {},
  });
}
