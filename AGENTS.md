# Project

**Name:** claith

**Purpose:** Self-hosted agentic development environment that turns collaboratively planned, Goal-driven tasks into verified software delivery through deterministic execution with minimal developer attention

## Project Index

Use `INDEX.md` in the repository root for initial orientation. It references only product, architecture and module specifications, not individual source files or other documentation.
Update the index in the same change whenever a spec is added, moved or removed, or an indexed module's responsibility changes.

## Specifications

When planning or implementing, read `goal-and-requirements.md`, then consult `architecture.md` and the owning module's `SPEC.md` as relevant. Specs define the product direction, decisions, contracts and module boundaries; code and configuration establish current implemented behavior. Surface and reconcile contradictions rather than silently diverging. Make material deviations explicit. Current requester instructions remain authoritative.

After every module change, update its owning `SPEC.md` in the same change so it accurately reflects the module's behavior, responsibilities, interfaces, dependencies and invariants. If the module has no owning spec, create one at the appropriate module boundary and add it to `INDEX.md`. Update parent or related specs when cross-module contracts or architecture change. Keep specs concise and distinguish implemented behavior from target requirements and unconfirmed design.

## Issue Tracker

Use GitHub Issues through GitHub CLI (gh).

- Project: myboyflacko/claith

## Working Standards

- Use TypeScript with Node.js 24 and manage the project and its dependencies with `npm`. Keep `package-lock.json` in sync with `package.json`; use `npm ci` for locked installs.
- Run project tools through the npm scripts in `package.json`.
- Use Vitest. Add relevant tests for behavior changes and bug fixes.
- Mirror the source module hierarchy under `tests/`: tests for `src/infrastructure/configuration/agentProfiles/` belong in `tests/infrastructure/configuration/agentProfiles/`. Place integration suites under the module responsible for the behavior.
- Keep module-specific fixtures in `tests/<module-path>/fixtures/`; reserve `tests/fixtures/` for fixtures shared across modules.
- When moving a source module, move its tests and update imports, mocks, fixture/workflow paths, and documented test commands in the same change.
- Automatically run the smallest relevant tests. Run the complete test suite only when explicitly requested.
- Use ESLint for linting and Prettier for formatting. Lint and format changed TypeScript files, and type-check changes with `npm run typecheck`.
- Run the smallest safe task-appropriate verification. Run `npm run build` only when explicitly requested or when the task changes packaging behavior.
- Change only what directly belongs to the task; avoid incidental refactors and speculative features.
- Keep output short and limited to relevant results.

## Workflow

Implement → update affected specs → verify → lint → inspect the diff → commit. Fix failures and repeat from the affected check.

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
