# Project Wiki Log

> Append-only change history.
> Format: `## [YYYY-MM-DD] action | subject`
> Actions: `create`, `ingest`, `update`, `move`, `remove`, `lint`
> Every new entry body includes `Last changed by: <agent>` with the concrete executing agent name.

## [2026-10-22] create | project goal

- Added [[project_goal]] from the confirmed setup interview.

Last changed by: Codex

## [2026-10-22] create | repository structure

- Added [[project_repository-structure]] with the responsibilities of the top-level source areas.

Last changed by: Codex

## [2026-10-25] update | project goal

- Reframed [[project_goal]] around approved Delivery Contracts, evidence-backed outcomes, self-hosted runtimes, and minimal developer attention.

Last changed by: Codex

## [2026-10-27] update | delivery runtime design and phase one

- Recorded the Temporal/Pi runtime decision, execution terminology, dynamic plans, state, evidence, escalation, and recovery in [[architecture_delivery-runtime]].
- Added selected runtime and agent tools with migration boundaries in [[architecture_tooling]], and defined the first delivery slice and acceptance evidence in [[project_phase-one]].
- Linked the decisions from [[project_goal]], updated navigation and tag registration, and kept trading outside Claith's scope.

Last changed by: Codex

## [2026-10-27] update | runtime design and TypeScript scaffold alignment

- Integrated the accepted runtime design and phase-one scope with the current TypeScript scaffold and persistent local Temporal development service.
- Corrected implementation status in [[architecture_delivery-runtime]], [[architecture_tooling]], [[project_phase-one]], and the architecture links in [[project_goal]]; the product goal is unchanged.
- Replaced the obsolete Python layout in [[project_repository-structure]] with the current repository and a clearly marked module proposal, and updated navigation.
- Recorded the requester-directed removal of the legacy runtime before its replacement and retained the remaining delivery-loop acceptance requirements.

Last changed by: Codex

## [2026-10-27] move | ThinkRail research into the project wiki

- Moved the historical ThinkRail analysis from `docs/research/` to [[research_thinkrail-analysis]], preserving its content and external source references.
- Added research metadata, tag registration, domain navigation, and internal wikilinks; removed the obsolete `docs/` entry from the repository index.

Last changed by: Codex

## [2026-10-29] update | phase contracts, rolling planning, and implementation alignment

- Updated [[project_goal]] around human-approved phases with observable behavior, fixed criteria, autonomous task execution, final acceptance/corrections, and an explicit stop before the next phase.
- Replaced the general dynamic-runner/AI-orchestrator direction in [[architecture_delivery-runtime]] with a planner, deterministic quality gates, evolving task plans, `dev` integration/push, and explicitly authorized milestone promotion/publication on `main`.
- Distinguished proposed application SQLite persistence from Temporal execution authority and its service database; left schema/driver and publishing details as implementation work.
- Corrected obsolete scaffold-only descriptions in [[architecture_tooling]] and [[project_repository-structure]], including `config.toml`, permission profiles/registry, five custom tools, seven activities, task-contract fields, and current verification limits.
- Revised [[project_phase-one]] and navigation to separate the implemented task baseline and its recorded evidence from the next phase-delivery slice. Historical research and existing evidence were preserved.

Last changed by: Codex
