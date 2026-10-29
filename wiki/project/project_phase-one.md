---
title: Phase One - Autonomous Phase Delivery
created: 2026-10-27
updated: 2026-10-29
tags: [project, architecture]
sources:
  - "[[project_goal]]"
  - "[[architecture_delivery-runtime]]"
  - "[[architecture_tooling]]"
---

# Phase One - Autonomous Phase Delivery

## Outcome and baseline

The next delivery slice is one small, fully exercised phase: the developer approves a desired behavior and fixed acceptance criteria; Claith plans and executes incremental work, integrates verified results into `dev`, and presents the whole result for human acceptance. Feedback leads to corrections. After acceptance and the agreed endpoint, the phase stops until the developer authorizes another phase.

This replaces the earlier task-by-task approval and general dynamic-plan direction. It builds on an existing TypeScript/Temporal/Pi task loop, not an empty scaffold. The baseline implements task proposals/approval, isolated worktrees, candidates, checks, optional review, shared repair limits, scoped human questions, cancellation, and recovery. A real Pi task and restart scenarios are recorded in `docs/acceptance.md`. Those results remain evidence for the baseline only.

This page describes the next implementation slice; it does not claim the phase lifecycle is already delivered or predefine the developer's later product phases.

## Required behavior

- **Phase contract and approval.** Agree a behavioral target, fixed criteria, boundaries, delivery endpoint, and authority once per phase. Separate that contract from tasks. Do not require approval of routine task dispatch or technical plan changes inside the contract.
- **Rolling planner.** Inspect the current `dev` state, choose the next useful behavior increment, and produce executable tasks with explicit dependencies and links to phase criteria. Inspect the integrated result before planning further work. Avoid planning every implementation detail of future phases up front.
- **Defined delivery lifecycle.** Reuse workspace preparation, implementation, candidate/check evidence, mandatory review for code changes, and bounded repairs. The runtime enforces eligibility and gates; the planner cannot skip them or invent executable capabilities.
- **Integration and push.** Start normal work from current `dev`, isolate task changes, integrate accepted work back into `dev`, validate the integrated revision, and push under phase authority. Reconcile changed integration bases and uncertain push effects before repeating work.
- **Phase-wide evidence.** Evaluate the combined behavior against the original criteria, including an independent final review. A completed task list, successful exit codes, or a planner's completion message alone cannot finish a phase.
- **Human acceptance and correction.** Present a ready-for-acceptance result. Convert feedback into a correction plan and repeat verification. Contract changes need explicit confirmation; ordinary corrections do not need individual task approvals. Close only after human acceptance and the agreed endpoint.
- **Durable boundaries.** Preserve the existing recovery, exclusive-writer, decision-scoping, cancellation, and disconnected-client behavior. Interrupt the developer during execution only when missing input/authority, a genuine blocker, or exhausted permitted recovery prevents safe progress.
- **Task persistence.** Persist contract and plan versions, tasks, dependencies, and evidence references independently of transient planner sessions. SQLite is the proposed application store; finalize its schema/driver as part of implementation. Temporal remains authoritative for execution, and database status views are derived from it.

Normal delivery for this first slice ends on verified, pushed `dev`. Milestone promotion to `main` and release/deployment belong to the overall direction but require their own implemented, explicitly authorized delivery capability. They must not be implied by every phase completion.

## Verification and acceptance scenarios

| Scenario                           | Required observation for the phase slice                                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One phase approval                 | An unapproved phase cannot start implementation; one approval permits multiple internal tasks/increments without further routine approvals.                                   |
| Adaptive planning                  | The next increment uses the actual integrated result and remaining phase criteria; the planner can split/add technical tasks without changing the contract.                   |
| Contract stability                 | Scope, criteria, or publication-authority changes cannot silently enter the run; recorded revisions identify what was approved.                                               |
| Dependency and quality gates       | Blocked tasks are not dispatched; failed checks/review return to bounded repairs, and evidence is bound to the resulting revision.                                            |
| Git delivery                       | Work starts from `dev`, unrelated changes survive integration, the integrated result is checked and pushed, and planning resumes from that state.                             |
| Whole-phase validation             | Green individual tasks cannot hide a missing or broken combined behavior. An independent review assesses the original criteria.                                               |
| Final human decision               | Automatic verification produces ready-for-acceptance; only explicit human acceptance and endpoint completion close the phase.                                                 |
| Feedback                           | Corrections produce further work and renewed evidence. Broader product requests become an explicit contract revision or a later phase.                                        |
| Stop after completion              | No background planner creates or starts the next phase after acceptance. Another phase requires a new human discussion/approval.                                              |
| Authority and permission snapshots | Planner/reviewer stay read-only; registry/configuration changes do not expand an active run's saved tools or publication rights.                                              |
| Recovery                           | Worker/client restart, interrupted integration/push, and database-projection interruption preserve identity and require reconciliation before uncertain effects are repeated. |
| Human waiting and limits           | Missing authority or exhausted recovery produces a scoped blocker; reminders, silence, stale replies, and duplicate commands cannot grant authority or complete the phase.    |

Start with deterministic doubles and a small repository to verify this lifecycle, then demonstrate a real phase containing more than one behavior increment and a human correction cycle. Use targeted tests and actual preserved artifacts; do not reinterpret the earlier task acceptance run as evidence for these new capabilities.

## Later capabilities

Add milestone publication on `main`, release/deployment, and other registered capabilities after the phase loop is usable. Broader parallel execution and a separate control UI can follow concrete needs. Standalone review remains a possible supported workflow; a general workflow editor, arbitrary agent hierarchy, and multi-harness support are not initial requirements.
