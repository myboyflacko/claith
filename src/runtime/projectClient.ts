import { createHash, randomUUID } from "node:crypto";
import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdReusePolicy,
} from "@temporalio/client";
import type { Client } from "@temporalio/client";
import type {
  EvidencePage,
  EvidenceQuery,
  ProjectSnapshot,
  ProjectWorkflowInput,
} from "../workflows/types.js";

/** Repository URLs are identity keys; callers must consistently use their canonical URL. */
export function projectWorkflowId(gitUrl: string): string {
  return `project-${createHash("sha256").update(gitUrl).digest("hex")}`;
}
export class ProjectClient {
  constructor(
    readonly client: Client,
    readonly taskQueue: string,
  ) {}

  async start(
    input: Omit<ProjectWorkflowInput, "checkpoint">,
  ): Promise<string> {
    const workflowId = projectWorkflowId(input.gitUrl);
    try {
      await this.client.workflow.start("projectWorkflow", {
        workflowId,
        taskQueue: this.taskQueue,
        args: [input],
        workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
      const state = await this.client.workflow
        .getHandle(workflowId)
        .query<ProjectSnapshot>("get-full-state");
      if (
        state.git.remoteUrl !== input.gitUrl ||
        state.git.defaultBranch !== (input.defaultBranch ?? "dev") ||
        state.git.sshKeyRef !== input.sshKeyRef
      )
        throw new Error(
          "Project already exists with different repository settings",
          { cause: error },
        );
    }
    return workflowId;
  }

  /** Paged full history; unlike a Query this can execute a SQLite Activity. */
  evidence(
    projectId: string,
    query: EvidenceQuery = {},
  ): Promise<EvidencePage> {
    return this.client.workflow.execute("readProjectEvidence", {
      workflowId: `evidence-read-${randomUUID()}`,
      taskQueue: this.taskQueue,
      args: [{ projectId, query }],
    });
  }
}
