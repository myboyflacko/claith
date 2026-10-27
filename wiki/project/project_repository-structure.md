---
title: Repository Structure
created: 2026-10-22
updated: 2026-10-27
tags: [project]
sources:
  - "[[architecture_delivery-runtime]]"
  - "[[architecture_tooling]]"
---

# Repository Structure

## Current repository

Claith currently has a TypeScript application scaffold, local development infrastructure, and project documentation. `INDEX.md` maps the existing entry points; code and configuration are authoritative for their behavior.

| Path | Current responsibility |
| --- | --- |
| `src/main.ts` | Application placeholder that prints a scaffold readiness message. |
| `tests/` | Empty Vitest test directory, ready for behavior tests. |
| `package.json` and `package-lock.json` | Application metadata, npm commands, and pinned development dependencies. |
| `tsconfig*.json`, `eslint.config.mjs`, and Prettier/Vitest configuration | Strict TypeScript checks, source compilation, linting, formatting, and test tooling. |
| `docker-compose.yml` | Temporal CLI development service and Web UI, with SQLite state in a named volume. |
| `wiki/` | Project direction, accepted runtime decisions, and the remaining phase-one scope. |

The Python package, its tests and configuration, notebooks, prompts, virtual environment, and local build artifacts have been removed. The former five-area package description is no longer the repository's layout.

## Proposed implementation organization

The following module organization is a proposal for implementing [[architecture_delivery-runtime]], not a set of existing directories or a completed module design:

```text
src/
  main.ts
  delivery/       # Contracts, plans, and evidence-backed completion rules
  runtime/
    workflows/    # Deterministic Temporal execution
    activities/   # Work with external effects
  agents/         # Pi sessions, roles, tools, and structured results
  control/        # Approval, status, and human decisions
```

Create each module with its first implementation and refine its interface through concrete use cases. Preserve the separation of deterministic workflow code from model calls, repository operations, and other external effects. The prior generic package areas are not a requirement for the new implementation. Deployment packaging and the separate control UI remain independent of this proposed source layout.
