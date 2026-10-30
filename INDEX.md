| path                                      | description                                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `README.md`                               | Native runtime, terminal commands, configuration, recovery, and verification                                            |
| `AGENTS.md`                               | Repository instructions and working standards                                                                           |
| `package.json`                            | npm entrypoints, checks, and pinned runtime dependencies                                                                |
| `package-lock.json`                       | Locked dependency graph for npm ci                                                                                      |
| `.nvmrc`                                  | Node.js major version                                                                                                   |
| `tsconfig.json`                           | Strict source and test type checking                                                                                    |
| `tsconfig.build.json`                     | ESM source compilation and declarations                                                                                 |
| `eslint.config.mjs`                       | ESLint configuration                                                                                                    |
| `.prettierrc.json`                        | Prettier formatting configuration                                                                                       |
| `.prettierignore`                         | Formatting exclusions                                                                                                   |
| `vitest.config.ts`                        | Vitest configuration                                                                                                    |
| `src/main.ts`                             | Development and compiled CLI entrypoint                                                                                 |
| `src/bootstrap.ts`                        | Directory-only startup initialization                                                                                   |
| `src/settings.ts`                         | Central ~/.claith location                                                                                              |
| `src/configuration.ts`                    | config.toml and role-profile loading; non-overwriting explicit init                                                     |
| `src/domain/`                             | Runtime/profile schemas, tool registry, minimal task contracts, verification plans, run records and activity interfaces |
| `src/runtime/`                            | Task parent and role child workflows, direct client, activities, and native worker                                      |
| `src/workspace/`                          | Worktrees, ownership, checked integration, push reconciliation, cleanup, and evidence                                   |
| `src/agents/`                             | Prepared Implementer/Reviewer modules, role prompt templates, Pi sessions and audit logs                                |
| `src/cli/`                                | Direct task submission, JSON status, scoped resume, and cancellation                                                    |
| `tests/`                                  | Targeted configuration, workflow, workspace, Pi, terminal, and opt-in recovery checks                                   |
| `tests/fixtures/`                         | Isolated Temporal, Git, Pi and interrupted-worker fixtures                                                              |
| `docs/acceptance.md`                      | Real Pi acceptance procedure and recorded evidence                                                                      |
| `docker-compose.yml`                      | Persistent local Temporal development API and Web UI                                                                    |
| `wiki/index.md`                           | Durable project knowledge entrypoint                                                                                    |
| `wiki/architecture/ARCHITECTURE_INDEX.md` | Accepted runtime direction and selected tools                                                                           |
| `wiki/project/project_phase-one.md`       | Phase-delivery target and baseline evidence                                                                             |
| `wiki/research/RESEARCH_INDEX.md`         | Historical research and source references                                                                               |
