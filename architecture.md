---
id: claith-architecture
type: architecture-design
status: draft
title: Planning, task queue and deterministic delivery
parent: claith-goal
implements: [claith-goal]
---

## Architecture and authority

`claith-goal` owns the product direction. Claith separates collaborative reasoning, durable task intent and deterministic execution. TypeScript on Node.js 24 is the application stack; npm manages dependencies, Pi supplies agent sessions, and Temporal supplies durable execution.

The Planner reasons about the project Goal and idea and uses validated application tools to manage SQLite task records. The handler selects tasks whose status is `ready` and whose dependencies and capacity permit execution. A model response is not itself a dispatch command or delivery proof.

SQLite is the required task source: queued intent, ordering and readiness must outlive the Planner session. Temporal owns dispatched execution, attempts, gates, waiting and cancellation. Editing a queued task cannot directly advance a running workflow past a check or review. Database and filesystem operations, Git, subprocesses and model calls belong in Activities, never replayed workflow code.

**Proposed handoff constraint (unconfirmed):** admission must reconcile a stable task/run identity between SQLite and Temporal before retrying uncertain dispatch. An execution must consume a recorded task/configuration snapshot, not silently reread mutable queue contents on replay. The task schema, claim protocol and autonomy settings are not selected here.

## Module boundaries and dependency direction

- `delivery-domain` owns task/result identity and evidence validation without model execution or scheduling. Its intended boundary is SDK-independent data and validation.
- `planning-application` owns Planner task-management use cases, role/tool policy and prepared agent invocations; it depends on domain contracts and external-service ports, not Pi SDK internals.
- `runtime-configuration` owns explicit initialization and loading. Bootstrap composes directory creation before configuration/profile creation; CLI code calls this boundary rather than initializing through module import.
- `temporal-runtime` adapts execution and persistence; its `project-workflow` child owns replayable scheduling and task delivery. Activities compose configuration, role execution and `git-workspace` effects. Workflow-safe domain validation and pure tool metadata are permitted; filesystem and SDK sessions are not.
- `pi-session-adapter` translates prepared configuration into SDK sessions; role policy and structured-result acceptance stay outside the session adapter.
- `git-workspace` owns candidate/integration revisions, repository writer coordination and safe delivery effects. It does not decide task readiness or select models.

Interfaces are control adapters, not schedulers. Large logs, transcripts, diffs and check outputs remain artifacts referenced by execution state rather than copied into workflow history. The SQLite task source, application evidence database and Temporal service's own persistence have different authority; they are not interchangeable stores.

## Delivery invariants

The task parent owns the workspace and bounded repair loop. Separate Implementer and Reviewer executions produce implementation/check evidence and an independent review for an exact candidate. Failed checks do not proceed to review; accepted review does not bypass verification of the integrated result. The delivery stage order is implementation → review → integration → push, with candidate and integration checks enforced along that path.

Role permissions and resolved tool selections are execution inputs, not permissions an agent can expand. An allowlist is not an OS or network sandbox. Cancellation and retries reconcile external effects; they cannot promise exactly-once Git/model execution or undo a confirmed push.

`git-workspace` defines the repository safety boundary. Per-project Git targets are required by `claith-goal`; the current hardcoded `dev` path is an implementation limitation, not the target architecture.

## Current implementation boundary

The connected CLI exposes initialization and help, not task/runtime commands. Source contains project backlog scheduling, task/role workflows, Git delivery, JSON artifacts and a SQLite evidence store. That SQLite store contains evidence, not Planner tasks. Backlog admission currently uses dependencies and priority in workflow state; it has no explicit SQLite `ready` protocol. Contract planning currently reads a JSON plan rather than invoking a Planner.

The repository refactor left stale imports, missing role/session contracts and missing agent execution modules. The Pi adapter exists but has no connected production caller, and the new profile parsers are not composed into delivery. `npm run typecheck` fails on these pre-existing missing-module references. Existing test scenarios and source algorithms are design evidence, not proof of an operational runtime.

The application task database/tools, collaborative Planner dispatch, configurable Git delivery and concrete autonomy modes are not implemented by this documentation change. The existing task workflow does not require human final acceptance; no phase-approval layer is introduced here.
