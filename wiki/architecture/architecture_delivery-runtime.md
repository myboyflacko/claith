---
title: Delivery Runtime Architecture
created: 2026-10-27
updated: 2026-10-27
tags: [architecture]
sources:
  - "[[project_goal]]"
  - https://docs.temporal.io/evaluate/understanding-temporal
  - https://docs.temporal.io/develop/typescript/workflows/message-passing
  - https://docs.temporal.io/develop/typescript/workflows/timers
  - https://docs.temporal.io/develop/typescript/workflows/continue-as-new
  - https://docs.temporal.io/develop/typescript/workflows/versioning
  - https://docs.temporal.io/activity-definition
  - https://pi.dev/docs/latest/sdk
---

# Delivery Runtime Architecture

## Decision and implementation status

Claith selects Temporal for durable workflow orchestration and the Pi SDK for agent execution. The target application runtime and workers use TypeScript on Node.js so they can embed Pi directly. This is the accepted direction; the repository currently implements a Python/LangGraph workflow with a Codex adapter and in-memory messaging and checkpointing. The migration and its practical validation belong to [[project_phase-one]].

This design serves [[project_goal]]: a self-hosted runtime turns an approved Delivery Contract into an evidence-backed outcome. Trading systems are a separate topic and are outside Claith's scope.

Temporal is selected because task dispatch, durable timers, retries, and recovery belong to one execution runtime. LangGraph can also express dynamic plans and persistent agent workflows; the decision is about coordinating these operational responsibilities, not a demonstrated performance advantage. Claith accepts the additional Temporal deployment and workflow-versioning responsibilities.

## Language and ownership

| Term | Meaning and owner |
| --- | --- |
| Delivery Contract | Human-approved outcome, boundaries, acceptance criteria, and delivery endpoint. Contract changes require human approval. |
| Execution Plan | Versioned selection of steps, dependencies, and bounded repair policies for one contract. Claith may adapt it within approved boundaries. |
| Delivery Run | One execution of a particular approved contract version, identified by project and a stable Claith run ID. |
| Step | A planned unit of work requiring a registered capability and defined inputs and completion conditions. |
| Attempt | One execution attempt of a step. Technical retries and review-driven repair rounds are tracked separately. |
| Escalation | A recorded blocker or decision request with an ID, reason, allowed responses, and optional deadline. |

The main AI orchestrator is the developer's contact across projects. Project or team planning sessions scope their context to the relevant project and produce contracts and plans. These are logical agent roles activated when needed. The Temporal workflow is application code that executes the approved plan; it is not the AI planner.

| Component | Responsibility |
| --- | --- |
| Orchestrator | Draft contracts and plans, explain progress, and route questions to an authorized agent or human. |
| Temporal workflow | Own a run's execution state, choose the next eligible step, evaluate results, and manage bounded repairs and escalation. |
| Activity worker | Execute registered agent or deterministic capabilities, validate their outputs, and reconcile uncertain external effects before repeating work. |
| Pi SDK | Provide model access, role sessions, tools, and agent lifecycle events inside activities. |
| API and UI | Authenticate commands, enforce authority, submit decisions, and present state, chats, and evidence. The UI is a control surface. |

The control UI supports planning and resolving problems without requiring a code editor. Agents receive relevant project wiki context; global access by the orchestrator does not imply loading every wiki into every session.

## Dynamic execution

There is one workflow per Delivery Run. Its code implements a reusable plan runner. Individual runs receive different plans, such as `review`, `implement -> review`, or later `implement -> review -> security -> publish`. A standalone review references an existing code revision. A publish step requires a contract whose endpoint authorizes that action.

The runner repeatedly selects an eligible step, invokes its activity, validates the result, and updates progress. Dependencies, required verdicts, evidence, and repair limits govern eligibility. A failed review does not simply advance a list index. Any code changes invalidate approvals and checks for the previous revision.

A capability registry maps approved capability names to activity implementations and agent profiles. A new combination is plan data. A new capability requires implemented, validated worker code and deployment. The planner cannot introduce executable code, grant tools, or bypass required checks by inventing a step name.

Plan revisions arrive through recorded activity results or validated workflow messages. Workflow decisions must remain deterministic on replay. Model calls, repository operations, and other external effects belong in activities. Changes to workflow code must preserve compatibility with active executions or use Temporal's versioning mechanisms.

## Events, queues, and state

Temporal supplies task queues and records workflow execution history. A worker may serve many runs with bounded concurrency. Project and run IDs identify the correct execution; creating a queue for every project is not required. Runs that share a writable workspace must not write concurrently. Phase one uses isolated Git worktrees and excludes overlapping attempts within a run.

Activity completion already advances its waiting workflow. Agents do not need to publish an extra signal after every step. Claith can record domain events for audit and presentation without using those events as a second workflow scheduler. An event records a fact; an API command or workflow activity requests an action.

External asynchronous notifications use Signals. Human decisions use Updates when the caller needs validation and confirmation. Queries expose run state. Message acceptance and business completion are separate: a Signal being accepted does not mean its request has been applied.

Phase one does not add a general event inbox or a separate broker. If later work requires controlled batching or serialization of external messages, synchronous handlers can append to a workflow-local inbox and the main method can drain it. That inbox and its processing rules are Claith code; Temporal records messages and reconstructs workflow state through replay.

State includes the contract and plan versions, project and run IDs, step progress, attempts, review rounds, code revisions, result references, and pending escalations. A Claith Delivery Run ID is distinct from Temporal's Run ID, which changes with Continue-As-New. The workflow's execution state is authoritative for progress; transcripts and tool output are separate artifacts. UI read models are derived views.

The backend runs continuously while individual workflows progress, wait, or finish. Closing the UI does not stop execution. Waiting uses Temporal conditions and durable timers. Long histories can use Continue-As-New, explicitly carrying state and unprocessed messages after active handlers finish. Completed contracts end their workflows.

## Agent completion and evidence

Implementer and reviewer have separate Pi sessions and tool profiles. Repository instructions, role instructions, and task context are composed explicitly. The runtime controls the effective tools; prompt instructions alone do not enforce permissions.

Agents submit structured results through Claith completion tools, initially `submit_implementation` and `submit_review`. The activity validates the schema and binds the submission to the run, step, attempt, review round, and reviewed code revision. It waits for agent execution to finish and flushes audit records before accepting completion. Assistant prose is retained for inspection, not used as the workflow decision protocol.

A missing completion call receives at most one correction prompt before the attempt is reported as unsuccessful or blocked. A crash, timeout, or cancellation is reported by the runtime even when the model cannot submit a result. `blocked`, `changes_requested`, technical failure, and successful completion have distinct meanings; submission of valid JSON alone does not prove success.

Verification references must resolve to recorded checks for the relevant code revision. Tool-call records correlate project, run, step, attempt, session, and tool-call IDs. Capture tool name, arguments, start, result or error, and available timing; a start without an end has an unknown outcome. Store transcripts, large outputs, diffs, and evidence in durable project-scoped artifacts, with references in Temporal state and history.

## Escalation and recovery

An agent blocker, exhausted review budget, exhausted technical recovery, or elapsed deadline can trigger escalation. The workflow records a pending escalation and routes it through the orchestrator or control interface. The request identifies the affected run, step or attempt, and allowed decisions.

Human replies use an Update that checks authorization, escalation ID, and current state before applying a decision. Late, duplicate, or superseded replies cannot unblock a different request. An authorized reply may resolve the blocker, grant a bounded continuation within the contract, or cancel. A material scope change requires approval of a changed contract.

A configurable durable timer can cause a reminder or further escalation. Silence never implies approval. Replies and timers are checked against the current pending escalation so a stale deadline cannot undo a resolved decision. Neither waiting nor a reminder completes the Delivery Contract.

Activities may execute more than once. Temporal does not make external effects exactly once. Use stable operation identities, bound retries, and reconcile repository, session, artifact, and external-system state before repeating uncertain work. Preserve completed results, exclude concurrent coding attempts in one workspace, and handle stale results explicitly. Future publish capabilities must reconcile an existing release or other external outcome before retrying.

## Performance and extension boundaries

Keep workflow inputs and history small: record decisions and artifact references, not each token or full transcript. Bound agent concurrency and per-repository writes. Measure dispatch latency, recovery, idle resource use, and representative agent workloads before making performance claims.

Later capabilities can include infrastructure, security, delivery, and publishing through the same registry and approved plan mechanism. A generic graph editor, marketplace, multiple harness integrations, self-modifying active contracts, and the full team hierarchy are outside phase one. Tool choices are maintained in [[architecture_tooling]].
