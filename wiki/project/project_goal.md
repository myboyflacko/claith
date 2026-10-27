---
title: Project Goal
created: 2026-10-22
updated: 2026-10-27
tags: [project]
sources: []
---

# Project Goal

Claith is a self-hosted agentic development environment for solo developers that turns a human-approved Delivery Contract into a completed, evidence-backed software outcome with minimal developer attention. A Delivery Contract defines the desired outcome, boundaries, acceptance criteria, and delivery endpoint. Claith drafts the contract from the developer's intent, and execution begins after human approval.

For each approved contract, Claith decomposes the work, selects the required agent capabilities, and adapts the execution plan within an opinionated delivery lifecycle. Depending on the contract, delivery can include code, tests, infrastructure, CI/CD, release, and publishing. A contract is complete only when every acceptance criterion is supported by evidence or explicit human confirmation and its delivery endpoint has been reached.

Each runtime operates independently, durably, and recoverably across multiple projects and concurrent contracts. A separate UI can connect to and control multiple runtime instances, while each runtime remains authoritative for its execution and state. Humans retain ownership of product direction and contract changes; Claith requests their attention only for product judgment, material risk, irreversible action, or missing authority. Claith can learn from completed runs by proposing versioned improvements for future work, but those improvements require approval and never alter an active contract.

## Decision Guidance

- Optimize for reducing developer attention while preserving reliable, evidence-backed outcomes.
- Prefer an opinionated delivery lifecycle with dynamic capability and agent selection over a general workflow builder.
- Allow execution plans, tasks, ordering, agents, and strategies to adapt within the boundaries of an approved contract.
- Keep runtimes self-hosted, independently operable, durable, and recoverable; treat the UI as a control surface rather than the owner of execution state.
- Keep product direction and contract changes human-owned, and apply approved learning improvements only to future work.
- Make material deviations from this goal explicit. Current requester instructions remain authoritative when they conflict with this direction.

## Current Non-Goals

- A general-purpose loop builder or marketplace is not part of the current product core.
- Product roadmap and prioritization remain human responsibilities.
- Active Delivery Contracts change only through explicit human approval.

## Architecture and First Delivery Slice

The accepted runtime direction is recorded in [[architecture_delivery-runtime]], with selected tools and current implementation status in [[architecture_tooling]]. The first delivery slice and its acceptance evidence are defined in [[project_phase-one]]. These pages distinguish the intended delivery runtime from the current TypeScript scaffold and local development service.
