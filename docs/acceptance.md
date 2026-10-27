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

The runtime agents own this task's code changes. The initial runtime intentionally
reserves the `status` CLI command for this live acceptance task.

## Current evidence

Live acceptance is pending explicit approval of a generated Delivery Contract.
