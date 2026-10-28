| path                                      | description                                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `README.md`                               | Native runtime, terminal commands, configuration, recovery, and verification             |
| `AGENTS.md`                               | Repository instructions and working standards                                            |
| `package.json`                            | npm entrypoints, checks, and pinned runtime dependencies                                 |
| `package-lock.json`                       | Locked dependency graph for npm ci                                                       |
| `.nvmrc`                                  | Node.js major version                                                                    |
| `tsconfig.json`                           | Strict source and test type checking                                                     |
| `tsconfig.build.json`                     | ESM source compilation and declarations                                                  |
| `eslint.config.mjs`                       | ESLint configuration                                                                     |
| `.prettierrc.json`                        | Prettier formatting configuration                                                        |
| `.prettierignore`                         | Formatting exclusions                                                                    |
| `vitest.config.ts`                        | Vitest configuration                                                                     |
| `src/main.ts`                             | Development and compiled CLI entrypoint                                                  |
| `src/bootstrap.ts`                        | Directory-only startup initialization                                                    |
| `src/settings.ts`                         | Central ~/.claith location                                                               |
| `src/configuration.ts`                    | config.toml and role-profile loading; non-overwriting explicit init                       |
| `src/domain/`                             | Runtime/profile schemas, tool registry, contracts, snapshots, and activity interfaces   |
| `src/runtime/`                            | Temporal coordinator/child workflows, client, activities, and native worker              |
| `src/workspace/`                          | Worktrees, ownership reconciliation, processes, candidate commits, and evidence storage  |
| `src/agents/`                             | Pi role sessions, effective tool allowlists, structured completion, and audit logs       |
| `src/cli/`                                | Terminal conversation, approvals, scoped decisions, reconnect, and cancellation          |
| `tests/`                                  | Targeted configuration, workflow, workspace, Pi, terminal, and opt-in recovery checks    |
| `tests/fixtures/`                         | Isolated Temporal service fixtures                                                       |
| `docs/acceptance.md`                      | Real Pi acceptance procedure and recorded evidence                                       |
| `docker-compose.yml`                      | Persistent local Temporal development API and Web UI                                     |
| `wiki/index.md`                           | Durable project knowledge entrypoint                                                     |
| `wiki/architecture/ARCHITECTURE_INDEX.md` | Accepted runtime direction and selected tools                                            |
| `wiki/project/project_phase-one.md`       | First delivery slice and scope                                                           |
| `wiki/research/RESEARCH_INDEX.md`         | Historical research and source references                                                |
