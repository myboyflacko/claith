# Phase-one acceptance

The deterministic checks in README run without model costs. The recovery fixture
uses an isolated Compose project and persistent volume across service restart;
cleanup removes only that fixture's own data.

## Real Pi task

1. Commit the delivery runtime on its feature branch. Ensure Git identity is set,
   profiles select available Pi models, and `docker compose up -d --wait` succeeds.
2. Start `npm run dev -- runtime` and open chat for the Claith repository.
3. Ask the orchestrator to add `npm run dev -- status --session <id> --json` as one
   bounded task. It must serialize the existing `SessionSnapshot` as one JSON
   document with current task and pending question, send diagnostics to stderr,
   and exit nonzero for an unknown session. Include targeted CLI tests, typecheck,
   lint, formatting, and a build check. Require review and a local commit endpoint.
4. Inspect the generated contract. A human must explicitly approve its exact
   task/version before implementation. Model/profile selection alone does not
   approve this contract.
5. After approval, let the runtime implement, commit a candidate, run its approved
   checks, and review that same revision. Answer any scoped blocker with a bounded
   continuation. Confirm human criteria only after inspecting evidence.
6. Inspect `accepted.json`, the check output references and checked revision, the
   reviewer verdict/revision, the task branch/worktree, and the coordinator's
   accepted results. Check both development and compiled JSON status output and
   the unknown-session exit code. Record the session ID and accepted commit here.
7. Preserve the task branch and evidence. Do not merge, push, or create a PR as
   part of this acceptance run.

The runtime agents own this task's code changes. The initial runtime reserves
the `status` CLI command for this live acceptance task. Its accepted implementation
remains on the preserved task branch below.

## Current evidence

Verified on 2026-10-27 against an isolated deterministic recovery service and the
existing development service for the explicitly approved real Pi run.

| Evidence                         | Result                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration/startup tests      | 15 passed; five directories, explicit non-overwriting init, validation errors                                                                 |
| Temporal workflow tests          | 9 passed; approval, optional review, shared repair budget, human confirmation, stale decisions/results, reminders                             |
| Workspace/process tests          | 10 passed; branch chaining, commit recovery, revision changes/restores, writer exclusion, cancellation, uncertain setup, locked installs      |
| Pi SDK doubles                   | 7 passed; role boundaries, correction limit, transcript reuse, fresh reviewer sessions, cancellation                                          |
| Terminal/control tests           | 6 passed; scoped decisions, reconnect, disconnect, process failures                                                                           |
| Isolated recovery integration    | 2 passed; worker/service restart with the same question, interrupted commit checkpoint, two chained worktrees, SIGKILL during an agent effect |
| Host static/build checks         | Typecheck, changed-file ESLint/Prettier, build, development and compiled runtime startup passed                                               |
| Live approved checks             | All five commands passed at the accepted revision; 21 targeted CLI tests, build, typecheck, changed-file lint/format                          |
| Real Pi reviewer                 | `accepted`, same revision, no blocking findings                                                                                               |
| Real development/compiled status | Each returned one complete JSON document, state `completed`, current task retained, pending question `null`, empty stderr                     |
| Real unknown session             | Exit 1, empty stdout, diagnostic on stderr                                                                                                    |

Session: `5f4b77b2-6186-4c84-ba31-8ecd0aa5345d`.
Approved contract: `cli-session-status-json`, version 1, starting revision
`12955cd383f0cf2afb7810e8419371ff08ca1eb0`.
Accepted commit: `5e0963a29cfe066faa9b690adf32be0090897fd4`.
All three real roles used the available Pi model `openai/gpt-6.1-sol`.
Profiles are in `~/.claith/agents/`; prior files were backed up before replacement.

The first setup failed before implementation because an npm-started worker
inherited the one-off `npm_config_allow_scripts` flag. The host runtime now lets
nested npm installs read the target project's own configuration instead of
inheriting that flag. A real locked-install regression passes. The pending
question survived a worker restart; the same approved contract resumed with one
of its original two repairs, without granting extra rounds or changing its base.

The accepted status implementation is on branch
`feature/claith-5f4b77b2-6186-4c84-ba31-8ecd0aa5345d-cli-session-status-json-v1`.
It is intentionally separate from `feature/phase-1`; no merge, push or PR was made.
Use its preserved worktree while the native runtime and Temporal service are running:

```bash
cd ~/.claith/worktrees/c979d5a4f2d8d19ae187bb3d/5f4b77b2-6186-4c84-ba31-8ecd0aa5345d-cli-session-status-json-v1
npm --silent run dev -- status --session 5f4b77b2-6186-4c84-ba31-8ecd0aa5345d --json
npm --silent start -- status --session 5f4b77b2-6186-4c84-ba31-8ecd0aa5345d --json
```

`--silent` suppresses npm's own lifecycle banner when capturing application JSON.
Both startup variants accept the same status arguments.

Durable artifacts are under
`~/.claith/sessions/c979d5a4f2d8d19ae187bb3d/5f4b77b2-6186-4c84-ba31-8ecd0aa5345d/5f4b77b2-6186-4c84-ba31-8ecd0aa5345d-cli-session-status-json-v1/`:

- `approval.json`: exact approved contract, execution configuration and workspace.
- `implementation-1.json`, `candidate-1.json`, `diff-1.patch`: implementation and candidate.
- `checks-1.json`, `check-1-*.log`: five commands, exit status, output and checked revision.
- `review-1.json`, `accepted.json`: matching reviewer verdict and accepted result with no blockers.
- `live-status-development.json`, `live-status-compiled.json`: actual completed SessionSnapshots.
- `setup-0-*`, `setup-1-*`: preserved failed and successful setup effects.

The session's `orchestrator/proposal-1-0-0.json` preserves the approved proposal;
`proposal-1-1-1.json` explains completion and proposes no further task.
Role transcripts and correlated runtime/tool logs remain available for inspection.
