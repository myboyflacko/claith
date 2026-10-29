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

## Current implementation

The repository implements a directly invoked, single-task delivery runner on Node.js 24, TypeScript, npm, Temporal, and Pi. Code, manifests, and configuration are authoritative. Phase planning, SQLite task storage, and final human phase acceptance remain target behavior in [[architecture_delivery-runtime]].

`taskWorkflow` owns the task worktree, repair budget, blocked decisions, history, delivery and cancellation. Each attempt starts separate `implementerWorkflow` and `reviewerWorkflow` Child Workflow executions. The implementer child runs a fresh Pi session, candidate creation and checks. The reviewer child evaluates the exact candidate in a fresh session. The parent alone owns the Critic Loop. Technical recovery resumes the same logical attempt/session after reconciling effects; each new repair uses a new session.

A successful task is merged with a merge commit in an isolated integration worktree, checked again, integrated into clean local `dev`, pushed normally to `origin/dev`, and cleaned up. A changed development base blocks and requires a new contract version/run. Default `maxRepairs = 2` allows an initial attempt plus two repairs. Exhaustion requires explicit additional budget. Push/cleanup failures resume only missing delivery operations after reconciliation. No operation publishes to `main` or creates a PR.

The previous chat/coordinator/task-approval path is removed. Existing coordinator sessions are not migrated; stop or resolve their workers/runs before upgrading. `docs/acceptance.md` remains historical evidence for that earlier implementation, not instructions for the new interface.

## Direct control and storage

The CLI supports `init`, `runtime`, `run --project <path> --contract <file.json>`, and `status`, `resume`, `cancel` with `--run <id>`. Submission explicitly authorizes task delivery and returns a stable project/task/version run ID. Identical submissions are idempotent; conflicting input under that identity is rejected. Status is a JSON record with separate immutable `contract` and evolving `execution` sections. Resume is scoped to the current blocker; budget increases must be explicit.

Artifacts under `~/.claith/sessions/<run-id>/` include the initial input, execution projection, attempt outputs, role/session identities, diffs, checks, integration evidence and push/cleanup checkpoints. Large logs/transcripts remain files. All earlier attempts are retained. Completed task worktrees and fully integrated local task branches are removed; uncertain/dirty state and failed runs remain inspectable. Temporal remains authoritative for execution. There is no application SQLite database yet.

The Compose Temporal development service uses its own SQLite volume and exposes API `127.0.0.1:7233` and UI `127.0.0.1:8233`. It is independent of application artifacts or proposed application SQLite storage. PostgreSQL remains the selected production Temporal backing; the production deployment recipe and separate UI remain future work. The application runs natively, and Linux process ownership/subprocess reconciliation uses `/proc`.

## Task contract

`src/domain/contracts.ts` defines the new task contract, replacing the old task-approval schema:

| Fields                                      | Meaning                                                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `taskId`, `version`, `startCommit`, `title` | Task identity, positive version, expected common local/remote `dev` base, and title.                                                                               |
| `tasks`                                     | One Markdown assignment, used unchanged as the initial implementer prompt and supplied to the reviewer.                                                            |
| `goal`, `context`, `scope`, `constraints`   | Additional authoritative task context; scope and constraints are descriptive, not path sandbox rules.                                                              |
| `acceptanceCriteria`                        | Nonempty criteria with unique IDs, text, `check`/`review` mode and nullable `checkId`. Check criteria must reference an existing check. This is also the task DoD. |
| `checks`                                    | Nonempty named executable commands.                                                                                                                                |
| `setup`                                     | Optional named preparation commands, default empty; executed once per task worktree with interrupted-effect reconciliation.                                        |

Both roles receive the contract, run/attempt identity, relevant revision and repair feedback. Submissions are bound to run, task version, attempt and revision. Reviewer output includes a verdict, findings and criterion assessments with evidence references. Acceptance requires all criteria satisfied, passing checks for that candidate, and no findings. These gates validate evidence identity and completeness; they are not an automatic semantic proof that all desired behavior is correct. Whole-phase human acceptance is still separate future work.

## Configuration, permissions and custom tools

`~/.claith/config.toml` is the sole runtime settings file. `init` creates missing implementer/reviewer profiles under `agents/`, without overwriting existing files. The runner no longer loads or requires an orchestrator profile; any old file is left untouched. Profiles require provider, model, instructions and explicit permissions; reasoning defaults to medium.

The central `src/domain/tools.ts` registry controls required permissions, roles and Pi/custom sources. Implementer defaults to read-write and may be restricted; reviewer is read-only. Execution snapshots contain explicit tool names, so later profile or registry expansion does not widen a running task's rights. Unknown/disallowed tools, duplicate definitions and missing mandatory completion tools are rejected. Permissions do not provide OS, path or network isolation; bash uses the worker's host authority. Pi credentials remain in normal provider discovery; arbitrary skills, extensions and MCP servers are not loaded.

| Active custom tool      | Purpose                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `submit_implementation` | Revision-bound implementation result, summary, evidence or blocker.                     |
| `submit_review`         | Revision-bound verdict, findings, criterion satisfaction and evidence.                  |
| `bash`                  | Claith's persisted-output, timeout/cancellation-aware command tool for the implementer. |
| `read_diff`             | Read the stored diff for the reviewer's exact candidate.                                |

The low-level registry still describes the former read-only orchestrator role and `submit_proposal`; no active planner/coordinator workflow uses it in this runner. New custom tools require registry metadata and implementations. The Pi adapter allows one correction prompt for malformed/missing structured completion, waits for the session to finish and flushes audit logs.

## Activities and verification

The worker registers `prepare`, `setup`, `implement`, `candidate`, `check`, `review`, `integrate`, `push`, `cleanup`, and `record`. Role Workflows coordinate agent Activities; Git, model, filesystem and network operations remain Activities. The parent records stage/attempt history and session references, and is complete only after confirmed delivery and cleanup. Cancellation waits for active effects and preserves state; it does not roll back completed pushes.

Targeted tests cover contract validation, permission snapshots, session recovery, distinct repair sessions, reviewer gates, budget/blocker decisions, real Git integration/push/cleanup against bare fixture remotes, duplicate submission, and end-to-end delivery with agent doubles. Opt-in recovery exercises worker/service restart while blocked and SIGKILL during an agent effect, followed by reconciliation and same-session continuation. These are task-runner checks, not proof of autonomous phase planning or milestone publishing.
