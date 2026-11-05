import type { ChildWorkflowHandle } from "@temporalio/workflow";

export interface ProjectConfig {
  maxParallel: number;
  maxWorktrees: number;
  taskRetryPolicy: {
    maximumAttempts: number;
    initialIntervalMs: number;
    backoffCoefficient: number;
    maximumIntervalMs: number;
  };
  taskTimeout: number;
  evidenceRetention: number;
  /** Rotate at a quiescent boundary; Temporal's own suggestion also triggers rotation. */
  historyEventLimit: number;
}
export interface ProjectWorkflowInput {
  gitUrl: string;
  defaultBranch?: string;
  sshKeyRef?: string;
  config?: Partial<ProjectConfig>;
  checkpoint?: ProjectCheckpoint;
}
export interface Task {
  id: string;
  contractId?: string;
  dependsOn: string[];
  payload: unknown;
  priority?: number;
  createdAt: string;
}
export interface Evidence {
  id: string;
  taskId: string;
  contractId?: string;
  type: "log" | "artifact" | "test-result" | "check" | "review" | "error";
  timestamp: string;
  data?: unknown;
  refs?: string[];
}
export interface EvidenceRef extends Omit<Evidence, "data"> {
  storageRef: string;
}
export interface WorktreeState {
  id: string;
  path: string;
  branch: string;
  baseCommit: string;
  taskId: string;
  status: "assigned" | "error";
}
export interface ContractExecutionState {
  contractId: string;
  contractRef?: string;
  status: "planning" | "executing" | "completed" | "failed";
  tasks: string[];
  evidence: EvidenceRef[];
  error?: string;
}
export interface ChildWorkflowInput {
  projectId: string;
  taskId: string;
  contractId?: string;
  payload: unknown;
  worktree: WorktreeState;
  evidenceRef: string;
}
export interface ChildWorkflowResult {
  success: boolean;
  evidence: Evidence[];
  error?: string;
}
export type OrchestratorWorkflow = (
  input: ChildWorkflowInput,
) => Promise<ChildWorkflowResult>;
export interface ChildStatus {
  workflowId: string;
  startedAt: string;
  worktree: WorktreeState;
  /** Null until a real orchestrator supplies progress; start time is not a heartbeat. */
  heartbeat: string | null;
}
export type ProjectStatus = "RUNNING" | "PAUSED" | "SHUTTING_DOWN" | "SHUTDOWN";
export interface ProjectState {
  git: {
    remoteUrl: string;
    defaultBranch: string;
    sshKeyRef?: string;
    worktrees: Map<string, WorktreeState>;
  };
  backlog: Task[];
  runningChildren: Map<string, ChildWorkflowHandle<OrchestratorWorkflow>>;
  completed: Set<string>;
  failed: Map<string, string>;
  evidence: EvidenceRef[];
  contracts: Map<string, ContractExecutionState>;
  status: ProjectStatus;
  pauseReason?: string;
  config: ProjectConfig;
}
export interface AddTaskSignal {
  taskId: string;
  contractId?: string;
  dependsOn: string[];
  payload: unknown;
  priority?: number;
}
export interface NewContractSignal {
  contractId: string;
  contractRef?: string;
}
export type ProjectCommand =
  | { type: "new-contract"; value: NewContractSignal }
  | { type: "add-task"; value: AddTaskSignal }
  | { type: "add-batch"; value: { tasks: Task[] } }
  | { type: "remove-task"; value: { taskId: string } }
  | { type: "reorder"; value: { taskIds: string[] } }
  | { type: "update-config"; value: { config: Partial<ProjectConfig> } };
export interface CommandRejection {
  command: ProjectCommand["type"];
  error: string;
}
export interface ProjectSnapshot {
  git: Omit<ProjectState["git"], "worktrees"> & { worktrees: WorktreeState[] };
  backlog: Task[];
  runningChildren: Record<string, ChildStatus>;
  completed: string[];
  failed: Record<string, string>;
  evidence: EvidenceRef[];
  contracts: ContractExecutionState[];
  status: ProjectStatus;
  pauseReason?: string;
  config: ProjectConfig;
  rejections: CommandRejection[];
  maintenanceError: string | null;
}
export interface ProjectHealth {
  status: ProjectStatus;
  backlogSize: number;
  runningCount: number;
  stuckSince?: string;
  errorRate: number;
}
export interface ProjectCheckpoint {
  backlog: Task[];
  completed: string[];
  failed: [string, string][];
  evidence: EvidenceRef[];
  contracts: ContractExecutionState[];
  worktrees: WorktreeState[];
  commands: ProjectCommand[];
  status: "RUNNING" | "PAUSED";
  pauseReason?: string;
  rejections: CommandRejection[];
  sequence: number;
}
export interface ProjectRepository {
  projectId: string;
  gitUrl: string;
  defaultBranch: string;
  sshKeyRef?: string;
}
export interface AssignWorktreeInput extends ProjectRepository {
  taskId: string;
  leaseId: string;
  maxWorktrees: number;
}
export interface ReleaseWorktreeInput {
  projectId: string;
  taskId: string;
  worktreeId: string;
}
export interface EvidenceQuery {
  taskId?: string;
  contractId?: string;
  offset?: number;
  limit?: number;
}
export interface EvidencePage {
  evidence: Evidence[];
  total: number;
  hasMore: boolean;
}
export interface ProjectActivities {
  createWorktree(input: AssignWorktreeInput): Promise<WorktreeState>;
  assignWorktree(input: AssignWorktreeInput): Promise<WorktreeState>;
  releaseWorktree(input: ReleaseWorktreeInput): Promise<void>;
  syncWorktree(input: {
    projectId: string;
    worktreeId: string;
    branch: string;
  }): Promise<void>;
  planTasks(input: ProjectRepository & NewContractSignal): Promise<Task[]>;
  storeEvidence(input: {
    projectId: string;
    evidence: Evidence[];
  }): Promise<EvidenceRef[]>;
  queryEvidence(input: {
    projectId: string;
    query: EvidenceQuery;
  }): Promise<EvidencePage>;
}
