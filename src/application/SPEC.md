---
id: planning-application
type: module-design
status: draft
title: Planner task management and agent policy
parent: claith-architecture
depends-on: [delivery-domain]
---

## Responsibility

The application boundary translates the developer's idea and project Goal into jointly prepared tasks and mediates agent capabilities. The Planner manages the durable task source through validated tools: reading tasks/queue, queueing, reordering and setting `ready`. This is required behavior from `claith-goal`, not an implemented tool API.

Planner reasoning does not select execution slots, run implementation or bypass delivery gates. The deterministic handler consumes readiness under the authority split in `claith-architecture`. Repository read-only access does not forbid authorized task-database mutations; those are separate capabilities, not unrestricted SQL or shell access.

## Role and tool policy

`agents/tools.ts` currently owns pure tool metadata and validates explicit selections. Duplicate, unknown or role-disallowed tools are rejected; each role must retain its structured completion tool. Validating a saved selection must not expand it when registry defaults change. Reviewer access cannot be promoted to read-write by profile configuration.

The caller of an agent session owns role selection, permissions, prompt/context composition, custom tools and acceptance of structured results. The SDK adapter owns only session translation and lifecycle; finishing a model turn is not task completion. Role execution requires a separate composition boundary, not role branches inside the Pi adapter.

## Implementation boundary

The current registry still names an `orchestrator` and `submit_proposal`, whereas domain definitions and profile templates name a Planner. It supplies no task listing, ordering, queueing or readiness tools. SQLite task persistence and collaborative planning are not connected.

Agent execution modules referenced by Temporal Activities and the SDK-independent session contract referenced by the Pi adapter are absent. Existing prompt/configuration assets do not establish an executable Planner/Implementer/Reviewer composition. Reconciliation of these gaps is implementation work, not a behavior introduced by this spec.
