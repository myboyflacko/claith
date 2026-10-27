# Project

**Name:** claith

**Purpose:** Self-hosted agentic development environment that turns approved Delivery Contracts into evidence-backed software outcomes with minimal developer attention

## Project Index

Use `INDEX.md` in the repository root for initial orientation.
When an entry point, top-level domain, or its responsibility changes, update `INDEX.md` in the same change.

## Additional Project Context

Code and configuration are authoritative for current behavior. When non-standard project knowledge or prior project-specific decisions, systems, or procedures could affect the task, start at `wiki/index.md` and read only relevant active pages. Treat `wiki/raw/` as evidence. Modify the wiki only when explicitly requested, and read `wiki/SCHEMA.md` first.

When planning or implementing, read `wiki/project/project_goal.md` and follow the project goal. Make material deviations explicit. Current requester instructions remain authoritative when they conflict with that direction.

## Issue Tracker

Use GitHub Issues through GitHub CLI (gh).

- Project: myboyflacko/claith

## Working Standards

- Use the tooling configured in the repository for the component being changed.
- Add relevant tests for behavior changes and bug fixes.
- Automatically run the smallest relevant tests. Run the complete test suite only when explicitly requested.
- Lint and format changed files with the component's configured tools.
- Run the smallest safe task-appropriate verification. Run builds only when explicitly requested or when the task changes packaging behavior.
- Change only what directly belongs to the task; avoid incidental refactors and speculative features.
- Keep output short and limited to relevant results.

## Workflow

Implement → verify → lint → inspect the diff → commit. Fix failures and repeat from the affected check.

## Final Response

Begin with a short outcome statement. Then use these labels, separated by blank lines, without Markdown headings:

- `**Changed**`: changed files and what changed
- `**Verification**`: checks performed
- `**Open / Risks**`: only when work remains or risks exist
- `**Git**`: branch, commit, and PR status compactly on one line

## Gitflow

When the working directory is a Git repository:

- Never work on or push directly to `main`. `dev` is the clean starting point, not a working branch.
- Check status and branches at the start. If an existing clean working branch clearly matches the task, continue there directly.
- Otherwise, create a branch from `dev` with exactly one purpose: `feature/*`, `fix/*`, `refactor/*`, or `docs/*`. Use the normal working directory for sequential and small tasks.
- Use separate worktrees only when multiple tasks or agents are working in parallel.
- If the working branch to be used is not clean, or `dev` is not clean when creating a new branch, ask the requester what should happen to those changes before editing.
- Commit only task-related changes; report unrelated findings only as open work. By default, commit completed changes locally with a functional commit message.
- Push the working branch and create or update a PR only when explicitly requested and after relevant checks pass.
