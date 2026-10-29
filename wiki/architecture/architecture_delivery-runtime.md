---
title: Delivery Runtime Architecture
created: 2026-10-27
updated: 2026-10-29
tags: [architecture]
sources:
  - "[[project_goal]]"
  - https://docs.temporal.io/encyclopedia/event-history
  - https://docs.temporal.io/develop/typescript/workflows/message-passing
  - https://www.sqlite.org/whentouse.html
---

# Delivery Runtime Architecture

## Direction and current implementation

The accepted direction is a human-approved phase contract, rolling behavior planning, and a deterministic delivery runtime. Temporal owns durable execution, and Pi runs the planner, implementer, and reviewer inside activities. TypeScript on Node.js 24 remains the application stack. This serves [[project_goal]].

The repository now implements direct single-task delivery with a parent task workflow, separate Implementer/Reviewer Child Workflows per attempt, fresh role sessions, a bounded Critic Loop, isolated checked integration, push to `origin/dev`, cleanup, and scoped recovery. The old planner-chat/coordinator approval flow has been removed. This task runner is the execution foundation for the phase model; phase approval, rolling Planner dispatch, SQLite and final human phase acceptance are not implemented. Code and configuration remain authoritative; [[architecture_tooling]] documents the current interfaces.

## Domain language and ownership

| Term               | Meaning and owner                                                                                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase              | The bounded target state the developer authorizes Claith to reach. Its size may correspond to a small task, a feature, or part of an epic.                                                                     |
| Delivery Contract  | The approved phase outcome, fixed acceptance criteria, boundaries, delivery endpoint, and authority. It comes from the developer's intent; tasks are derived from it. Material changes require human approval. |
| Behavior increment | The next useful, observable improvement toward the phase target. It is selected using the actual code and evidence left by earlier work.                                                                       |
| Task plan          | A versioned decomposition of the next increment into tasks and dependencies. It can evolve inside the contract without individual human task approvals.                                                        |
| Task               | An executable unit contributing to contract criteria, with clear inputs, dependencies, expected result, and verification. A completed task does not by itself complete the phase.                              |
| Delivery Run       | An execution of an approved contract version, with a stable Claith identity distinct from Temporal's own Run ID.                                                                                               |
| Attempt            | A bounded execution or repair attempt for a task or delivery step.                                                                                                                                             |
| Escalation         | A recorded request for missing input, authority, reconciliation, or a contract decision that the runtime cannot resolve on its own.                                                                            |

The planner is the developer's reasoning partner for goals and phases. It creates executable tasks and later evaluates the changed system to plan the next increment. It does not write the implementation or own the scheduler. The former `orchestrator` Pi role performed planning in the retired chat path; a separate AI orchestrator is not required by the target architecture.

| Component         | Responsibility                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planner           | Clarify behavior and criteria, draft the phase contract, plan the next increment, and propose technical replanning or tasks for human feedback.      |
| Temporal workflow | Own execution progress, select eligible tasks, enforce the lifecycle and authority, validate results, and manage repairs, waiting, and cancellation. |
| Activity worker   | Run agents or deterministic operations and validate/reconcile their external effects.                                                                |
| Implementer       | Implement the assigned task within its approved phase context and submit structured evidence or a blocker.                                           |
| Reviewer          | Independently assess a specific candidate and, at phase completion, the integrated behavior against the phase contract.                              |
| Control client/UI | Present plans, evidence, progress, blockers, and results; submit phase approvals, feedback, acceptance, and cancellation.                            |

## Phase lifecycle and rolling planning

1. The developer and planner establish a target state, fixed criteria, boundaries, and delivery endpoint. The phase contract is explicitly approved before implementation.
2. The planner inspects the current `dev` state and plans the next meaningful behavior increment with its tasks and dependencies. Planning can occur during phase preparation, but a complete product-wide task breakdown is not required.
3. The runtime executes eligible tasks through the defined quality gates. Normal technical decisions and bounded repairs do not need human approval.
4. Accepted changes are integrated into `dev`, checked as an integrated result, and pushed. The planner inspects that actual result and the remaining phase criteria before planning more work.
5. Once the criteria have evidence on the integrated result, an independent final assessment checks the whole phase. Passing isolated task checks is insufficient. The phase becomes **ready for acceptance** and waits for the developer.
6. Human feedback produces a correction plan, followed by implementation and renewed verification/review. Feedback that changes the agreed scope or criteria requires an explicit contract revision; ordinary corrections stay within the existing contract.
7. The phase is **completed** only after human acceptance and all agreed delivery actions. No next phase starts until the developer discusses and approves it.

The phase states are conceptually in progress, ready for acceptance, in correction, and completed; cancellation and unresolved blockers remain distinct. These are target domain states, not claims about current TypeScript enum names. Automatic evidence collection never substitutes for final human phase acceptance.

## Fixed lifecycle, adaptable task plan

One authoritative phase run owns the approved contract, current task plan, and overall progress. Each task runner starts separate Implementer and Reviewer Child Workflows per attempt. The task parent owns the repair loop and worktree; role children coordinate their own Activities and do not become separately human-approved delivery contracts.

For the initial phase implementation, use a defined implementation lifecycle: prepare workspace, implement, create candidate, run checks, review, and perform bounded repairs. Review is mandatory for code changes in both the task runner and the target phase lifecycle. All review findings must be resolved.

Task count, decomposition, dependencies, and technical solutions remain adaptable. The planner can split tasks or add necessary technical work within the contract, but cannot waive checks, enlarge authority, weaken criteria, or invent arbitrary executable steps. Newly needed capabilities must be implemented and registered before use. A general graph editor and arbitrary per-run pipelines are not the initial product.

Before acceptance, verify combined changes against the phase criteria through integration checks and an independent phase review. Any revision change invalidates check/review evidence for the previous revision; it does not automatically revoke the approved phase contract.

Broader capabilities such as standalone review, infrastructure work, security checks, release, and deployment may be added as supported workflows with explicit gates. They are not prerequisites for the first phase lifecycle. The earlier requirement to build a general dynamic runner and a review-only path as the first slice is superseded by this narrower delivery direction.

## Git and delivery authority

Normal development starts from the current verified `dev`. Writable tasks use isolated purpose branches/worktrees, and accepted work is integrated back into `dev`, followed by integration verification and push. The next increment is planned against that resulting state. Changes must be reconciled and rechecked if the integration base has changed; integration must not discard unrelated work or reuse evidence for another revision.

`main` is reserved for an explicitly agreed milestone promotion and publication process, for example after an accepted phase. A push to `dev`, promotion to `main`, and an external release/deployment are different operations. The contract must define which endpoint and permissions apply. Merely reaching a phase boundary does not grant publishing authority. The task runner already integrates/pushes to dev; milestone publishing remains to be implemented; phase closure still requires the agreed endpoint and human acceptance.

This is product behavior for future Claith deliveries. It does not itself authorize the coding assistant to push, merge, or publish the repository during unrelated maintenance; the repository's working instructions continue to apply.

## Persistence and state authority

SQLite is the proposed local application store per runtime for phase/feature records, contract versions, plan versions, tasks, dependencies, approvals, and artifact references. Its use was recommended in the design discussion; schema, driver, and migration details remain to be settled during implementation. There is currently no Claith application database. The SQLite used by the local Temporal service is a different store.

Temporal remains authoritative for running execution state: dispatched work, attempts, pending questions, decisions, timers, and progress. Task-status views stored in an application database are projections of that execution state, not a second scheduler. Agents use validated application commands/tools rather than granting themselves work by editing database rows.

Approval binds a contract version, initial plan version, and execution configuration. The workflow receives a recorded snapshot or immutable reference; it must not consult mutable database rows directly during replay. Plan revisions arrive through recorded activity results or validated workflow messages, so external task-source edits cannot silently alter an active run. Model calls and database/file/network operations belong in activities.

Large transcripts, outputs, and diffs remain durable artifacts with references rather than being embedded in workflow history. The workflow and its projections must be reconcilable after an interrupted database write or external effect. A separate broker or general event inbox is not required for the initial phase runtime.

Temporal activity completion advances the waiting workflow without an additional agent-generated completion signal. Use Updates for human commands that need validation/confirmation, Signals for asynchronous notifications, and Queries for current state. A shared task queue with bounded worker concurrency is sufficient; project identity does not require a queue per project. Shared writable repositories still require explicit coordination.

Workflow code must remain deterministic on replay and compatible with active execution histories, using workflow versioning when necessary. Long-lived phase runs may need Continue-As-New with explicitly carried state; this is an extension requirement, not a feature implemented by the current task workflow. Disconnecting a client does not cancel the run.

## Evidence, escalation, and recovery

Each task contributes to identified phase criteria. Evidence must name the relevant code revision and resolve to recorded checks, review findings, or explicit human confirmation. The final reviewer compares the original phase contract with the integrated result, not only task summaries. Text boundaries and artifact references alone do not prove semantic correctness; improving that verification is part of the phase slice.

Role sessions are separate. The worker enforces tool rights, validates structured completion and identity, waits for agent execution to finish, and flushes audit logs before accepting results. The existing custom tools and permission registry are documented in [[architecture_tooling]].

Humans normally define/approve a phase and assess its final result. Earlier interruption is reserved for genuine blockers, exhausted authorized recovery, missing authority/input, or a required contract change. Silence and reminders never approve work. Decisions are tied to the pending escalation and run so stale or duplicate replies cannot unblock unrelated work.

Activities may execute more than once. Preserve stable operation identities, bounded retries, exclusive workspace ownership, and reconciliation of uncertain effects before repeating work. Publish operations require the same discipline once implemented. The existing task runtime has recovery evidence, but this does not establish exactly-once external effects or prove the future phase/publish loop.

The runtime continues while the client is disconnected. Waiting and cancellation remain durable. A completed phase remains idle until another phase is explicitly authorized; it cannot automatically grow a roadmap of additional improvements.
