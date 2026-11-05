import { z } from "zod";

/**
 * Project Workflow Types
 * All interfaces for the Project Workflow state, signals, queries, and activities.
 */

// ============================================================================
// Configuration
// ============================================================================

export interface ProjectConfig {
  /** Maximum number of parallel child workflows */
  maxParallel: number;
  /** Maximum number of worktrees to maintain */
  maxWorktrees: number;
  /** Task retry policy */
  taskRetryPolicy: {
    maximumAttempts: number;
    initialIntervalMs: number;
    backoffCoefficient: number;
    maximumIntervalMs: number;
  };
  /** Task timeout in milliseconds */
  taskTimeout: number;
  /** Evidence retention: max items to keep in workflow memory */
  evidenceRetention: number;
  /** Heartbeat interval for child workflows in milliseconds */
  childHeartbeatIntervalMs: number;
}

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  maxParallel: 3,
  maxWorktrees: 5,
  taskRetryPolicy: {
    maximumAttempts: 3,
    initialIntervalMs: 5000,
    backoffCoefficient: 2.0,
    maximumIntervalMs: 60000,
  },
  taskTimeout: 3600000, // 1 hour
  evidenceRetention: 1000,
  childHeartbeatIntervalMs: 30000,
};

// ============================================================================
// Git / Worktree Types
// ============================================================================

export interface WorktreeState {
  id: string;
  path: string;
  branch: string;
  baseCommit: string;
  taskId: string | null; // null = free/available
  createdAt: string; // ISO timestamp from workflow.now()
  lastSyncedAt: string | null;
  status: "free" | "assigned" | "syncing" | "error";
  error?: string;
}

export interface ProjectWorkflowInput {
  gitUrl: string;
  defaultBranch?: string;
  sshKeyRef?: string;
  config?: Partial<ProjectConfig>;
}

// ============================================================================
// Task / Backlog Types
// ============================================================================

export interface Task {
  id: string;
  contractId: string;
  dependsOn: string[];
  payload: unknown;
  priority: number;
  createdAt: string; // ISO timestamp from workflow.now()
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface TaskWithStatus extends Task {
  status: TaskStatus;
  worktreeId?: string;
  childWorkflowId?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

// ============================================================================
// Evidence Types
// ============================================================================

export interface Evidence {
  id: string;
  taskId: string;
  contractId: string;
  type: "log" | "artifact" | "test-result" | "check" | "review" | "error";
  timestamp: string; // ISO timestamp
  data: unknown;
  refs?: string[]; // References to external storage (file paths, object IDs)
  metadata?: Record<string, unknown>;
}

export interface EvidenceQuery {
  taskId?: string;
  contractId?: string;
  type?: Evidence["type"];
  since?: string;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Contract Execution State
// ============================================================================

export interface ContractExecutionState {
  contractId: string;
  contractRef?: string; // Reference to contract source (file, URL, etc.)
  status: "planning" | "executing" | "completed" | "failed" | "paused";
  tasks: string[]; // Task IDs belonging to this contract
  evidence: Evidence[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Child Workflow Types
// ============================================================================

export interface ChildWorkflowInput {
  projectId: string;
  taskId: string;
  payload: unknown;
  worktree: WorktreeState;
  evidenceRef: string;
}

export interface ChildWorkflowResult {
  success: boolean;
  taskId: string;
  evidence: Evidence[];
  error?: string;
  worktreeId: string;
}

export interface ChildStatus {
  taskId: string;
  workflowId: string;
  worktreeId: string;
  startedAt: string;
  lastHeartbeat: string;
  status: "running" | "completed" | "failed" | "timed-out";
}

// ============================================================================
// Signal Payloads
// ============================================================================

export interface NewContractSignal {
  contractId: string;
  contractRef?: string;
}

export interface AddTaskSignal {
  taskId: string;
  contractId: string;
  dependsOn: string[];
  payload: unknown;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface AddBatchSignal {
  tasks: AddTaskSignal[];
}

export interface RemoveTaskSignal {
  taskId: string;
}

export interface ReorderSignal {
  taskIds: string[];
}

export interface PauseSignal {
  reason?: string;
}

export interface ResumeSignal {}

export interface ShutdownSignal {
  force?: boolean;
}

export interface UpdateConfigSignal {
  config: Partial<ProjectConfig>;
}

// ============================================================================
// Query Results
// ============================================================================

export interface GetBacklogResult {
  tasks: TaskWithStatus[];
  total: number;
}

export interface GetRunningResult {
  children: ChildStatus[];
  count: number;
}

export interface GetCompletedResult {
  taskIds: string[];
  count: number;
}

export interface GetFailedResult {
  failed: Map<string, string>; // taskId -> error
  count: number;
}

export interface GetEvidenceResult {
  evidence: Evidence[];
  total: number;
  hasMore: boolean;
}

export interface GetContractsResult {
  contracts: ContractExecutionState[];
  count: number;
}

export interface GetWorktreesResult {
  worktrees: WorktreeState[];
  free: number;
  assigned: number;
}

export interface GetHealthResult {
  status: ProjectStatus;
  backlogSize: number;
  runningCount: number;
  completedCount: number;
  failedCount: number;
  stuckSince?: string;
  errorRate: number;
  uptime: number;
  worktrees: {
    total: number;
    free: number;
    assigned: number;
  };
}

export type ProjectStatus = "RUNNING" | "PAUSED" | "SHUTTING_DOWN" | "SHUTDOWN";

// ============================================================================
// Project State (Internal)
// ============================================================================

export interface ProjectState {
  git: {
    remoteUrl: string;
    defaultBranch: string;
    sshKeyRef?: string;
    worktrees: Map<string, WorktreeState>;
  };
  backlog: Task[];
  runningChildren: Map<string, ChildWorkflowHandle>;
  completed: Set<string>;
  failed: Map<string, string>;
  evidence: Evidence[];
  contracts: Map<string, ContractExecutionState>;
  status: ProjectStatus;
  pauseReason?: string;
  config: ProjectConfig;
  startedAt: string;
  lastActivityAt: string;
}

export interface ChildWorkflowHandle {
  taskId: string;
  workflowId: string;
  worktreeId: string;
  handle: unknown; // WorkflowHandle<OrchestratorWorkflow> - typed in workflow
  startedAt: string;
  lastHeartbeat: string;
}

// ============================================================================
// Activity Input/Output Types
// ============================================================================

export interface CreateWorktreeInput {
  projectId: string;
  branch: string;
  baseCommit?: string;
}

export interface CreateWorktreeOutput {
  worktreeId: string;
  path: string;
  branch: string;
  baseCommit: string;
}

export interface AssignWorktreeInput {
  projectId: string;
  taskId: string;
  preferredBranch?: string;
}

export interface AssignWorktreeOutput {
  worktree: WorktreeState;
}

export interface ReleaseWorktreeInput {
  projectId: string;
  worktreeId: string;
  force?: boolean;
}

export interface ReleaseWorktreeOutput {
  released: boolean;
}

export interface SyncWorktreeInput {
  projectId: string;
  worktreeId: string;
  branch: string;
}

export interface SyncWorktreeOutput {
  synced: boolean;
  baseCommit: string;
}

export interface PlanTasksInput {
  projectId: string;
  contractId: string;
  contractRef?: string;
}

export interface PlanTasksOutput {
  tasks: AddTaskSignal[];
}

export interface StoreEvidenceInput {
  projectId: string;
  evidence: Evidence[];
}

export interface StoreEvidenceOutput {
  stored: number;
}

export interface QueryEvidenceInput {
  projectId: string;
  query: EvidenceQuery;
}

export interface QueryEvidenceOutput {
  evidence: Evidence[];
  total: number;
  hasMore: boolean;
}

// ============================================================================
// Zod Schemas for Validation
// ============================================================================

export const WorktreeStateSchema = z.object({
  id: z.string(),
  path: z.string(),
  branch: z.string(),
  baseCommit: z.string(),
  taskId: z.string().nullable(),
  createdAt: z.string(),
  lastSyncedAt: z.string().nullable(),
  status: z.enum(["free", "assigned", "syncing", "error"]),
  error: z.string().optional(),
});

export const TaskSchema = z.object({
  id: z.string(),
  contractId: z.string(),
  dependsOn: z.array(z.string()),
  payload: z.unknown(),
  priority: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export const EvidenceSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  contractId: z.string(),
  type: z.enum(["log", "artifact", "test-result", "check", "review", "error"]),
  timestamp: z.string(),
  data: z.unknown(),
  refs: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const ContractExecutionStateSchema = z.object({
  contractId: z.string(),
  contractRef: z.string().optional(),
  status: z.enum(["planning", "executing", "completed", "failed", "paused"]),
  tasks: z.array(z.string()),
  evidence: z.array(EvidenceSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const ProjectConfigSchema = z.object({
  maxParallel: z.number().int().positive().default(3),
  maxWorktrees: z.number().int().positive().default(5),
  taskRetryPolicy: z.object({
    maximumAttempts: z.number().int().positive().default(3),
    initialIntervalMs: z.number().positive().default(5000),
    backoffCoefficient: z.number().positive().default(2.0),
    maximumIntervalMs: z.number().positive().default(60000),
  }),
  taskTimeout: z.number().positive().default(3600000),
  evidenceRetention: z.number().int().positive().default(1000),
  childHeartbeatIntervalMs: z.number().positive().default(30000),
});