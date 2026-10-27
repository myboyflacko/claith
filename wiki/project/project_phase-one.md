---
title: Phase One - Durable Delivery Loop
created: 2026-10-27
updated: 2026-10-27
tags: [project, architecture]
sources:
  - "[[project_goal]]"
  - "[[architecture_delivery-runtime]]"
  - "[[architecture_tooling]]"
---

# Phase One - Durable Delivery Loop

## Outcome

Deliver a small end-to-end slice of [[project_goal]]: the developer approves a bounded contract through an orchestrator entry point, Claith executes the required work in a repository, and the developer can inspect the result or answer a blocker. Temporal owns execution state and Pi runs the agents. Closing the control client or restarting a worker must not lose the run's recorded progress.

This phase implements and verifies the target runtime from the current TypeScript scaffold and persistent local Temporal service. The former Python/LangGraph/Codex implementation has already been removed at the requester's direction, superseding the earlier sequence of keeping it until the replacement slice worked. Its removal does not establish migrated behavior or a completed delivery loop. Framework suitability is checked through running workflows and recovery tests; it is not a throughput claim.

## Scope

1. **Minimal orchestrator and approval.** Provide one user-facing planning/control entry point for a selected project. Draft and validate a contract with outcome, boundaries, acceptance criteria, and endpoint; execution starts only after human approval. The developer requests an outcome rather than starting the implementer directly. A terminal or minimal API client is sufficient; a full chat UI and separate global/team planners are deferred.
2. **Two dynamic plans.** Run `review` against an existing revision and `implement -> review` through the same workflow definition and capability registry. Validate required inputs and authority before dispatch. Execute steps sequentially in this first slice. Review-only runs produce a review report; implementation runs produce a local code change with verification and review evidence. PR creation, merging, deployment, and publishing are later capabilities.
3. **Role sessions and completion.** Configure separate implementer and reviewer Pi sessions, developer instructions, and effective tool permissions. Use the completion tools and evidence checks defined in [[architecture_tooling]]. An absent or invalid submission cannot advance the plan. Allow one correction prompt for a missing valid submission before reporting failure or escalation.
4. **Bounded critic loop.** Allow at most three review rounds: the initial review and up to two implementation repairs followed by review. Re-review the resulting revision after each repair. A further continuation needs an explicit bounded human decision. A review verdict requesting changes is a business result, not a reason to blindly retry the same activity.
5. **Escalation and control.** Record blockers and exhausted budgets, surface questions through the orchestrator/control client, and accept validated human replies through Temporal Updates. Use Signals for suitable asynchronous external notifications. Support configurable reminder deadlines with durable timers. A timeout never grants authority or marks a contract complete. Expose run state and cancellation without depending on a connected UI.
6. **Isolation and recovery.** Use stable project/run, step, attempt, and escalation identities. Isolate writable runs in worktrees and exclude overlapping attempts in one worktree. Configure explicit technical timeouts and bounded recovery policies. Reconcile uncertain repository/session effects before repeating an interrupted coding attempt; reject stale results and decisions.
7. **Inspectable evidence.** Preserve Pi sessions, ordered structured tool-call logs, code revision and diff references, verification results, reviewer findings, and terminal outcomes. Large outputs remain artifacts outside Temporal history. Completion requires evidence for the approved criteria and endpoint; human waiting is a nonterminal state.

## Delivery sequence

The TypeScript/npm toolchain and persistent development service are already configured. Next implement the Temporal runner, stub activities, and a small control client. Verify plan selection, state inspection, repair limits, and human waiting without model cost. Then connect Pi role sessions and completion tools and run the same workflow with real repository work. Extend the orchestrator entry point to draft and submit the bounded contracts used by that slice.

Keep the existing toolchain lockfile and pin Temporal SDK and Pi versions when those dependencies are introduced. Extend the current setup and start instructions with worker, test, and recovery commands as part of implementation. Measure dispatch latency and idle resource use alongside representative runs. A production self-hosting configuration follows the deployment requirements; a local development server alone does not demonstrate production readiness.

## Acceptance evidence

| Scenario | Required observation |
| --- | --- |
| Contract approval | An unapproved request cannot start agent work; an approved request starts one identifiable run. |
| Dynamic plans | The same workflow executes a standalone review and an implementation-review plan, with no irrelevant agent launched. |
| Repair and budget | Findings return to the implementer with context; the third unsuccessful review escalates instead of looping indefinitely. |
| Agent protocol | Missing or malformed completion, unknown evidence references, and results from an obsolete attempt do not advance execution. |
| Role boundaries | Reviewer cannot invoke write or general shell tools; effective tool registration matches its profile. |
| Worker recovery | Stop a worker during an activity and after an external effect but before completion is recorded. Recovery preserves progress and reconciles the interrupted attempt before repeating work. |
| Persistent waiting | Restart worker/service with durable storage while awaiting a human. The question remains open, and a valid answer continues the same logical run. |
| Decision and timer races | Duplicate or superseded replies cannot resolve another escalation; a late timer cannot undo a resolved decision. Silence does not approve continuation. |
| Isolation | Two project/run identities retain separate state and workspaces; duplicate dispatch cannot produce concurrent writers in one run. |
| Completion and inspection | Approved criteria have inspectable evidence; cancelled and failed runs stay distinguishable from completed deliveries. |

Use deterministic activity doubles for controlled failures and race cases, then a small real Pi implementation-review run for integration evidence. These checks support the observed recovery behavior; they do not establish exactly-once external effects for all future capabilities.

## Later phases

Add infrastructure, security checks, and delivery/publishing as registered capabilities once the first loop is usable. Broader plan dependencies and parallel execution, the full project/team orchestrator hierarchy, and the dedicated control UI can extend the same boundaries. A general workflow builder, marketplace, multi-harness bundle, autonomous contract changes, and trading functionality are outside this phase.
