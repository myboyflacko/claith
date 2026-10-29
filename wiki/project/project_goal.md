---
title: Project Goal
created: 2026-10-22
updated: 2026-10-29
tags: [project]
sources: []
---

# Project Goal

Claith is a self-hosted agentic development environment for solo developers that turns a human-approved target state into a completed, evidence-backed software outcome with minimal developer attention. The delivery unit is a phase: a bounded outcome described through observable behavior, fixed acceptance criteria, boundaries, and an authorized delivery endpoint. Its approved specification is the Delivery Contract.

The same model can cover a small task, a feature, or a phase within a larger epic. Large goals are divided into phases that each deliver a useful, verifiable state. Product direction and milestones are agreed with the developer; Claith does not need a detailed implementation plan for the entire product before work begins.

The developer approves the phase, not its individual tasks. A planner examines the actual project state and plans the next meaningful behavior increment, including its tasks and dependencies. After implementation, verification, review, and integration, the planner examines the resulting code and evidence before selecting the next increment. It may adapt the technical plan within the approved contract without requesting routine intermediate approvals.

The runtime executes a defined delivery lifecycle and enforces dependencies, tool permissions, checks, evidence, and bounded repair policies. Normal development starts from the current `dev`, uses isolated working branches, and returns verified changes to `dev`, followed by a push. Promotion to `main` and publishing are explicit milestone delivery actions requiring the authority recorded in the contract; they do not happen after every task or automatically after every phase.

A phase becomes ready for acceptance when the integrated result demonstrates its agreed behavior and acceptance criteria. The developer reviews that result and may request corrections. Claith plans and executes those corrections, repeating verification and review. A phase closes only after human acceptance and fulfillment of the agreed delivery endpoint. It then stays finished and idle until the developer discusses and approves another phase. The planner cannot create additional work simply to keep running.

Each runtime remains independently operable, durable, and recoverable across projects and concurrent phase runs, with shared repository writes coordinated. A separate UI can connect to multiple runtimes, while each runtime owns its execution and state. Normal human contact is phase definition/approval and final acceptance; earlier intervention is reserved for blockers that cannot be resolved within granted authority, missing inputs, or required contract changes. Silence never grants approval.

## Decision Guidance

- Optimize for finishing useful behavior with evidence and little developer attention.
- Keep the phase contract stable; version the evolving task plan separately.
- Use a planner for reasoning and a deterministic runtime for execution control. A separate AI orchestration layer is not required for the initial product.
- Keep quality gates fixed while allowing tasks, dependencies, and technical approaches to adapt within approved boundaries.
- Evaluate the integrated behavior against the original phase criteria, not merely the completion of individual tasks.
- Keep product scope, acceptance-criteria changes, publication authority, and final acceptance human-owned.
- Apply any future approved learning improvements to subsequent work; never silently change an active contract.
- Make material deviations explicit. Current requester instructions remain authoritative.

## Current Non-Goals

- A generic workflow builder, arbitrary agent hierarchy, or marketplace.
- Autonomous product-roadmap changes or automatic progression into an unapproved next phase.
- Treating task completion, passing commands, or a planner's completion statement as sufficient human acceptance.
- Assuming that a goal description grants capabilities or external permissions that the runtime does not implement.

## Architecture and Delivery Status

[[architecture_delivery-runtime]] defines the agreed phase lifecycle, planning boundary, storage responsibilities, and Git delivery rules. [[architecture_tooling]] records the implemented tools and the remaining selections. [[project_phase-one]] distinguishes the existing task-based delivery baseline from the next phase-based delivery slice. [[project_repository-structure]] maps the current implementation.
