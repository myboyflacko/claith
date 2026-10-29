---
title: Repository Structure
created: 2026-10-22
updated: 2026-10-29
tags: [project]
sources:
  - "[[architecture_delivery-runtime]]"
  - "[[architecture_tooling]]"
---

# Repository Structure

## Current repository

Claith has an implemented TypeScript/Temporal/Pi task runtime, local development infrastructure, automated tests, and recorded task-delivery evidence. `INDEX.md` maps current entry points. Code and configuration are authoritative for actual behavior; the phase lifecycle in [[architecture_delivery-runtime]] is the next product direction.

`README.md` documents the executable task baseline, including manual integration and publishing. Its earlier phase-one wording and the dated acceptance record describe that baseline; [[project_phase-one]] defines the revised phase-delivery target.

| Path                                                    | Current responsibility                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`, `src/bootstrap.ts`, `src/settings.ts`    | Native CLI entrypoint, directory-only startup, and the central `~/.claith` location.                                                        |
| `src/configuration.ts`                                  | Load `config.toml` and role profiles; explicitly initialize missing templates without overwriting existing files.                           |
| `src/domain/`                                           | Runtime/profile schemas, central tool registry and role permissions, task contracts, snapshots, evidence, and activity interfaces.          |
| `src/runtime/`                                          | Temporal coordinator and child workflows, validated messages, client, activity registration, heartbeats, and native worker.                 |
| `src/agents/`                                           | Pi role sessions, explicit effective tools, custom completion/bash/diff tools, repository context, structured validation, and audit events. |
| `src/workspace/`                                        | Git worktrees, candidate commits, checks, process execution, workspace ownership/reconciliation, and JSON/JSONL artifact storage.           |
| `src/cli/`                                              | Terminal planning/control, task approval, scoped answers, status, reconnect, disconnect, and cancellation.                                  |
| `tests/`, `tests/fixtures/`                             | Configuration/permissions, workflow, Pi, terminal, workspace, and opt-in worker/service recovery checks.                                    |
| `docs/acceptance.md`                                    | Procedure and historical evidence for the successful real Pi task-delivery baseline.                                                        |
| `package.json`, `package-lock.json`, tool configuration | Node.js 24, npm commands and locked dependencies, TypeScript, ESLint, Prettier, and Vitest.                                                 |
| `docker-compose.yml`                                    | Local Temporal development service and Web UI with durable SQLite state in a named volume.                                                  |
| `wiki/`                                                 | Current product direction, architecture, implementation boundaries, and separately marked historical research.                              |

The previous Python/LangGraph/Codex runtime was removed. Its old package organization and configuration are not requirements for the TypeScript implementation.

## Runtime data and planned persistence

`~/.claith/config.toml` holds runtime settings. Role profiles remain in `agents/`. The runtime stores approval snapshots, Pi sessions, candidates, diffs, check results, reviews, and accepted task results under `sessions/`; worktrees and runtime logs have their own directories. A `skills/` directory exists, but runtime sessions currently do not load skills or extensions.

There is no Claith application database yet. SQLite is proposed for durable phase/contract/plan/task records; it must remain distinct from the Temporal service's own database and from Temporal's authoritative execution state. Large artifacts remain files. No application database path, schema, driver, or new source directory is implemented by this proposal.

## Change boundaries for phase delivery

Evolve the existing modules to separate stable phase contracts from versioned task plans, move approval to the phase, and add integration/push plus final acceptance/correction. Preserve deterministic workflow code, externally effectful activities, explicit role tools, and durable evidence/recovery seams.

The existing role named `orchestrator` currently acts as planner. The target needs a planner and deterministic orchestration, not a second AI scheduling layer. The activity named `accept` currently accepts a task candidate; it must not be mistaken for the future human phase acceptance operation. Future module splits should follow concrete responsibilities rather than the former speculative `delivery/`/`control/` layout.
