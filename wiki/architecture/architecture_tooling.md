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

## Selected target stack

These choices implement [[architecture_delivery-runtime]]. They describe the target, not dependencies already installed in this repository.

| Tool | Selected responsibility |
| --- | --- |
| TypeScript and Node.js | New application runtime and workers; embed Pi in process. |
| Temporal Service | Durable execution history, task dispatch, timers, retries, and workflow recovery. Self-hosting is the deployment direction. |
| Temporal TypeScript SDK | `@temporalio/workflow`, `@temporalio/worker`, and `@temporalio/client` for workflow code, activities, and control requests. |
| Pi SDK | `@earendil-works/pi-coding-agent` for model access, sessions, coding tools, role instructions, and custom completion tools. |
| PostgreSQL | Persistence backing for the sustained, self-hosted Temporal deployment. Claith accesses workflow state through Temporal rather than writing its internal tables. |
| Temporal CLI and Web UI | Local development service and execution inspection. The development server requires explicit persistent storage for restart checks and is not the production deployment plan. |
| Git and worktrees | Isolate run branches and working directories; identify the code revisions associated with reviews and evidence. |
| GitHub CLI (`gh`) | Existing issue workflow for `myboyflacko/claith`; later delivery integration is governed by contract authority. |
| Repository Markdown wiki | Curated project knowledge and accepted decisions. Agent context loads relevant pages rather than every project's entire wiki. |
| Durable session and artifact storage | Pi transcripts, structured tool-call logs, diffs, test evidence, and result references. Local persistent storage is sufficient for the first single-host slice. |

Pi supplies provider integration; credentials and actual model availability remain provider-specific. Model IDs and reasoning settings are configuration, not fixed architecture choices. Each role can use an appropriate supported model without changing workflow routing.

## Initial role profiles and tools

Profiles explicitly configure model, reasoning settings, instruction sources, working directory, and allowed tools. The application controls which extensions and MCP tools can load. Only registered, approved tools are available to a role.

| Role | Initial tool boundary |
| --- | --- |
| Orchestrator / planner | Relevant project knowledge and constrained contract and plan operations. Approval and execution authority are enforced by application code. |
| Implementer | Pi tools `read`, `grep`, `find`, `ls`, `edit`, `write`, and `bash`, plus Claith's structured `submit_implementation` completion tool. |
| Reviewer | Pi tools `read`, `grep`, `find`, and `ls`, plus Claith tools `read_diff` and `submit_review`. No general shell or write capability. |

The `read_diff` and `submit_*` tools are Claith APIs to implement, not built-in Pi methods. Diff reading includes the relevant revision and untracked changes without arbitrary shell access. Completion schemas validate structured arguments; the runtime also validates identity, code revision, required evidence, and semantic completion. Shell access is broad operating-system access and must be contained by the worker's actual workspace permissions or isolation. A tool allowlist alone is not an operating-system sandbox.

The host observes Pi tool and session events for logging. Shared provider-independent tool definitions belong in this integration, allowing the same role behavior across supported models. Native Pi session storage and Claith workflow history serve different purposes.

## Migration and deferred selections

The current executable baseline uses Python 3.12, `uv`, LangGraph, Pydantic, and the Codex adapter. Its tests use pytest and Ruff. Those remain authoritative for current code until a separate implementation change introduces the TypeScript runtime and its commands, dependencies, tests, and updated repository instructions.

Temporal replaces LangGraph as the selected outer delivery runtime. Pi replaces the Codex-only agent execution path in the target. Phase one does not require LangChain, a separate BullMQ/Redis/Kafka broker, a general event inbox, or additional Codex/Claude/OpenCode harness adapters.

Package versions, TypeScript package manager and test runner, profile configuration format, and the production deployment recipe are settled and recorded during phase-one implementation. The custom UI framework remains open; a full UI is not required to validate the runtime.
