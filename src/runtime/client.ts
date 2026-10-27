import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { Client, Connection, WorkflowIdReusePolicy } from "@temporalio/client";
import type {
  ExecutionConfiguration,
  RuntimeSettings,
} from "../configuration.js";
import { identity } from "../domain/contracts.js";
import type {
  Approval,
  Conversation,
  Decision,
  SessionSnapshot,
} from "../domain/contracts.js";
import { git } from "../workspace/git.js";

export class DeliveryClient {
  constructor(
    readonly client: Client,
    readonly taskQueue: string,
  ) {}
  static async connect(settings: RuntimeSettings): Promise<DeliveryClient> {
    const connection = await Connection.connect({ address: settings.address });
    return new DeliveryClient(
      new Client({ connection, namespace: settings.namespace }),
      settings.taskQueue,
    );
  }
  async close(): Promise<void> {
    await this.client.connection.close();
  }
  async create(
    projectPath: string,
    configuration: ExecutionConfiguration,
    sessionId = randomUUID(),
  ): Promise<string> {
    identity.parse(sessionId);
    const project = await realpath(projectPath);
    const startingRevision = await git(project, "rev-parse", "HEAD");
    await this.client.workflow.start("coordinator", {
      workflowId: sessionId,
      taskQueue: this.taskQueue,
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      args: [{ sessionId, project, startingRevision, configuration }],
    });
    return sessionId;
  }
  status(sessionId: string): Promise<SessionSnapshot> {
    return this.client.workflow.getHandle(sessionId).query("status");
  }
  conversation(sessionId: string, message: Conversation): Promise<string> {
    return this.client.workflow
      .getHandle(sessionId)
      .executeUpdate("conversation", { args: [message] });
  }
  async approve(sessionId: string, approval: Approval): Promise<string> {
    const snapshot = await this.status(sessionId);
    const executionId = `${sessionId}-${approval.taskId}-v${approval.version}`;
    if (
      snapshot.acceptedResults.some(
        (result) => result.executionId === executionId,
      ) ||
      snapshot.currentTask?.executionId === executionId
    )
      return executionId;
    return this.client.workflow
      .getHandle(sessionId)
      .executeUpdate("approve", { args: [approval] });
  }
  answer(sessionId: string, decision: Decision): Promise<string> {
    return this.client.workflow
      .getHandle(sessionId)
      .executeUpdate("decision", { args: [decision] });
  }
  cancel(sessionId: string, commandId = randomUUID()): Promise<string> {
    return this.client.workflow
      .getHandle(sessionId)
      .executeUpdate("cancel", { args: [commandId] });
  }
}
