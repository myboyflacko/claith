---
id: project-workflow
type: module-design
status: draft
title: Repository project scheduler
---

## Responsibility

One durable project workflow per canonical Git URL schedules explicitly submitted tasks and contract task plans. This internal execution API does not approve phases, imply human acceptance, or autonomously extend a roadmap. The existing single-task delivery runtime remains independent. The orchestrator currently fails closed as an explicit stub.

## Boundary

Workflow code owns scheduling and replayable state; Activities alone access Git, files, secrets and SQLite. Workers poll their configured project queue and claith-orchestrator. ProjectClient derives project-{sha256(url)} identity keys; callers supply a consistent canonical URL. Closed projects can be explicitly restarted; running projects are reused without silently applying configuration.

## Scheduling and control

Signals synchronously queue commands. Pause defers mutations while allowing children to finish; resume/shutdown are immediate controls. Invalid commands appear in bounded rejection diagnostics rather than breaking workflow execution. Batch insertion is atomic, resolves same-batch dependencies and rejects cycles. A task ID cannot move between contracts; collisions reject the entire plan instead of silently completing an empty contract. Failed tasks require explicit resubmission; pending/running/completed duplicates within the same contract are ignored. Removing a required dependency is rejected. Reorder requires a complete backlog permutation and assigns explicit priorities.

Assignments reserve execution slots before external effects. Prepared Child starts are issued without intervening awaits. A completion queue retains simultaneous race outcomes. Graceful shutdown stops dispatch and drains children, leaving backlog unexecuted; force additionally requests cancellation and waits for terminal children before cleanup. Evidence is persisted before releasing worktrees. External cancellation reconciles in a noncancellable scope. Persistence/cleanup outages retry and expose a maintenance error rather than discarding evidence.

Long histories drain active children and Continue-As-New at a quiescent boundary, carrying queued commands, backlog, terminal identities, recent evidence and contracts. This bounds history, not lifetime task-ID/contract indexes. No TTL silently undermines dependencies or idempotency.

## Read API and evidence

Queries return JSON-safe snapshots, not Map/Set or live handles. get-evidence returns bounded recent references, also bounded per contract. ProjectClient.evidence executes a short read workflow/activity to page complete SQLite history; Queries cannot schedule Activities. Heartbeats remain null until a real progress protocol exists. Contract completed denotes successful task execution, never human phase acceptance.

Evidence writes use SQLite transactions and stable project/evidence IDs; changed content under an existing ID is rejected. Large data remains in SQLite/artifacts rather than closure state.

## Activity adapters

Managed clones, lease manifests, evidence databases and references are isolated by Temporal namespace as well as project identity beneath the Claith root. Persistent lease manifests and exclusive ownership locks isolate all Git writes. Git commands use the durable process-group runner, with launch records in the ownership directory before execution; recovery refuses mutation while a prior group is alive. Leases are recorded before Git mutations; retries reconcile without resetting work. Release removes only the owned worktree, retaining unintegrated branches. Explicit sync resets a managed worktree to the requested remote branch. maxWorktrees includes uncertain leases, not arbitrary caller checkouts.

Contract planning loads a JSON object with contractId and a tasks array from contractRef; AI decomposition is deferred. SSH references need a worker-side secret resolver, never key material in history.
