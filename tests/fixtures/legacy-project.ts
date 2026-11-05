import {
  ChildWorkflowCancellationType,
  ParentClosePolicy,
  condition,
  defineSignal,
  proxyActivities,
  setHandler,
  startChild,
  uuid4,
  workflowInfo,
} from "@temporalio/workflow";
import type {
  OrchestratorWorkflow,
  ProjectActivities,
  ProjectWorkflowInput,
  Task,
} from "../../src/workflows/types.js";

/** Pre-patch dispatch prefix: produce a history independently of the current implementation. */
export async function projectWorkflow(
  input: ProjectWorkflowInput,
): Promise<void> {
  const backlog: Task[] = [];
  setHandler(defineSignal<[{ tasks: Task[] }]>("add-batch"), (value) => {
    backlog.push(...value.tasks);
  });
  const act = proxyActivities<ProjectActivities>({
    startToCloseTimeout: "2m",
    retry: {
      initialInterval: "1s",
      maximumInterval: "30s",
      maximumAttempts: 5,
    },
  });
  await condition(() => backlog.length > 0);
  const task = backlog.shift()!;
  const worktree = await act.assignWorktree({
    projectId: workflowInfo().workflowId,
    gitUrl: input.gitUrl,
    defaultBranch: input.defaultBranch ?? "dev",
    taskId: task.id,
    leaseId: `wt-1-${uuid4()}`,
    maxWorktrees: input.config?.maxWorktrees ?? 5,
  });
  const handle = await startChild<OrchestratorWorkflow>(
    "orchestratorWorkflow",
    {
      args: [
        {
          projectId: workflowInfo().workflowId,
          taskId: task.id,
          payload: task.payload,
          worktree,
          evidenceRef: `evidence:${worktree.id}`,
        },
      ],
      taskQueue: "claith-orchestrator",
      workflowId: `task-${task.id}-${uuid4()}`,
      workflowRunTimeout: input.config?.taskTimeout ?? 3600000,
      retry: {
        maximumAttempts: 1,
        initialInterval: 5000,
        backoffCoefficient: 2,
        maximumInterval: 60000,
      },
      cancellationType:
        ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
      parentClosePolicy: ParentClosePolicy.REQUEST_CANCEL,
    },
  );
  await handle.result();
}
