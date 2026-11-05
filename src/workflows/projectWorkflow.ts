import {
  ApplicationFailure,
  CancellationScope,
  ChildWorkflowCancellationType,
  ParentClosePolicy,
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
  isCancellation,
  getExternalWorkflowHandle,
  proxyActivities,
  patched,
  setHandler,
  sleep,
  startChild,
  workflowInfo,
} from "@temporalio/workflow";
import { createConfig } from "./config.js";
import { uuidv4 } from "../lib/uuid.js";
import type { RunRecord } from "../domain/contracts.js";
import type {
  AddTaskSignal,
  ChildStatus,
  ChildWorkflowResult,
  CommandRejection,
  Evidence,
  EvidenceRef,
  NewContractSignal,
  OrchestratorWorkflow,
  ProjectActivities,
  PreparedTaskRun,
  TaskDeliveryWorkflow,
  ProjectCommand,
  ProjectHealth,
  ProjectRepository,
  ProjectSnapshot,
  ProjectState,
  ProjectWorkflowInput,
  Task,
  WorktreeState,
} from "./types.js";

export const newContract = defineSignal<[NewContractSignal]>("new-contract");
export const addTask = defineSignal<[AddTaskSignal]>("add-task");
export const addBatch = defineSignal<[{ tasks: Task[] }]>("add-batch");
export const removeTask = defineSignal<[{ taskId: string }]>("remove-task");
export const reorder = defineSignal<[{ taskIds: string[] }]>("reorder");
export const pause = defineSignal<[{ reason?: string }]>("pause");
export const resume = defineSignal<[Record<string, never>]>("resume");
export const shutdown = defineSignal<[{ force?: boolean }]>("shutdown");
export const updateConfig =
  defineSignal<[{ config: Partial<ProjectState["config"]> }]>("update-config");
export const getBacklog = defineQuery<Task[]>("get-backlog");
export const getRunning =
  defineQuery<Record<string, ChildStatus>>("get-running");
export const getCompleted = defineQuery<string[]>("get-completed");
export const getFailed = defineQuery<Record<string, string>>("get-failed");
export const getEvidence = defineQuery<EvidenceRef[]>("get-evidence");
export const getContracts =
  defineQuery<ProjectSnapshot["contracts"]>("get-contracts");
export const getWorktrees = defineQuery<WorktreeState[]>("get-worktrees");
export const getFullState = defineQuery<ProjectSnapshot>("get-full-state");
export const getHealth = defineQuery<ProjectHealth>("get-health");

const compareTasks = (a: Task, b: Task) =>
  (b.priority ?? 0) - (a.priority ?? 0) ||
  Date.parse(a.createdAt) - Date.parse(b.createdAt);
const text = (error: unknown): string =>
  error instanceof Error
    ? `${error.message}${error.cause ? `: ${text(error.cause)}` : ""}`
    : String(error);
const timestamp = () => new Date().toISOString();
const invalid = (message: string): never => {
  throw ApplicationFailure.nonRetryable(message, "Validation");
};
const identity = (value: string): boolean =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(value);

type Completion = {
  task: Task;
  result: ChildWorkflowResult;
  worktree: WorktreeState;
  prepared?: PreparedTaskRun;
  record?: RunRecord;
};

export async function projectWorkflow(
  input: ProjectWorkflowInput,
): Promise<void> {
  if (!input.gitUrl?.trim()) invalid("gitUrl is required");
  const cp = input.checkpoint;
  const taskDelivery = patched("project-taskflow-v1");
  const state: ProjectState = {
    git: {
      remoteUrl: input.gitUrl,
      defaultBranch: input.defaultBranch ?? "dev",
      ...(input.sshKeyRef ? { sshKeyRef: input.sshKeyRef } : {}),
      worktrees: new Map(cp?.worktrees.map((w) => [w.id, w])),
    },
    backlog: cp?.backlog ?? [],
    runningChildren: new Map(),
    completed: new Set(cp?.completed),
    failed: new Map(cp?.failed),
    evidence: cp?.evidence ?? [],
    contracts: new Map(cp?.contracts.map((c) => [c.contractId, c])),
    status: cp?.status ?? "RUNNING",
    ...(cp?.pauseReason ? { pauseReason: cp.pauseReason } : {}),
    config: createConfig(taskDelivery ? input.config : {
      ...input.config,
      maxParallel: input.config?.maxParallel ?? 3,
      maxWorktrees: input.config?.maxWorktrees ?? (input.config?.maxParallel ?? 3) + 2,
    }),
  };
  const act = proxyActivities<ProjectActivities>({
    startToCloseTimeout: "2m",
    retry: {
      initialInterval: "1s",
      maximumInterval: "30s",
      maximumAttempts: 5,
    },
  });
  const repository: ProjectRepository = {
    projectId: workflowInfo().workflowId,
    gitUrl: input.gitUrl,
    defaultBranch: state.git.defaultBranch,
    ...(input.sshKeyRef ? { sshKeyRef: input.sshKeyRef } : {}),
  };
  const commands: ProjectCommand[] = cp?.commands ?? [];
  const rejections: CommandRejection[] = cp?.rejections ?? [];
  const children = new Map<string, ChildStatus>();
  const activeTasks = new Map<string, Task>();
  const cancellations = new Set<string>();
  const cancelChild = (workflowId: string): Promise<void> => {
    if (cancellations.has(workflowId)) return Promise.resolve();
    cancellations.add(workflowId);
    return getExternalWorkflowHandle(workflowId)
      .cancel()
      .catch(() => undefined);
  };
  const events: Completion[] = [];
  let version = 0;
  let force = false;
  let sequence = cp?.sequence ?? 0;
  let maintenanceError: string | null = null;
  let lastProgress = timestamp();
  const shuttingDown = () =>
    state.status === "SHUTTING_DOWN" || state.status === "SHUTDOWN";
  const enqueue = (command: ProjectCommand) => {
    if (!shuttingDown()) commands.push(command);
    version++;
  };
  setHandler(newContract, (value) => enqueue({ type: "new-contract", value }));
  setHandler(addTask, (value) => enqueue({ type: "add-task", value }));
  setHandler(addBatch, (value) => enqueue({ type: "add-batch", value }));
  setHandler(removeTask, (value) => enqueue({ type: "remove-task", value }));
  setHandler(reorder, (value) => enqueue({ type: "reorder", value }));
  setHandler(updateConfig, (value) =>
    enqueue({ type: "update-config", value }),
  );
  setHandler(pause, ({ reason }) => {
    if (!shuttingDown()) {
      state.status = "PAUSED";
      if (reason) state.pauseReason = reason;
      else delete state.pauseReason;
    }
    version++;
  });
  setHandler(resume, () => {
    if (!shuttingDown()) {
      state.status = "RUNNING";
      delete state.pauseReason;
    }
    version++;
  });
  setHandler(shutdown, (value) => {
    state.status = "SHUTTING_DOWN";
    force ||= value.force ?? false;
    version++;
  });
  setHandler(getBacklog, () => [...state.backlog].sort(compareTasks));
  setHandler(getRunning, () => Object.fromEntries(children));
  setHandler(getCompleted, () => [...state.completed]);
  setHandler(getFailed, () => Object.fromEntries(state.failed));
  setHandler(getEvidence, () => state.evidence);
  setHandler(getContracts, () => [...state.contracts.values()]);
  setHandler(getWorktrees, () => [...state.git.worktrees.values()]);
  setHandler(getFullState, () => ({
    git: { ...state.git, worktrees: [...state.git.worktrees.values()] },
    backlog: [...state.backlog].sort(compareTasks),
    runningChildren: Object.fromEntries(children),
    completed: [...state.completed],
    failed: Object.fromEntries(state.failed),
    evidence: state.evidence,
    contracts: [...state.contracts.values()],
    status: state.status,
    ...(state.pauseReason ? { pauseReason: state.pauseReason } : {}),
    config: state.config,
    rejections,
    maintenanceError,
  }));
  setHandler(getHealth, () => {
    const total = state.completed.size + state.failed.size;
    return {
      status: state.status,
      backlogSize: state.backlog.length,
      runningCount: activeTasks.size,
      ...(state.backlog.length && !activeTasks.size
        ? { stuckSince: lastProgress }
        : {}),
      errorRate: total ? state.failed.size / total : 0,
    };
  });

  function insert(tasks: Task[]): void {
    const candidates: Task[] = [];
    const seen = new Map<string, string | undefined>();
    for (const task of tasks) {
      if (
        !identity(task.id) ||
        (task.contractId !== undefined && !identity(task.contractId)) ||
        !Array.isArray(task.dependsOn) ||
        !task.dependsOn.every(identity) ||
        (task.priority !== undefined && !Number.isFinite(task.priority)) ||
        !Number.isFinite(Date.parse(task.createdAt))
      )
        invalid("Invalid task");
      if (seen.has(task.id)) {
        if (seen.get(task.id) !== task.contractId)
          invalid("Task ID belongs to another contract");
        continue;
      }
      seen.set(task.id, task.contractId);
      const existing =
        state.completed.has(task.id) ||
        state.failed.has(task.id) ||
        activeTasks.has(task.id) ||
        state.backlog.some((t) => t.id === task.id);
      if (existing) {
        const owner = [...state.contracts.values()].find((c) =>
          c.tasks.includes(task.id),
        )?.contractId;
        if (owner !== task.contractId)
          invalid("Task ID belongs to another contract");
        if (!state.failed.has(task.id)) continue;
      }
      candidates.push(task);
    }
    const pending = [...state.backlog, ...candidates];
    const known = new Set([
      ...pending.map((t) => t.id),
      ...activeTasks.keys(),
      ...state.completed,
    ]);
    for (const task of candidates) {
      if (task.dependsOn.some((d) => !known.has(d)))
        invalid(`Unknown dependency for ${task.id}`);
    }
    const graph = new Map(pending.map((t) => [t.id, t.dependsOn]));
    const visited = new Set<string>();
    const visiting = new Set<string>();
    function visit(id: string): void {
      if (visiting.has(id)) invalid("Dependency cycle");
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dep of graph.get(id) ?? []) visit(dep);
      visiting.delete(id);
      visited.add(id);
    }
    for (const id of graph.keys()) visit(id);
    for (const task of candidates) {
      state.failed.delete(task.id);
      if (task.contractId) {
        let contract = state.contracts.get(task.contractId);
        if (!contract) {
          contract = {
            contractId: task.contractId,
            status: "executing",
            tasks: [],
            evidence: [],
          };
          state.contracts.set(task.contractId, contract);
        }
        if (!contract.tasks.includes(task.id)) contract.tasks.push(task.id);
        contract.status = "executing";
        delete contract.error;
      }
    }
    state.backlog.push(...candidates);
    state.backlog.sort(compareTasks);
  }
  function refreshContracts(): void {
    for (const contract of state.contracts.values()) {
      if (contract.status === "planning" || contract.error) continue;
      contract.status = contract.tasks.some((id) => state.failed.has(id))
        ? "failed"
        : contract.tasks.every((id) => state.completed.has(id))
          ? "completed"
          : "executing";
    }
  }
  function reject(command: ProjectCommand, error: unknown): void {
    rejections.push({ command: command.type, error: text(error) });
    if (rejections.length > 100) rejections.shift();
  }
  async function processCommand(command: ProjectCommand): Promise<void> {
    try {
      switch (command.type) {
        case "add-task": {
          const { taskId, ...task } = command.value;
          insert([{ ...task, id: taskId, createdAt: timestamp() }]);
          break;
        }
        case "add-batch":
          insert(command.value.tasks);
          break;
        case "new-contract": {
          const value = command.value;
          if (!identity(value.contractId)) invalid("Invalid contract ID");
          if (state.contracts.has(value.contractId)) break;
          const contract = {
            ...value,
            status: "planning" as const,
            tasks: [],
            evidence: [],
          };
          state.contracts.set(value.contractId, contract);
          try {
            const tasks = await act.planTasks({ ...repository, ...value });
            if (tasks.some((t) => t.contractId !== value.contractId))
              invalid("Plan references another contract");
            insert(tasks);
            state.contracts.get(value.contractId)!.status = "executing";
          } catch (error) {
            const stored = state.contracts.get(value.contractId)!;
            stored.status = "failed";
            stored.error = text(error);
          }
          break;
        }
        case "remove-task": {
          const id = command.value.taskId;
          if (activeTasks.has(id)) invalid("Cannot remove a running task");
          if (state.backlog.some((t) => t.dependsOn.includes(id)))
            invalid("Cannot remove a required dependency");
          state.backlog = state.backlog.filter((t) => t.id !== id);
          for (const contract of state.contracts.values())
            contract.tasks = contract.tasks.filter((t) => t !== id);
          break;
        }
        case "reorder": {
          const ids = command.value.taskIds;
          if (
            ids.length !== state.backlog.length ||
            new Set(ids).size !== ids.length ||
            ids.some((id) => !state.backlog.some((t) => t.id === id))
          )
            invalid("Reorder must contain every backlog task once");
          state.backlog = ids.map((id, index) => ({
            ...state.backlog.find((t) => t.id === id)!,
            priority: ids.length - index,
          }));
          break;
        }
        case "update-config": {
          const config = createConfig(command.value.config, state.config);
          if (config.maxWorktrees < state.git.worktrees.size)
            invalid("Cannot shrink below allocated worktrees");
          state.config = config;
          state.evidence = state.evidence.slice(-config.evidenceRetention);
          for (const contract of state.contracts.values())
            contract.evidence = contract.evidence.slice(
              -config.evidenceRetention,
            );
          break;
        }
      }
      refreshContracts();
    } catch (error) {
      if (isCancellation(error)) throw error;
      reject(command, error);
    }
  }
  function requestCancellations(): void {
    if (force)
      for (const handle of state.runningChildren.values())
        void cancelChild(handle.workflowId);
  }
  // Keep immediate control responsive even when the main loop is awaiting external I/O.
  async function controlled<T>(action: () => Promise<T>): Promise<T> {
    let settled = false;
    const operation = action().finally(() => {
      settled = true;
    });
    while (!settled) {
      requestCancellations();
      const observed = version;
      const scope = new CancellationScope();
      try {
        await scope.run(() =>
          Promise.race([operation, condition(() => version !== observed)]),
        );
      } finally {
        scope.cancel();
      }
    }
    requestCancellations();
    return operation;
  }
  async function maintain(action: () => Promise<void>): Promise<void> {
    while (true) {
      try {
        await action();
        maintenanceError = null;
        return;
      } catch (error) {
        if (isCancellation(error)) throw error;
        maintenanceError = text(error);
        await sleep("10s");
      }
    }
  }
  async function finish(event: Completion): Promise<void> {
    const { task, worktree } = event;
    let result = event.result;
    let retainedWorktree: WorktreeState | null = null;
    if (taskDelivery && event.prepared) {
      const completedAt = timestamp();
      await maintain(async () => {
        const outcome = await act.collectTaskRun({
          prepared: event.prepared!, timestamp: completedAt,
          ...(event.record ? { record: event.record } : {}),
          ...(event.result.error ? { error: event.result.error } : {}),
        });
        result = outcome;
        retainedWorktree = outcome.retainedWorktree;
      });
    }
    const evidence: Evidence[] = result.evidence.map((e, index) => ({
      id: `${worktree.id}-${index}`,
      taskId: task.id,
      ...(task.contractId ? { contractId: task.contractId } : {}),
      type: e.type,
      timestamp: new Date(e.timestamp).toISOString(),
      ...(e.data !== undefined ? { data: e.data } : {}),
      ...(e.refs ? { refs: e.refs } : {}),
    }));
    if (!result.success)
      evidence.push({
        id: `${worktree.id}-failure`,
        taskId: task.id,
        ...(task.contractId ? { contractId: task.contractId } : {}),
        type: "error",
        timestamp: timestamp(),
        data: result.error ?? "Child failed",
      });
    const workflowId = children.get(task.id)?.workflowId;
    if (workflowId) cancellations.delete(workflowId);
    state.runningChildren.delete(task.id);
    children.delete(task.id);
    if (result.success) state.completed.add(task.id);
    else state.failed.set(task.id, result.error ?? "Child failed");
    refreshContracts();
    lastProgress = timestamp();
    // Retain the slot until evidence and cleanup are durable; never exceed the pool on slow cleanup.
    await maintain(async () => {
      const refs = await act.storeEvidence({
        projectId: repository.projectId,
        evidence,
      });
      state.evidence = [
        ...state.evidence.filter((e) => !refs.some((r) => r.id === e.id)),
        ...refs,
      ].slice(-state.config.evidenceRetention);
      const contract = task.contractId
        ? state.contracts.get(task.contractId)
        : undefined;
      if (contract)
        contract.evidence = [
          ...contract.evidence.filter((e) => !refs.some((r) => r.id === e.id)),
          ...refs,
        ].slice(-state.config.evidenceRetention);
      if (!taskDelivery) await act.releaseWorktree({
        projectId: repository.projectId,
        taskId: task.id,
        worktreeId: worktree.id,
      });
    });
    if (retainedWorktree) state.git.worktrees.set(worktree.id, retainedWorktree);
    else state.git.worktrees.delete(worktree.id);
    activeTasks.delete(task.id);
  }
  async function dispatch(tasks: Task[]): Promise<void> {
    const assigned = await Promise.all(
      tasks.map(async (task) => {
        activeTasks.set(task.id, task);
        const leaseId = `${taskDelivery ? "task" : "wt"}-${++sequence}-${uuidv4()}`;
        try {
          const run = taskDelivery ? await act.prepareTaskRun({ ...repository, task, runId: leaseId }) : undefined;
          const worktree = run?.worktree ?? await act.assignWorktree({
            ...repository,
            taskId: task.id,
            leaseId,
            maxWorktrees: state.config.maxWorktrees,
          });
          state.git.worktrees.set(worktree.id, worktree);
          return { task, worktree, run };
        } catch (error) {
          // Only the legacy scheduler itself creates leases; Taskflow owns delivery workspaces.
          if (!taskDelivery) await maintain(() =>
            act.releaseWorktree({
              projectId: repository.projectId,
              taskId: task.id,
              worktreeId: leaseId,
            }),
          );
          const worktree: WorktreeState = {
            id: leaseId,
            taskId: task.id,
            path: "",
            branch: "",
            baseCommit: "",
            status: "error",
          };
          events.push({
            task,
            worktree,
            result: { success: false, evidence: [], error: text(error) },
          });
          return null;
        }
      }),
    );
    const prepared = assigned.filter((v) => v !== null);
    if (state.status !== "RUNNING") {
      await Promise.all(
        prepared.map(async ({ task, worktree }) => {
          if (!taskDelivery) await maintain(() =>
            act.releaseWorktree({
              projectId: repository.projectId,
              taskId: task.id,
              worktreeId: worktree.id,
            }),
          );
          activeTasks.delete(task.id);
          state.git.worktrees.delete(worktree.id);
          state.backlog.push(task);
        }),
      );
      return;
    }
    // All startChild calls are issued before awaiting any child's start acknowledgment.
    const starts = prepared.map(({ task, worktree, run }) => {
      const workflowId = run?.input.runId ?? `task-${task.id}-${uuidv4()}`;
      children.set(task.id, {
        workflowId,
        startedAt: timestamp(),
        worktree,
        heartbeat: null,
      });
      const options = {
        taskQueue: taskDelivery ? workflowInfo().taskQueue : "claith-orchestrator",
        workflowId,
        workflowRunTimeout: state.config.taskTimeout,
        retry: {
          maximumAttempts: state.config.taskRetryPolicy.maximumAttempts,
          initialInterval: state.config.taskRetryPolicy.initialIntervalMs,
          backoffCoefficient: state.config.taskRetryPolicy.backoffCoefficient,
          maximumInterval: state.config.taskRetryPolicy.maximumIntervalMs,
        },
        cancellationType:
          ChildWorkflowCancellationType.WAIT_CANCELLATION_COMPLETED,
        parentClosePolicy: ParentClosePolicy.REQUEST_CANCEL,
      };
      const child = run ? startChild<TaskDeliveryWorkflow>("taskWorkflow", { ...options, args: [run.input] }) :
        startChild<OrchestratorWorkflow>("orchestratorWorkflow", { ...options, args: [{
          projectId: repository.projectId, taskId: task.id,
          ...(task.contractId ? { contractId: task.contractId } : {}),
          payload: task.payload, worktree, evidenceRef: `evidence:${worktree.id}`,
        }] });
      return child.then(async (handle) => {
          state.runningChildren.set(task.id, handle);
          if (force) await cancelChild(handle.workflowId);
          return handle.result();
        })
        .then((result) => {
          if (result && "execution" in result) {
            if (!run) throw new Error("Invalid legacy child result");
            events.push({ task, worktree, prepared: run, record: result, result: { success: false, evidence: [] } });
            return;
          }
          if (run) throw new Error("Invalid task workflow result");
          if (
            !result ||
            typeof result.success !== "boolean" ||
            !Array.isArray(result.evidence) ||
            result.evidence.some(
              (e) =>
                !e ||
                ![
                  "log",
                  "artifact",
                  "test-result",
                  "check",
                  "review",
                  "error",
                ].includes(e.type) ||
                typeof e.timestamp !== "string" ||
                !Number.isFinite(Date.parse(e.timestamp)) ||
                !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(
                  e.timestamp,
                ) ||
                (e.refs !== undefined &&
                  (!Array.isArray(e.refs) ||
                    !e.refs.every((r) => typeof r === "string"))),
            ) ||
            (result.error !== undefined && typeof result.error !== "string")
          )
            throw new Error("Invalid child result");
          events.push({ task, worktree, result });
        })
        .catch((error) => {
          events.push({
            task,
            worktree,
            ...(run ? { prepared: run } : {}),
            result: { success: false, evidence: [], error: text(error) },
          });
        });
    });
    // Observe promises once; event queue retains simultaneous completions without race losers.
    void Promise.all(starts);
  }
  try {
    while (true) {
      requestCancellations();
      while (events.length)
        await CancellationScope.nonCancellable(() =>
          controlled(() => finish(events.shift()!)),
        );
      if (shuttingDown() && !activeTasks.size) {
        state.status = "SHUTDOWN";
        return;
      }
      const info = workflowInfo();
      const rotate =
        info.continueAsNewSuggested ||
        info.historyLength >= state.config.historyEventLimit;
      if (rotate && !activeTasks.size && !shuttingDown()) {
        await continueAsNew<typeof projectWorkflow>({
          ...input,
          config: state.config,
          checkpoint: {
            backlog: state.backlog,
            completed: [...state.completed],
            failed: [...state.failed],
            evidence: state.evidence,
            contracts: [...state.contracts.values()],
            worktrees: [...state.git.worktrees.values()],
            commands,
            status: state.status === "PAUSED" ? "PAUSED" : "RUNNING",
            ...(state.pauseReason ? { pauseReason: state.pauseReason } : {}),
            rejections,
            sequence,
          },
        });
      }
      if (state.status === "RUNNING") {
        while (commands.length && state.status === "RUNNING")
          await controlled(() => processCommand(commands.shift()!));
        if (state.status === "RUNNING" && !rotate) {
          const ready = state.backlog
            .filter((t) => t.dependsOn.every((d) => state.completed.has(d)))
            .sort(compareTasks)
            .slice(0, Math.max(0, Math.min(state.config.maxParallel - activeTasks.size,
              taskDelivery ? state.config.maxWorktrees - state.git.worktrees.size : Infinity)));
          if (ready.length) {
            const ids = new Set(ready.map((t) => t.id));
            state.backlog = state.backlog.filter((t) => !ids.has(t.id));
            await CancellationScope.nonCancellable(() =>
              controlled(() => dispatch(ready)),
            );
            continue;
          }
        }
      }
      if (events.length || (shuttingDown() && !activeTasks.size)) continue;
      requestCancellations();
      const observed = version;
      const scope = new CancellationScope();
      try {
        await scope.run(() =>
          Promise.race([
            condition(() => events.length > 0),
            condition(() => version !== observed),
          ]),
        );
      } finally {
        scope.cancel();
      }
    }
  } catch (error) {
    if (!isCancellation(error)) throw error;
    force = true;
    state.status = "SHUTTING_DOWN";
    await CancellationScope.nonCancellable(async () => {
      await Promise.all(
        [...state.runningChildren.values()].map((handle) =>
          cancelChild(handle.workflowId),
        ),
      );
      while (activeTasks.size) {
        if (!events.length) await condition(() => events.length > 0);
        while (events.length) await finish(events.shift()!);
      }
    });
    throw error;
  }
}
