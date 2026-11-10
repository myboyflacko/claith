---
id: claith-goal
type: goal-and-requirements
status: draft
title: Goal-driven autonomous task delivery
---

## Goal

Claith is a self-hosted agentic development environment for a solo developer. It turns an idea, refined together with a Planner against the project's defined Goal, into executable tasks and verified software delivery with minimal routine developer intervention.

The developer supplies product direction; the Planner translates it into work. A deterministic handler controls execution rather than allowing an agent to invent or bypass the delivery lifecycle.

## Capabilities

- Collaboratively derive tasks from the project Goal and the developer's idea.
- Let the Planner manage tasks through tools that list, queue and reorder tasks and mark them `ready` in SQLite. The durable queue is independent of the Planner conversation.
- Dispatch eligible ready tasks through a deterministic handler to Implementers, respecting task dependencies and execution capacity.
- Deliver through implementation, independent review, integration and push, retaining revision-bound checks and review evidence. Failed gates require repair or an explicit blocker, not silent acceptance.
- Configure Git integration and push targets per project rather than requiring `dev` as a universal product rule.
- Support configurable autonomy without treating one mandatory phase-approval or final-human-acceptance model as the product contract. Specific autonomy modes and defaults are not established by this specification.

## Boundaries

The Planner owns reasoning and task preparation, not deterministic scheduling or implementation. Repository access and task-management authority are distinct: a Planner can manage task records without permission to modify project code.

Comprehensive project-management and monitoring features, deployment, and unattended continuous generation of new tasks are outside this specification's scope. Project identity, its Goal and Git delivery settings remain necessary execution context; this does not imply a project-management UI.

## Specification authority and implementation

This specification defines the task-centric product direction. An approved phase Delivery Contract, rolling phase increments and mandatory human phase acceptance are not prerequisites of this model. Existing task-level `TaskContract` records remain implementation concepts, not phase approvals.

`claith-architecture` distinguishes the confirmed product requirements from the current implementation and inferred design constraints. These specifications are drafts pending review; creating them does not implement the missing capabilities.
