# claith

Self-hosted task delivery through Temporal and Pi. One directly submitted contract
runs through fresh implementer/reviewer sessions, bounded repairs, verified
integration into `dev`, push to `origin/dev`, and cleanup. Autonomous phase planning
and final human phase acceptance remain future work.

## Run locally

Requires Node.js 24, npm, Git, Docker Compose, Linux `/proc`, an existing Pi login,
and Git identity. The target repository must have a clean `dev` checkout (if
checked out), an accessible `origin/dev`, and matching local/remote base commits.

```bash
npm ci
npm run dev -- init
# Set provider/model and instructions in:
# ~/.claith/agents/implementer.toml and ~/.claith/agents/reviewer.toml
docker compose up -d --wait
npm run dev -- runtime
```

In another terminal, create a task JSON file. Describe the expected behavior,
context, scope and constraints in `description`; acceptance criteria describe
observable results. The runtime captures the current local `dev` commit separately.

```json
{
  "taskId": "config-errors",
  "version": 1,
  "title": "Explain invalid configuration",
  "description": "Return an actionable error when configuration is invalid, so users can correct it without inspecting source code. Limit changes to configuration loading and its tests. Preserve existing valid configuration behavior.",
  "acceptanceCriteria": [
    {
      "id": "errors",
      "text": "Invalid configuration identifies the affected field."
    },
    {
      "id": "compatibility",
      "text": "Existing valid configuration continues to load."
    }
  ]
}
```

```bash
npm run dev -- run --project /absolute/path/to/repository --contract /path/to/task.json
npm run dev -- status --run <printed-run-id>
npm run dev -- resume --run <run-id>
npm run dev -- resume --run <run-id> --additional-repairs 1
npm run dev -- cancel --run <run-id>
```

`run` authorizes delivery of this task to `origin/dev` and returns a stable run ID.
It does not wait for completion. `status` prints a JSON record containing the
unchanged contract and its execution history. Identical submissions return the
existing run ID; a conflicting contract/configuration with the same project,
task ID and version is rejected. Use a new version for a changed contract.

This task schema replaces the previous task format: use `description` instead of
`tasks`/`goal`/`context`/`scope`/`constraints`, retain only `id` and `text` on criteria,
and remove `startCommit`, `setup` and `checks`. Existing task files are not migrated.
Stop or finish active runs before replacing workers: this changes workflow inputs,
activity results and scheduling and does not support replaying old active runs.
Historical session artifacts remain intact. The former chat/coordinator commands
remain removed; `docs/acceptance.md` preserves evidence for that historical runtime.

## Execution and blockers

The parent `taskWorkflow` owns the worktree and repair budget. Each attempt starts
an `implementerWorkflow` Child Workflow: fresh Pi session, structured submission,
candidate commit and checks. A `reviewerWorkflow` Child Workflow then runs a fresh
review session against that exact revision. All criteria must have evidence and
all findings must be resolved before acceptance. Failed checks skip review and
return feedback to the next attempt.

The contract contains only `taskId`, `version`, `title`, `description` and behavioral
`acceptanceCriteria`. Model, tools, permissions, runtime settings and the start commit
belong to the execution context, outside the task. Configuration and resolved tool
selections are captured for the run rather than reloaded during repairs.

Importable `createImplementer(context)` and `createReviewer(context)` modules bind the
role profile, tools, Markdown prompt template and execution context; callers invoke
`.run(task)`. TOML instructions and role templates form the system prompt together
with repository instructions. The task and invocation data are rendered into the user
message. The reviewer automatically receives candidate/check evidence and can inspect
the approved diff with `read_diff`. Fix sessions receive prior findings and check
results. Technical recovery retains the same attempt/session identity; a new logical
repair gets a new session in the existing task worktree.

The implementer follows applicable `AGENTS.md` verification guidance. Without it,
the agent chooses appropriate verification using its judgment. Its structured result
contains a `verificationPlan`: optional `setup` commands and at least one `checks`
command, each with a unique `id` and `command` (`diff` is reserved for evidence).
Commands run from the worktree root. Include dependency installation in setup;
checks must not modify tracked files. The runtime creates the candidate commit,
records that attempt's plan and executes setup/checks against the exact candidate.
Required setup and the same checks run again in the fresh integration worktree.
The reviewer assesses whether the chosen checks and evidence sufficiently demonstrate
each behavioral criterion, as well as checking code, scope and project standards.

`maxRepairs = 2` permits the initial attempt plus two repairs. Exhaustion blocks
until explicitly extended. Other blockers can be resumed after their underlying
cause has been resolved. `resume` targets the current blocker; stale or conflicting
commands are rejected. A changed local or remote `dev` base requires a new task
version and run, not an automatic rebase. The previous workspace remains available
for work recovery.

Accepted work is merged in an isolated integration worktree with a merge commit.
The runtime checks this result before advancing local `dev` and pushing the exact
verified commit, without force. Failed integration checks consume the same repair
budget. Push or cleanup errors block at their delivery stage; resumption does not
repeat successful agent work. Uncertain pushes are reconciled from remote ancestry.

After confirmed push, runtime-owned temporary worktrees and local task/integration
branches are removed. Contract, attempts, sessions, submissions, diffs and logs
remain. Dirty or unexpectedly changed workspaces are preserved for reconciliation.
`completed` means delivery and cleanup succeeded; cancellation is distinct and
preserves existing effects. Neither cancellation nor failure rolls back an already
confirmed push. No operation targets `main`, creates a PR, or publishes a release.

## Configuration and artifacts

`~/.claith/config.toml` is the only runtime settings file. Profiles require
`provider`, `model`, `instructions`, and explicit `permissions`; `reasoning`
defaults to `medium`. Implementer defaults to `read-write`; reviewer is capped at
`read-only`. The runner no longer requires an orchestrator profile. `init` creates
missing templates and preserves existing files. Transfer settings from an old
`claith.toml` manually; legacy `[agents]`/`[workflow]` configuration is not loaded.

The central registry in `src/domain/tools.ts` resolves profile permissions into
saved tool selections. Implementer has Pi read/search/edit/write tools and Claith's
logged/cancellable `bash` plus `submit_implementation`. Reviewer has read/search,
`read_diff`, and `submit_review`. Restricting implementer to `read-only` removes its
write/shell tools. These allowlists and descriptive scope constraints are not an
OS/filesystem sandbox. Pi's normal authentication is used; arbitrary extensions,
skills, MCP servers and packages are not loaded. Later registry/profile edits do
not expand an existing execution's saved rights.

Run data is under `~/.claith/sessions/<run-id>/`: `input.json` (task plus execution snapshot), the JSON `run.json`
contract/execution record, per-role/per-attempt session manifests and results,
candidate diffs, check evidence, integration/delivery checkpoints, and confirmed
push/cleanup records. Logs are under `~/.claith/log/`; temporary worktrees are under
`~/.claith/worktrees/`. Interrupted setup requires reconciliation before repetition.
Large evidence remains files; there is no application SQLite database. Temporal is
authoritative for execution; the JSON record is its durable artifact projection.

## Verification

Run the smallest checks relevant to your change, for example:

```bash
npm run test -- tests/contracts.test.ts tests/pi.test.ts
npm run test -- tests/workspace.test.ts tests/workflows.test.ts
npm run test -- tests/cli-process.test.ts
CLAITH_RECOVERY_TESTS=1 npm run test -- tests/recovery.test.ts tests/task-recovery.test.ts
npm run typecheck
npm run lint:files -- src tests
npm run format:check:files -- src tests README.md
```

Tests use agent doubles without paid model calls. Git delivery tests push only to
fixture-owned local bare remotes. Workflow tests include a complete repair,
review, integration, push and cleanup flow. Opt-in recovery uses its own disposable
Compose projects/ports/volumes, restarts the worker/service while blocked, and
SIGKILLs a worker during an agent effect to verify same-session recovery.

## Temporal development service

Compose exposes API `127.0.0.1:7233` and Web UI `http://127.0.0.1:8233`. SQLite service
state lives in the `temporal-data` volume. This is distinct from Claith application
storage. Closing a CLI client does not cancel work. Keep runtime and service
running for progress and queries; use a process supervisor for unattended operation.
