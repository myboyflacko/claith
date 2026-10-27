import { z } from "zod";
import type { ExecutionConfiguration } from "../configuration.js";

export const identity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);
export const revision = z.string().regex(/^[a-f0-9]{40,64}$/);
export const commandSchema = z.strictObject({
  id: identity,
  command: z.string().trim().min(1),
});
export const criterionSchema = z.strictObject({
  id: identity,
  text: z.string().min(1),
  mode: z.enum(["check", "review", "human"]),
  checkId: identity.nullable(),
});
export const contractSchema = z
  .strictObject({
    taskId: identity,
    version: z.number().int().positive(),
    startingRevision: revision,
    title: z.string().min(1),
    outcome: z.string().min(1),
    boundaries: z.array(z.string().min(1)).min(1),
    dependencies: z.array(identity),
    acceptance: z.array(criterionSchema).min(1),
    setup: z.array(commandSchema),
    checks: z.array(commandSchema).min(1),
    review: z.boolean(),
    endpoint: z.literal("local-commit"),
  })
  .superRefine((c, ctx) => {
    for (const [name, ids] of [
      ["acceptance", c.acceptance.map((a) => a.id)],
      ["commands", [...c.setup, ...c.checks].map((a) => a.id)],
    ] as const) {
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({ code: "custom", message: `Duplicate ${name} IDs` });
    }
    if (
      new Set(c.dependencies).size !== c.dependencies.length ||
      c.dependencies.includes(c.taskId)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Dependencies must be unique predecessors",
      });
    }
    for (const a of c.acceptance) {
      if (
        (a.mode === "check" && !c.checks.some((ch) => ch.id === a.checkId)) ||
        (a.mode !== "check" && a.checkId !== null) ||
        (a.mode === "review" && !c.review)
      ) {
        ctx.addIssue({
          code: "custom",
          message: `Invalid evidence requirement for ${a.id}`,
        });
      }
    }
  });
export type DeliveryContract = z.infer<typeof contractSchema>;
export interface Conversation {
  id: string;
  text: string;
}
export interface OutlineTask {
  taskId: string;
  title: string;
  dependencies: string[];
}
export interface Proposal {
  message: string;
  outline: OutlineTask[];
  contract: DeliveryContract | null;
  goalComplete: boolean;
}
export interface CommandEvidence {
  id: string;
  command: string;
  exitCode: number | null;
  outputRef: string;
  revision: string;
  unchanged: boolean;
}
export interface Workspace {
  path: string;
  branch: string;
  base: string;
  artifactDir: string;
}
export interface Implementation {
  status: "submitted" | "blocked";
  summary: string;
  evidence: { criterionId: string; references: string[] }[];
}
export interface Review {
  taskId: string;
  attempt: number;
  revision: string;
  verdict: "accepted" | "changes_requested" | "blocked";
  summary: string;
  evidenceRefs: string[];
}
export interface Candidate {
  revision: string;
  diffRef: string;
  implementation: Implementation;
}
export interface TaskResult {
  taskId: string;
  executionId: string;
  acceptedCommit: string;
  workspace: Workspace;
  checks: CommandEvidence[];
  review: Review | null;
  evidence: Implementation["evidence"];
  humanConfirmations: string[];
  blockers: string[];
}
export interface Escalation {
  id: string;
  executionId: string;
  kind: "repair" | "blocker" | "recovery" | "acceptance";
  question: string;
  criteria: string[];
  reminders: number;
}
export type SessionState =
  | "idle"
  | "planning"
  | "awaiting_approval"
  | "running"
  | "waiting"
  | "completed"
  | "cancelled";
export interface TaskSnapshot {
  executionId: string;
  contract: DeliveryContract;
  attempt: number;
  repairsUsed: number;
  state: "running" | "waiting" | "completed" | "cancelled";
}
export interface SessionSnapshot {
  sessionId: string;
  project: string;
  state: SessionState;
  currentTask: TaskSnapshot | null;
  pendingEscalation: Escalation | null;
  proposal: Proposal | null;
  outline: OutlineTask[];
  acceptedResults: TaskResult[];
  conversation: Conversation[];
  messages: string[];
}
export interface SessionInput {
  sessionId: string;
  project: string;
  startingRevision: string;
  configuration: ExecutionConfiguration;
}
export interface Approval {
  commandId: string;
  taskId: string;
  version: number;
  configuration: ExecutionConfiguration;
}
export interface Decision {
  commandId: string;
  executionId: string;
  escalationId: string;
  answer: string;
  additionalRepairs: number;
  confirmCriteria: string[];
}
export interface TaskInput {
  sessionId: string;
  project: string;
  executionId: string;
  coordinatorId: string;
  contract: DeliveryContract;
  configuration: ExecutionConfiguration;
  dependencies: TaskResult[];
}
export interface AttemptInput extends TaskInput {
  attempt: number;
  feedback: string;
  workspace: Workspace;
}
export interface PlanInput {
  session: SessionSnapshot;
  startingRevision: string;
  configuration: ExecutionConfiguration;
}
export interface Activities {
  plan(input: PlanInput): Promise<Proposal>;
  prepare(input: TaskInput): Promise<Workspace>;
  implement(input: AttemptInput): Promise<Implementation>;
  candidate(
    input: AttemptInput & { implementation: Implementation },
  ): Promise<Candidate>;
  check(
    input: AttemptInput & { candidate: Candidate },
  ): Promise<CommandEvidence[]>;
  review(
    input: AttemptInput & { candidate: Candidate; checks: CommandEvidence[] },
  ): Promise<Review>;
  accept(input: AttemptInput & { result: TaskResult }): Promise<void>;
}
