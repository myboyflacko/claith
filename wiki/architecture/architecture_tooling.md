---
title: Runtime and Agent Tooling
created: 2026-10-27
updated: 2026-10-29
tags: [tooling]
sources:
  - "[[architecture_delivery-runtime]]"
  - "[[project_phase-one]]"
---

# Runtime and Agent Tooling

## Implemented baseline and selected extensions

The repository contains a working task-based delivery runtime. The phase-based product direction in [[architecture_delivery-runtime]] builds on it. `package.json`, `package-lock.json`, code, and configuration are authoritative for installed versions and current behavior.

| Tool or subsystem               | Current responsibility and status                                                                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript / Node.js / npm      | Node.js 24, strict ESM TypeScript, locked npm dependencies, ESLint, Prettier, Vitest, and tsx are configured and used by the implementation.                                                                                         |
| Temporal TypeScript SDK         | Workflow, worker, client, and activity SDKs are installed. Coordinator/task workflows, heartbeats, cancellation, scoped decisions, and native worker startup are implemented.                                                        |
| Temporal development service    | Compose runs the CLI development server with API `127.0.0.1:7233`, UI `127.0.0.1:8233`, and SQLite state in the `temporal-data` volume. This is development infrastructure.                                                          |
| Production Temporal persistence | PostgreSQL remains the selected production backing from the runtime direction; it is not configured by the development Compose file. Claith uses Temporal APIs, not its internal database tables.                                    |
| Pi SDK                          | `@earendil-works/pi-coding-agent` is installed. Role sessions, provider authentication, model/reasoning selection, structured completion, transcripts, and tool/session audit events are implemented.                                |
| Git and worktrees               | Isolated task branches, workspace ownership, candidate commits, diff capture, revision checks, and interrupted-effect reconciliation are implemented. Integration to `dev`, push, and milestone publication are target capabilities. |
| Application persistence         | Current artifacts are JSON/JSONL files; there is no application database. SQLite is the proposed local phase/task store, distinct from Temporal persistence. Driver/schema/migrations are still open.                                |
| Control surface                 | Terminal `init`, `runtime`, and project-bound `chat`, with approval, status, answers, continuation, cancellation, and reconnect. A separate control UI remains future work.                                                          |
| GitHub CLI (`gh`)               | Repository issue workflow for `myboyflacko/claith`; no automatic issue ingestion, PR creation, or publication capability is currently wired into delivery.                                                                           |
| Repository wiki                 | Durable project direction and decisions. Runtime context currently includes `AGENTS.md`, `INDEX.md`, `wiki/index.md`, and `wiki/project/project_goal.md` when present.                                                               |

The application runs natively. Compose hosts the Temporal development service, not the Claith application or a UI. A production deployment recipe remains open. No additional message broker, alternative agent harness, or general workflow builder is required by the current plan.

## Configuration and permission registry

The only runtime settings file is `~/.claith/config.toml`. The former `claith.toml` and unused legacy `[agents]`/`[workflow]` format are not configuration sources. Agent profiles remain at `~/.claith/agents/{orchestrator,implementer,reviewer}.toml`. Ordinary startup creates directories only; explicit `init` writes missing templates without overwriting existing files.

Profiles require `provider`, `model`, `instructions`, and `permissions`; `reasoning` defaults to `medium`. `permissions` has no fallback: it must be `read-only` or `read-write`. Orchestrator and reviewer are capped at `read-only`; implementer defaults to `read-write` and can be restricted to `read-only`.

`src/domain/tools.ts` centrally registers tool names, required permission levels, allowed roles, and Pi/custom sources. Profiles contain no individual tool list. Loading a profile resolves its rights into an execution profile with explicit tool names; approval snapshots that selection. Later profile edits or registry additions do not expand saved execution rights. Missing tool lists, duplicate or disallowed names, and missing mandatory completion tools are rejected.

| Role                                      | Default effective tools                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| Orchestrator, currently the planning role | Pi `read`, `grep`, `find`, `ls`; custom `submit_proposal`.                                |
| Implementer                               | Pi `read`, `grep`, `find`, `ls`, `edit`, `write`; custom `bash`, `submit_implementation`. |
| Reviewer                                  | Pi `read`, `grep`, `find`, `ls`; custom `read_diff`, `submit_review`.                     |

Restricting the implementer to `read-only` removes `edit`, `write`, and `bash`, retaining its completion tool. New custom tools need registry metadata and a supplied implementation; matching future execution profiles receive them without individual profile edits. Unknown custom tools, duplicate definitions, and unintended Pi-tool overrides are rejected. Registration of tools is implemented; a general registry of arbitrary workflow capabilities is not.

These rights govern exposed tools, not filesystem paths, network access, or operating-system isolation. In particular, `bash` uses the worker process's host permissions. Provider credentials remain in Pi's normal discovery flow. Runtime sessions currently disable loading arbitrary skills, extensions, MCP servers, and agent packages; the presence of a `skills/` directory does not mean skills are loaded.

## Current custom tools

| Tool                    | Role and purpose                                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `submit_proposal`       | Orchestrator submits a message, outline, nullable next task contract, and `goalComplete` flag. This is still the task-based proposal protocol.                                |
| `submit_implementation` | Implementer submits task/attempt/revision identity, submitted/blocked status, summary, and criterion evidence.                                                                |
| `submit_review`         | Reviewer submits task/attempt/revision identity, accepted/changes-requested/blocked verdict, summary, and evidence references.                                                |
| `bash`                  | Claith's own command executor in the implementer's worktree, with persisted output, bounded timeout, and cancellation. This replaces the Pi bash implementation for the role. |
| `read_diff`             | Reviewer reads the stored diff for the exact supplied candidate, without a general shell.                                                                                     |

Definitions and binding are in `src/agents/pi.ts`. `runRole` adds the role's mandatory completion tool, filters supplied custom tools by the saved execution selection, and uses that same explicit allowlist for new and resumed Pi sessions. It validates structured submissions, allows one correction prompt, waits for the turn to finish, and flushes audit logs before returning.

## Current activities and contract schema

The worker registers seven activities in `src/runtime/activities.ts`:

| Activity    | Current behavior                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan`      | Orchestrator proposes the next task contract, asks for clarification, or reports goal completion.                                                  |
| `prepare`   | Allocate/reconcile the isolated task worktree and approval snapshot.                                                                               |
| `implement` | Execute approved setup and run the implementer, including bounded repair feedback.                                                                 |
| `candidate` | Create/reconcile the candidate commit and store its diff.                                                                                          |
| `check`     | Execute approved check commands and persist revision-bound evidence.                                                                               |
| `review`    | Run the reviewer against the supplied candidate and recorded evidence.                                                                             |
| `accept`    | Revalidate the candidate and recorded checks, then persist `accepted.json`. This is task acceptance, not the planned final human phase acceptance. |

`src/domain/contracts.ts` currently defines a task-level `DeliveryContract` with twelve mandatory fields:

| Field              | Current validation/meaning                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `taskId`           | Task identity.                                                                                                               |
| `version`          | Positive integer; revised proposals must increase the version.                                                               |
| `startingRevision` | Expected Git base revision.                                                                                                  |
| `title`, `outcome` | Nonempty descriptive text.                                                                                                   |
| `boundaries`       | At least one textual scope boundary. These are instructions, not enforced path restrictions.                                 |
| `dependencies`     | Unique accepted predecessor task IDs; may be empty.                                                                          |
| `acceptance`       | At least one criterion with required `id`, `text`, `mode`, and nullable `checkId`. Modes are `check`, `review`, and `human`. |
| `setup`            | Commands with `id` and `command`; may be empty.                                                                              |
| `checks`           | At least one command with `id` and `command`, even if criteria otherwise use review/human modes.                             |
| `review`           | Boolean controlling optional review in the existing loop.                                                                    |
| `endpoint`         | Only `local-commit` is implemented.                                                                                          |

A check criterion must name an existing check; other modes require `checkId = null`, and review criteria require `review = true`. IDs must be unique in their relevant lists. The workflow checks actual check results, revision identity, required review, and requested human criteria. Evidence-reference validation is not a complete semantic proof of the desired behavior. The current `goalComplete` proposal can close a session; mandatory final phase acceptance is not implemented.

The target separates a stable phase contract from the evolving task plan, makes the implementation quality gates mandatory, and adds integration, phase evidence, and human acceptance. It must preserve useful existing session, tool, evidence, and recovery behavior rather than reintroducing task-by-task approval.

## Existing verification and remaining work

`tests/` covers configuration, permissions, Pi protocol, terminal control, workflows, workspaces, and opt-in recovery. `docs/acceptance.md` records a successful real Pi task and worker/service recovery evidence from 2026-10-27; its counts and branch references describe that historical run. It does not prove phase delivery, integration/push, SQLite task persistence, or publishing.

The current runtime starts from the supplied project revision and chains accepted task commits, not from an enforced `dev` integration policy. Every task still requires approval; the worker performs activities sequentially, with `maxRepairs = 2` shared across initial implementation repairs and check/review feedback. Technical activity retry is configured to one attempt; uncertain failures can require a scoped human recovery decision. Linux process/subprocess ownership reconciliation is implemented.

See [[project_phase-one]] for the next phase-based slice. Application SQLite details, phase interfaces, final acceptance/correction commands, and publication workflows remain implementation work. The separate control UI and broader deployment packaging remain open choices.
