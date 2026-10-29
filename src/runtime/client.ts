import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdReusePolicy,
} from "@temporalio/client";
import type {
  ExecutionConfiguration,
  RuntimeSettings,
} from "../configuration.js";
import { contractSchema, runIdentity } from "../domain/contracts.js";
import type { RunInput, RunRecord, TaskContract } from "../domain/contracts.js";
import { projectId } from "../workspace/storage.js";
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
  async run(
    projectPath: string,
    value: TaskContract,
    configuration: ExecutionConfiguration,
  ): Promise<string> {
    const contract = contractSchema.parse(value);
    const project = await realpath(projectPath);
    const runId = `task-${projectId(project)}-${contract.taskId}-v${contract.version}`;
    const input: RunInput = { runId, project, contract, configuration };
    try {
      await this.client.workflow.start("taskWorkflow", {
        workflowId: runId,
        taskQueue: this.taskQueue,
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
        args: [input],
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
      const old = await this.status(runId);
      if (
        JSON.stringify(old.contract) !== JSON.stringify(contract) ||
        old.execution.project !== project ||
        JSON.stringify(old.execution.configuration) !==
          JSON.stringify(configuration)
      )
        throw new Error("Run identity already belongs to different input", {
          cause: error,
        });
    }
    return runId;
  }
  status(runId: string): Promise<RunRecord> {
    runIdentity.parse(runId);
    return this.client.workflow.getHandle(runId).query("status");
  }
  async resume(runId: string, additionalRepairs = 0): Promise<string> {
    const record = await this.status(runId);
    if (!record.execution.blocked) throw new Error("Run is not blocked");
    return this.client.workflow.getHandle(runId).executeUpdate("resume", {
      args: [
        {
          commandId: randomUUID(),
          blockerId: record.execution.blocked.id,
          additionalRepairs,
        },
      ],
    });
  }
  cancel(runId: string): Promise<string> {
    runIdentity.parse(runId);
    return this.client.workflow
      .getHandle(runId)
      .executeUpdate("cancel", { args: [randomUUID()] });
  }
}
