# claith

Self-hosted agentic development environment that turns approved Delivery Contracts
into evidence-backed local commits with minimal developer attention.

## Run locally

Requires Node.js 24, npm, Git, Docker Compose, and an existing Pi login.
Claith runs natively; Compose hosts only the persistent Temporal development service.

```bash
npm ci
npm run dev -- init
# Edit ~/.claith/agents/{orchestrator,implementer,reviewer}.toml:
# choose provider/model from your installed Pi's available models.
docker compose up -d --wait
npm run dev -- runtime
```

In another terminal:

```bash
npm run dev -- chat --project /absolute/path/to/repository
# Reconnect using the session ID printed by chat:
npm run dev -- chat --project /absolute/path/to/repository --session <id>
```

Discuss the goal in plain text. The orchestrator prepares only the next contract,
including its starting commit, boundaries, acceptance criteria, setup/check commands,
review requirement, and local commit endpoint. Read it, then `/approve` that exact
version. Execution proceeds automatically in a task branch and worktree. Each next
task requires a new approval and starts from its predecessor's accepted commit.
Task branches are preserved; merging and publishing are manual, outside phase one.

| Command                                                  | Effect                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| `/approve`                                               | Approve the displayed contract and snapshot current configuration       |
| `/status`                                                | Show current progress, question, and accepted evidence                  |
| `/continue <question-id> <rounds> <answer>`              | Answer a blocker/recovery question and grant 1–20 extra repairs         |
| `/answer <question-id> confirm <criterion-ids> <reason>` | Explicitly confirm all pending human criteria (IDs separated by commas) |
| `/cancel`                                                | Cancel this goal and active work, retaining artifacts                   |
| `/quit`                                                  | Disconnect chat; runtime execution and pending questions continue       |

Closing chat never cancels execution. A worker can be stopped and restarted with
`runtime`. Temporal reconstructs workflow state; interrupted activities yield
persistent reconciliation questions. Silence and reminder timers never approve work.
Run the worker under your preferred process supervisor for unattended use.

## Read-only session status JSON

Query an existing session without opening chat or supplying `--project`:

```bash
npm run dev -- status --session <id> --json
npm run build
npm start -- status --session <id> --json
# Equivalent compiled invocation, without npm's lifecycle output:
node dist/main.js status --session <id> --json
```

Use the existing server configured by `address`, `namespace`, and `taskQueue` in
`~/.claith/claith.toml`. The session must already exist and its workflow must be
queryable by an existing worker. This command starts no server, worker, session,
or model call, and does not approve or cancel work. Normal configuration loading
still requires valid `~/.claith/agents/{orchestrator,implementer,reviewer}.toml`
profiles; querying itself needs no model credentials or Pi login.

Both `--session` and `--json` are required. Application stdout contains exactly
one JSON document: the complete existing `SessionSnapshot`, not the chat display
summary. All fields are retained, including `sessionId`, `state`, `currentTask`,
and `pendingEscalation`; absent task/escalation values remain JSON `null` and
populated values retain their nested contents. The connected client is closed
after querying. Missing arguments, unknown sessions, configuration errors, and
connection/query failures produce diagnostics on stderr and a nonzero exit,
without a status document on stdout.

When capturing JSON through npm, suppress npm's own lifecycle output (which is
not application stdout) using `npm --silent run dev -- status --session <id> --json`
or `npm --silent start -- status --session <id> --json`.

Deterministic CLI tests cover development and compiled entrypoints using a
process-local client double, without servers or model calls. They do not establish
live-server or real-model acceptance.

## Configuration and evidence

Ordinary startup creates five directories and no configuration files. `init` creates
missing templates without overwriting existing files. Invalid TOML and missing or
unconfigured profiles fail with the filename and corrective action.

```text
~/.claith/
  claith.toml
  agents/{orchestrator,implementer,reviewer}.toml
  skills/
  sessions/<project-id>/<session-id>/<execution-id>/
  worktrees/<project-id>/<execution-id>/
  log/
```

Role profiles contain `provider`, `model`, `reasoning`, and `instructions`.
Claith uses Pi's normal credential discovery; it does not move credentials or load
skills, extensions, MCP servers, or arbitrary agent packages. Reviewer tools are
`read`, `grep`, `find`, `ls`, `read_diff`, and `submit_review`. Implementer tools add
`edit`, `write`, `bash`, and `submit_implementation`. These tools use the operator's
host permissions; run Claith only on repositories and contracts you authorize.

Runtime defaults in `claith.toml`: `maxRepairs = 2`,
`agentTimeoutSeconds = 1800`, `checkTimeoutSeconds = 600`,
`heartbeatIntervalSeconds = 10`, `heartbeatTimeoutSeconds = 30`,
`reminderSeconds = 3600`, `address = "127.0.0.1:7233"`,
`namespace = "default"`, and `taskQueue = "claith"`.
The initial implementation and both check/review repairs share the same budget.
Later configuration edits affect subsequent approvals. Check-mode acceptance
criteria name an approved check; review-mode criteria require a review; human-mode
criteria remain pending until explicitly confirmed.

Task artifacts include approval snapshots, Pi transcripts, candidate diffs and
commits, setup/check outputs, revision-bound command results, reviews, and accepted
results. Runtime and tool events are correlated JSONL logs. Completed and failed
worktrees remain available for inspection. There is no application database.

If an operation was interrupted, inspect its artifacts and source state before
answering the recovery question. Ownership recovery verifies the previous Linux
process identity and recorded subprocess groups. A still-running group, a remote
host owner, damaged ownership file, or an uncertain setup operation requires manual
reconciliation; do not delete lock/evidence files while a writer is alive. All
phase-one worker effects execute sequentially. Linux `/proc` is currently required
for workspace ownership and subprocess reconciliation.

## Verification

The CLI process tests require the compiled entrypoint, so build before running them.

```bash
npm run build
npm test -- tests/configuration.test.ts tests/chat.test.ts tests/cli-process.test.ts tests/pi.test.ts
npm test -- tests/workspace.test.ts tests/workflows.test.ts
CLAITH_RECOVERY_TESTS=1 npm test -- tests/recovery.test.ts
npm run typecheck
npm run lint:files -- src tests
npm run format:check:files -- src tests README.md INDEX.md
npm start -- init
npm start -- runtime
```

Ordinary tests use deterministic agents and make no paid model calls. Temporal
workflow tests use its time-skipping environment. Recovery tests opt into their
own Compose project, port, and disposable volume; they never use development data.
See [the acceptance procedure](docs/acceptance.md) for real Pi verification.

## Temporal development service

The API is at `127.0.0.1:7233` and Web UI at `http://127.0.0.1:8233`.
SQLite state lives in the `temporal-data` Docker volume and survives recreation.
`docker compose down` stops the service. Add `--volumes` only when intentionally
removing stored workflow history. This is a development service.
