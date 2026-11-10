---
id: project-workflow
type: submodule-design
status: draft
title: Repository project scheduler
parent: temporal-runtime
---

## Responsibility

The source defines one durable project workflow per canonical Git URL to schedule explicitly submitted tasks and JSON task plans through taskWorkflow. Standalone task submission shares that lifecycle. This internal execution API does not approve phases, imply human acceptance, or autonomously extend a roadmap.

`temporal-runtime` records the disconnected worker/agent wiring. The rules below describe existing source contracts; they are not a claim that the current CLI can execute them. Product requirements belong to `claith-goal`, and task-level contracts here are not approved phase Delivery Contracts.

## Boundary

Workflow code owns scheduling and replayable state; Activities alone access Git, files, secrets and SQLite. The Project Workflow owns capacity reservations and child/result aggregation, never candidate creation or deletion. TaskWorkflow calls its native prepare Activity, stores the actual workspace in execution.workspace and owns integration, push and cleanup. Implementers consume the workspace they receive.

New project executions start taskWorkflow on the configured project queue. The project-taskflow-v1 patch preserves original stub dispatch, defaults and cleanup for pre-patch histories; the orchestrator export and claith-orchestrator queue exist only for that compatibility path. ProjectClient derives project-{sha256(url)} identity keys; callers supply a consistent canonical URL. Closed projects can be explicitly restarted; running projects are reused without silently applying configuration.

## Scheduling and control

Current admission selects dependency-satisfied tasks from workflow backlog state by priority and creation time. There is no explicit SQLite task status/readiness gate. The required Planner-managed `ready` task source is a different, unimplemented boundary described in `planning-application` and `claith-architecture`; it must not be claimed as delivered by this scheduler.

Signals synchronously queue commands. Pause defers mutations while allowing children to finish; resume/shutdown are immediate controls. Invalid commands appear in bounded rejection diagnostics rather than breaking workflow execution. Batch insertion is atomic, resolves same-batch dependencies and rejects cycles. A task ID cannot move between contracts; collisions reject the entire plan instead of silently completing an empty contract. Failed tasks require explicit resubmission; pending/running/completed duplicates within the same contract are ignored. Removing a required dependency is rejected. Reorder requires a complete backlog permutation and assigns explicit priorities.

maxParallel defaults to one; explicitly larger values permit independent Taskflows concurrently. Raising it admits ready tasks; lowering it drains existing children without interrupting them. Both execution slots and candidate reservations constrain admission. maxWorktrees defaults to maxParallel plus two, including retained or uncertain allocations. Worker Activity capacity is a separate resource ceiling of eight per queue, not a replacement for project-level admission.

Assignments reserve slots before external effects. Prepared child starts are issued without intervening awaits; a completion queue retains simultaneous outcomes. A blocked Taskflow remains active and consumes its slot until resumed, cancelled or timed out. Graceful shutdown stops dispatch and drains children, leaving backlog unexecuted; force requests cancellation and awaits terminal children without deleting their workspaces. Evidence persistence precedes releasing candidate capacity. External cancellation reconciles in a noncancellable scope. Persistence/finalization outages expose a maintenance error and retry rather than discard evidence.

Each child uses an immutable dispatch-time dev revision. With the serial default, the next task snapshots dev after its predecessor finishes delivery. Parallel children can share a base; once one integrates, another can block with the existing base_changed safety check. The project does not automatically rebase, weaken verification or coordinate parallel integration.

Long histories drain active children and Continue-As-New at a quiescent boundary, carrying queued commands, backlog, terminal identities, recent evidence and contracts. This bounds history, not lifetime task-ID/contract indexes. No TTL silently undermines dependencies or idempotency.

## Read API and evidence

Queries return JSON-safe snapshots, not Map/Set or live handles. get-evidence returns bounded recent references, also bounded per contract. ProjectClient.evidence executes a short read workflow/activity to page complete SQLite history; Queries cannot schedule Activities. Heartbeats remain null until a real progress protocol exists. Contract completed denotes successful task execution, never human phase acceptance.

Evidence writes use SQLite transactions and stable project/evidence IDs; changed content under an existing ID is rejected. Large data remains in SQLite/artifacts rather than closure state.

## Task delivery adapters

Task payloads contain a matching TaskContract and optionally an ExecutionConfiguration; otherwise the worker loads its configured profiles. Preparation validates identity, snapshots configuration and the current dev revision, and persists an immutable RunInput before child dispatch. The child workflow ID is its runId, so existing task status/resume/cancel APIs can address project children. Current delivery supports dev only; project-specific delivery targets required by `claith-goal` are not implemented. New managed clones are bare; existing non-bare project clones require explicit reconciliation rather than silent replacement. Synchronizing dev is fast-forward-only under the native integration ownership lock.

Completion requires a matching RunRecord, accepted review bound to the verified candidate, passing integration checks and confirmed push/cleanup. Evidence points to actual check, review, diff, session and run artifacts. A returned non-completed record is not successful delivery.

Persistent dispatch reservations survive fresh project executions, not only replay and Continue-As-New. Startup reconciles them before admission; preparation also enforces the durable capacity limit. Reservations become releasable only after terminal cleanup proof and absence of owned candidate/integration workspaces, and are released only after project evidence is durable. Pausing or failing before child start may abandon an unused reservation without deleting anything. Failed or uncertain reservations remain charged, even if their directory is absent, and can require explicit reconciliation before capacity is recovered.

A Temporal timeout does not prove its Activity implementation stopped. In particular, a cancelled Taskflow with no confirmed cleanup cannot establish that a timed-out preparation will never create a workspace. Native preparation checks cancellation before queued mutations and candidate creation; conservative reservation retention covers late or unavailable cancellation. Native Activity defaults remain thirty minutes per invocation, ten-second heartbeat emission and a thirty-second heartbeat timeout; healthy heartbeats do not extend the execution deadline.

Managed clones, admission metadata, evidence databases and references are isolated by Temporal namespace and project identity beneath the Claith root. Short same-worker repository writes queue under the existing filesystem ownership lock; another process's live owner remains a blocker. Project Git commands use the durable process-group runner, recording launches before execution and refusing recovery while a prior group is alive. Legacy worktree lease/sync/release adapters remain available for pre-patch execution; they are not the creation or cleanup path for new project tasks.

Contract planning loads a JSON object with contractId and a tasks array from contractRef; it does not invoke the collaborative Planner or manage a SQLite task queue. SSH references need a worker-side secret resolver, never key material in history.
