---
id: delivery-domain
type: module-design
status: draft
title: Task identity and delivery evidence
parent: claith-architecture
---

## Responsibility

The domain defines an executable task and the evidence needed to judge its delivery. A task contract identifies one task/version and describes behavior through acceptance criteria; it is not a project Goal, a phase approval or an agent's technical plan. Execution configuration and the starting revision are captured separately in the run input.

Implementations and reviews are bound to run, task version, attempt and revision. A submitted implementation supplies its verification plan; a blocker is not a successful candidate. Command identities are unique and `diff` is reserved for candidate evidence.

## Evidence acceptance

`assertSubmission` rejects stale or mismatched identities. `assertImplementation` rejects evidence for unknown criteria or checks. `checksPassed` requires the complete expected command set, exact commands, successful exits, an unchanged tracked workspace and the requested revision.

An accepted review must assess every criterion with evidence, reference only the candidate diff or recorded checks, and contain no findings. A syntactically valid submission or successful command alone does not establish behavioral correctness. Review assesses whether the evidence actually supports the requested behavior.

A run record separates the unchanged task contract from evolving execution, attempts, blockers and delivery checkpoints. Completed delivery, blocked work and cancellation are distinct; none is a product-level human acceptance record.

## Boundary and current gaps

This module owns SDK-independent records and pure validation, not database access, task scheduling, Pi sessions or Git effects. The intended dependency direction is inward from application and infrastructure.

The current `contracts.ts` execution-configuration type import points to a missing infrastructure module, and `agents.ts` imports a missing tools module. These are refactor gaps, not intentional domain dependencies. Project Goal and SQLite queue/readiness records have no implementation here; the existing task contract must not be mistaken for that schema.
