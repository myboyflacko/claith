---
title: Runtime and Agent Tooling
created: 2026-10-27
updated: 2026-10-27
tags: [tooling]
sources:
  - "[[architecture_delivery-runtime]]"
  - https://docs.temporal.io/develop/typescript
  - https://docs.temporal.io/self-hosted-guide
  - https://docs.temporal.io/self-hosted-guide/deployment
  - https://pi.dev/docs/latest/sdk
  - https://pi.dev/docs/latest/extensions
---

# Runtime and Agent Tooling

## Selected stack and current availability

These choices implement [[architecture_delivery-runtime]]. The repository contains the TypeScript development foundation and a local Temporal service; the delivery runtime is still a target. `package.json`, `package-lock.json`, and `docker-compose.yml` are authoritative for configured dependencies and versions.

| Tool | Selected responsibility |
| --- | --- |
| TypeScript and Node.js | Node.js 24 and a strict ESM TypeScript scaffold are configured. Application workers and in-process Pi execution are not implemented yet. |
| npm and development tools | npm with a lockfile, ESLint, Prettier, Vitest, and tsx are configured. The test directory starts empty. |
| Temporal Service | Selected for durable execution history, task dispatch, timers, retries, and recovery. A local development service is configured; a production self-hosted deployment is not. |
| Temporal TypeScript SDK | Planned dependencies: `@temporalio/workflow`, `@temporalio/worker`, and `@temporalio/client` for workflow code, activities, and control requests. Not yet installed. |
| Pi SDK | Planned dependency: `@earendil-works/pi-coding-agent` for model access, sessions, coding tools, role instructions, and custom completion tools. Not yet installed. |
| PostgreSQL | Selected persistence backing for the sustained, self-hosted Temporal deployment. Not part of the current Compose file. Claith will access workflow state through Temporal rather than writing its internal tables. |
| Temporal CLI and Web UI | `docker-compose.yml` runs the CLI development server with local API/UI ports and SQLite storage in a named Docker volume. This supports local restart checks; it is not the production deployment plan. |
| Git and worktrees | Selected for run isolation and code revision references. Automated workspace allocation and exclusion of concurrent writers remain to be implemented. |
| GitHub CLI (`gh`) | Existing issue workflow for `myboyflacko/claith`; later delivery integration is governed by contract authority. |
| Repository Markdown wiki | Curated project knowledge and accepted decisions. Agent context loads relevant pages rather than every project's entire wiki. |
| Durable session and artifact storage | Planned storage for Pi transcripts, structured tool-call logs, diffs, test evidence, and result references. Local persistent storage is sufficient for the first single-host slice; the scaffold does not implement it. |

Pi supplies provider integration; credentials and actual model availability remain provider-specific. Model IDs and reasoning settings are configuration, not fixed architecture choices. Each role can use an appropriate supported model without changing workflow routing.

## Planned role profiles and tools

These profiles and Claith completion tools are planned, not supplied by the scaffold. Profiles explicitly configure model, reasoning settings, instruction sources, working directory, and allowed tools. The application controls which extensions and MCP tools can load. Only registered, approved tools are available to a role.

| Role | Initial tool boundary |
| --- | --- |
| Orchestrator / planner | Relevant project knowledge and constrained contract and plan operations. Approval and execution authority are enforced by application code. |
| Implementer | Pi tools `read`, `grep`, `find`, `ls`, `edit`, `write`, and `bash`, plus Claith's structured `submit_implementation` completion tool. |
| Reviewer | Pi tools `read`, `grep`, `find`, and `ls`, plus Claith tools `read_diff` and `submit_review`. No general shell or write capability. |

The `read_diff` and `submit_*` tools are Claith APIs to implement, not built-in Pi methods. Diff reading includes the relevant revision and untracked changes without arbitrary shell access. Completion schemas validate structured arguments; the runtime also validates identity, code revision, required evidence, and semantic completion. Shell access is broad operating-system access and must be contained by the worker's actual workspace permissions or isolation. A tool allowlist alone is not an operating-system sandbox.

The host observes Pi tool and session events for logging. Shared provider-independent tool definitions belong in this integration, allowing the same role behavior across supported models. Native Pi session storage and Claith workflow history serve different purposes.

## Implementation status and deferred selections

The executable baseline is now the TypeScript scaffold. `src/main.ts` prints a readiness message; it does not execute a Delivery Contract or connect to Temporal. npm scripts cover development, type checking, linting, formatting, Vitest, building, and compiled startup. The legacy Python/LangGraph/Codex implementation and its tooling were removed at the requester's direction. Removal and scaffolding do not demonstrate that its behavior has been migrated or that phase one is complete.

Temporal replaces LangGraph as the selected outer delivery runtime. Pi replaces the Codex-only agent execution path in the target. Phase one does not require LangChain, a separate BullMQ/Redis/Kafka broker, a general event inbox, or additional Codex/Claude/OpenCode harness adapters.

The package manager and test runner are settled as npm and Vitest, with development dependency versions pinned in `package.json` and `package-lock.json`. Temporal SDK and Pi versions, profile configuration format, and the production deployment recipe remain to be settled during phase-one implementation. The custom UI framework remains open; a full UI is not required to validate the runtime.

The current Compose file packages only the local Temporal development service. It does not require the Claith application runtime or its UI to be deployed as containers. Native background service packaging and application container packaging remain deployment choices.
