| path                                          | description                                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `README.md`                                   | Native runtime, terminal commands, configuration, recovery, and verification                                      |
| `AGENTS.md`                                   | Repository instructions and working standards                                                                     |
| `package.json`                                | npm entrypoints, checks, and pinned runtime dependencies                                                          |
| `package-lock.json`                           | Locked dependency graph for npm ci                                                                                |
| `.nvmrc`                                      | Node.js major version                                                                                             |
| `tsconfig.json`                               | Strict source and test type checking                                                                              |
| `tsconfig.build.json`                         | ESM source compilation and declarations                                                                           |
| `eslint.config.mjs`                           | ESLint configuration                                                                                              |
| `.prettierrc.json`                            | Prettier formatting configuration                                                                                 |
| `.prettierignore`                             | Formatting exclusions                                                                                             |
| `vitest.config.ts`                            | Vitest configuration                                                                                              |
| `src/main.ts`                                 | Development and compiled CLI entrypoint                                                                           |
| `src/domain/`                                 | Task contracts, verification plans, submission validation, delivery evidence and run models                       |
| `src/application/agents/definitions.ts`       | SDK-independent Implementer, Reviewer and Planner definitions                                                     |
| `src/application/agents/tools.ts`             | Tool registry, role permissions and available tool selection                                                      |
| `src/application/agents/prompts/system/`      | Application-owned Implementer, Reviewer and Planner instructions                                                  |
| `src/infrastructure/bootstrap.ts`             | Directory-only startup initialization                                                                             |
| `src/infrastructure/directories.ts`           | Runtime directory creation                                                                                        |
| `src/infrastructure/settings.ts`              | Central ~/.claith location                                                                                        |
| `src/infrastructure/configuration/`           | Runtime/profile schemas, resolved settings and config.toml/profile file loading and initialization                |
| `src/infrastructure/process.ts`               | Logged and cancellable subprocess execution                                                                       |
| `src/infrastructure/storage/files.ts`         | JSON persistence, artifact paths and JSONL event logging                                                          |
| `src/infrastructure/workspace/`               | Git/worktree operations, writer ownership, verification, delivery checkpoints, integration, push and cleanup      |
| `src/integrations/`                           | Pi and Temporal SDK adapters                                                                                      |
| `src/integrations/pi/SPEC.md`                 | Prepared-session configuration isolation, role-neutral boundary and lifecycle contracts                           |
| `src/integrations/pi/session.ts`              | Role-neutral Pi session factory accepting prepared agent configuration                                            |
| `src/integrations/pi/tools/`                  | Pi tool definitions for process execution, diff reading and structured submissions                                |
| `src/integrations/temporal/`                  | Temporal clients and worker setup                                                                                 |
| `src/integrations/temporal/activities/`       | Activity registration, heartbeats, managed repositories, task-run collection and evidence persistence             |
| `src/integrations/temporal/workflows/`        | Temporal delivery/project workflows, signals, queries, configuration, runtime types and deterministic UUID helper |
| `src/integrations/temporal/workflows/SPEC.md` | Project admission, Taskflow workspace ownership, delivery evidence and replay contracts                           |
| `src/interfaces/cli/`                         | Terminal entry adapter                                                                                            |
| `tests/`                                      | Targeted configuration, workflow, workspace, Pi, terminal, and opt-in recovery checks                             |
| `tests/fixtures/`                             | Isolated Temporal, Git, Pi and interrupted-worker fixtures                                                        |
| `docs/acceptance.md`                          | Real Pi acceptance procedure and recorded evidence                                                                |
| `docker-compose.yml`                          | Persistent local Temporal development API and Web UI                                                              |
| `wiki/index.md`                               | Durable project knowledge entrypoint                                                                              |
| `wiki/architecture/ARCHITECTURE_INDEX.md`     | Accepted runtime direction and selected tools                                                                     |
| `wiki/project/project_phase-one.md`           | Phase-delivery target and baseline evidence                                                                       |
| `wiki/research/RESEARCH_INDEX.md`             | Historical research and source references                                                                         |
