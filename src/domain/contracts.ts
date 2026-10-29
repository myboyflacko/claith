import { z } from "zod";
import type { ExecutionConfiguration } from "../configuration.js";

export const identity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);
export const runIdentity = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/);
export const revision = z.string().regex(/^[a-f0-9]{40,64}$/);
export const commandSchema = z.strictObject({
  id: identity,
  command: z.string().trim().min(1),
});
export const criterionSchema = z.strictObject({
  id: identity,
  text: z.string().trim().min(1),
  mode: z.enum(["check", "review"]),
  checkId: identity.nullable(),
});
export const contractSchema = z
  .strictObject({
    taskId: identity,
    version: z.number().int().positive(),
    startCommit: revision,
    title: z.string().trim().min(1),
    tasks: z.string().min(1),
    goal: z.string().trim().min(1),
    context: z.string(),
    scope: z.string(),
    constraints: z.string(),
    acceptanceCriteria: z.array(criterionSchema).min(1),
    setup: z.array(commandSchema).default([]),
    checks: z.array(commandSchema).min(1),
  })
  .superRefine((c, ctx) => {
    for (const ids of [
      c.acceptanceCriteria.map((a) => a.id),
      [...c.setup, ...c.checks].map((a) => a.id),
    ]) {
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({
          code: "custom",
          message: "Duplicate criterion or command IDs",
        });
    }
    for (const a of c.acceptanceCriteria) {
      if (
        a.mode === "check"
          ? !c.checks.some((ch) => ch.id === a.checkId)
          : a.checkId !== null
      )
        ctx.addIssue({
          code: "custom",
          message: `Invalid verification for ${a.id}`,
        });
    }
  });
export type TaskContract = z.infer<typeof contractSchema>;
export interface RunInput {
  runId: string;
  project: string;
  contract: TaskContract;
  configuration: ExecutionConfiguration;
}
export interface Workspace {
  path: string;
  branch: string;
  base: string;
  artifactDir: string;
}
export interface CommandEvidence {
  id: string;
  command: string;
  exitCode: number | null;
  outputRef: string;
  revision: string;
  unchanged: boolean;
}
const submissionIdentity = z.strictObject({
  runId: runIdentity,
  taskId: identity,
  version: z.number().int().positive(),
  attempt: z.number().int().nonnegative(),
  revision,
});
export const implementationSchema = submissionIdentity.extend({
  status: z.enum(["submitted", "blocked"]),
  summary: z.string().min(1),
  evidence: z.array(
    z.strictObject({
      criterionId: identity,
      references: z.array(z.string().min(1)),
    }),
  ),
});
export const reviewSchema = submissionIdentity.extend({
  verdict: z.enum(["accepted", "changes_requested", "blocked"]),
  summary: z.string().min(1),
  findings: z.array(z.strictObject({ id: identity, text: z.string().min(1) })),
  criteria: z.array(
    z.strictObject({
      criterionId: identity,
      satisfied: z.boolean(),
      references: z.array(z.string().min(1)),
    }),
  ),
});
export type Implementation = z.infer<typeof implementationSchema>;
export type Review = z.infer<typeof reviewSchema>;
export interface AgentResult<T> {
  sessionId: string;
  submission: T;
}
export interface Candidate {
  revision: string;
  diffRef: string;
}
export interface AttemptInput extends RunInput {
  workspace: Workspace;
  attempt: number;
  feedback: string;
}
export interface ReviewInput extends AttemptInput {
  candidate: Candidate;
  checks: CommandEvidence[];
}
export interface ImplementerResult {
  implementation: AgentResult<Implementation>;
  candidate: Candidate | null;
  checks: CommandEvidence[];
}
export interface AttemptRecord {
  attempt: number;
  implementerWorkflowId: string;
  reviewerWorkflowId: string | null;
  result: ImplementerResult | null;
  review: AgentResult<Review> | null;
  integration: Integration | null;
}
export interface Integration {
  revision: string;
  path: string;
  branch: string;
  checks: CommandEvidence[];
}
export type Stage =
  | "prepare"
  | "setup"
  | "implement"
  | "review"
  | "integrate"
  | "push"
  | "cleanup"
  | "done";
export type BlockKind =
  "base_changed" | "repair" | "agent" | "recovery" | "delivery";
export interface SessionReference {
  role: "implementer" | "reviewer";
  attempt: number;
  sessionId: string;
  path: string;
}
export interface RunRecord {
  contract: TaskContract;
  execution: {
    runId: string;
    project: string;
    configuration: ExecutionConfiguration;
    status: "running" | "blocked" | "completed" | "cancelled";
    stage: Stage;
    repairsUsed: number;
    repairBudget: number;
    blocked: { id: string; kind: BlockKind; message: string } | null;
    workspace: Workspace | null;
    sessions: SessionReference[];
    attempts: AttemptRecord[];
    integration: Integration | null;
    pushed: boolean;
    cleaned: boolean;
  };
}
export interface Resume {
  commandId: string;
  blockerId: string;
  additionalRepairs: number;
}
export interface WorkInput extends RunInput {
  workspace: Workspace;
}
export interface DeliveryInput extends ReviewInput {
  review: AgentResult<Review>;
}
export interface IntegrationInput extends RunInput {
  workspace: Workspace;
  integration: Integration;
}
export interface Activities {
  prepare(input: RunInput): Promise<Workspace>;
  setup(input: WorkInput): Promise<void>;
  implement(input: AttemptInput): Promise<AgentResult<Implementation>>;
  candidate(input: AttemptInput): Promise<Candidate>;
  check(input: ReviewInput): Promise<CommandEvidence[]>;
  review(input: ReviewInput): Promise<AgentResult<Review>>;
  integrate(input: DeliveryInput): Promise<Integration>;
  push(input: IntegrationInput): Promise<void>;
  cleanup(input: IntegrationInput): Promise<void>;
  record(input: RunRecord): Promise<SessionReference[]>;
}
export function checksPassed(
  contract: TaskContract,
  checks: CommandEvidence[],
  commit: string,
): boolean {
  return (
    checks.length === contract.checks.length &&
    contract.checks.every((c) =>
      checks.some(
        (e) =>
          e.id === c.id &&
          e.command === c.command &&
          e.exitCode === 0 &&
          e.unchanged &&
          e.revision === commit,
      ),
    )
  );
}
export function assertSubmission(
  input: AttemptInput,
  value: Implementation | Review,
  commit: string,
): void {
  if (
    value.runId !== input.runId ||
    value.taskId !== input.contract.taskId ||
    value.version !== input.contract.version ||
    value.attempt !== input.attempt ||
    value.revision !== commit
  )
    throw new Error("Stale or mismatched submission");
}
export function assertReview(input: ReviewInput, review: Review): void {
  assertSubmission(input, review, input.candidate.revision);
  const ids = review.criteria.map((c) => c.criterionId);
  if (
    new Set(ids).size !== ids.length ||
    review.criteria.some(
      (c) =>
        !input.contract.acceptanceCriteria.some((a) => a.id === c.criterionId),
    )
  )
    throw new Error("Unknown or duplicate review criteria");
  if (new Set(review.findings.map((f) => f.id)).size !== review.findings.length)
    throw new Error("Duplicate findings");
  for (const c of review.criteria) {
    if (
      c.references.some(
        (ref) => ref !== "diff" && !input.checks.some((ch) => ch.id === ref),
      )
    )
      throw new Error("Unknown evidence reference");
  }
  if (
    review.verdict === "accepted" &&
    (review.findings.length ||
      !checksPassed(input.contract, input.checks, input.candidate.revision) ||
      input.contract.acceptanceCriteria.some(
        (a) =>
          !review.criteria.some(
            (c) =>
              c.criterionId === a.id &&
              c.satisfied &&
              c.references.length &&
              (a.mode !== "check" || c.references.includes(a.checkId!)),
          ),
      ))
  )
    throw new Error(
      "Acceptance requires all criteria, passing checks and no findings",
    );
}
