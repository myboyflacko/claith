# ThinkRail: architecture and lessons for Claith

Research date: 2026-10-25. ThinkRail snapshot: `d299f20d2ba014f382ddbcc9b49f2aa63fada132`.

This note distinguishes implementation observations, declared product intent, and recommendations. It is research, not an approved change to Claith's project goal. ThinkRail's source was inspected without installing dependencies or executing its application. Sources below are pinned to the inspected commit where possible.

Claith status: this is a historical research note. The accepted direction now uses TypeScript, Temporal, and Pi; see the [delivery runtime design](../../wiki/architecture/architecture_delivery-runtime.md) and [current tooling status](../../wiki/architecture/architecture_tooling.md). Python/LangGraph integration options below reflect the research date.

## What ThinkRail is

ThinkRail is an agentic IDE built around the `pi` coding-agent harness. Its product specification explicitly selects pi as its only engine and excludes a second host-owned model/tool loop. The product owns projects, isolated workspaces, the editor, terminals, review interfaces, and the connection to its clients. Pi owns model selection, prompts, skills and extensions, compaction, usage, and native session state. ThinkRail influences the agent through pi's extension and resource interfaces. Calling ThinkRail an IDE embedding and extending a harness is more precise than calling it a new independent harness. [Product goal][goal] [Architecture][architecture]

The architecture has three main layers:

- An engine host embeds pi in process and owns persistent domain state.
- Typed, versioned contracts connect that host to clients.
- A React web client renders workspaces and agent activity. Browser and desktop launchers reuse the host and UI rather than implementing separate engines.

The separation closely matches Claith's desired runtime/UI split. The default desktop profile is local; a later shared-client desktop profile is described as future work. Endpoint configurability and remote browser access should not be interpreted as proof that every multi-runtime management feature is already shipped. [Architecture][architecture]

Implementation confirms that the host calls `createAgentSession`, supplies its `ModelRuntime`, adds `ask_user_question` as a custom tool, and loads extensions for subagents, background commands, and MCP. This is embedding one shared coding engine, rather than shelling out to a different provider's coding CLI for each selected model. [Session manager][sessions]

## Provider access and shared tools

ThinkRail delegates provider/model access to pi. The inspected manifests pin `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` to a common catalog version, while the session manager supplies the resolved runtime to sessions. ThinkRail does not instantiate a Claude Code SDK for Claude and a Codex SDK for OpenAI. Consequently the shared harness and its registered tools can remain the same while the selected provider/model changes. [Dependency catalog][catalog] [Session manager][sessions]

Upstream pi documents 15+ providers and extension mechanisms for custom providers/models. This supports a broad provider selection, not a promise of literally every model or identical feature support. Provider authentication, protocol compatibility, model access, tool calling, context limits, and model quality still matter. API keys and supported OAuth flows are routes to authorized inference; provider support does not itself grant an entitlement. [Pi overview](https://pi.dev/) [Pi model configuration](https://pi.dev/docs/latest/models-configuration) [Pi custom providers](https://pi.dev/docs/latest/custom-provider)

ThinkRail registers higher-level capabilities as pi extensions. The bundled set includes spec graph tools, workflow skills, todos, web access, user questions, review tools, subagents, and background commands. The native read/edit/write/bash primitives remain in pi's coding loop. Common tool implementations do not guarantee identical decisions or performance across models, but they remove a major source of variation between native provider harnesses. [Extension composition][extensions] [Session manager][sessions]

For Claith, this changes the earlier choice: uniform coding tools do not require building an entire new harness. Reusing one extensible provider-neutral harness is a third option alongside wrapping native Codex/Claude harnesses or implementing an agent loop from scratch. Pi is worth evaluating for that role, without treating the evaluation as an approved migration.

## What the specs actually provide

ThinkRail keeps plain Markdown documents beside the code, connected through YAML frontmatter. A recognized spec has `id` and `type`; the authoring model also requires `title`. `parent` forms a hierarchy. `depends-on`, `references`, and `implements` add cross-links. Types distinguish product requirements, system architecture, module design, submodule design, and temporary task specs. Lifecycle values include draft, active, stale, done, and deprecated. [Spec authoring contract][spec-skill] [Parser][spec-parser]

The important distinction is between durable intent and temporary execution. Durable specs describe responsibilities, decisions, contracts, dependencies, and invariants that code alone cannot explain. They are not run logs or a second source for facts easily derived from code. Temporary task specs can disappear after the work lands. [Spec authoring contract][spec-skill]

Seven dedicated tools make the documents usable by an agent:

| Tool            | Responsibility                                                               |
| --------------- | ---------------------------------------------------------------------------- |
| `spec_grep`     | Find relevant content with metadata filters.                                 |
| `spec_get`      | Resolve metadata, links, and the file path; ordinary read tools fetch prose. |
| `spec_graph`    | Return a bounded neighborhood rather than the complete repository graph.     |
| `spec_create`   | Create a document with structured metadata.                                  |
| `spec_update`   | Change frontmatter while preserving the prose.                               |
| `spec_delete`   | Remove a spec.                                                               |
| `spec_validate` | Detect dangling links, duplicate IDs, and parent cycles.                     |

The filesystem remains authoritative. A derived read index rescans names and reuses parses for files whose modification time and size have not changed. The UI and agent tools share the same pi-free graph implementation. A small `before_agent_start` extension makes lookup conditional on whether a documented decision or contract governs the work. This is practical progressive disclosure, not loading every specification into every model call. [Spec module][spec-module] [Extension rule][spec-extension] [Validator][spec-validator]

Structural validation does not prove that prose matches code, that a test is valid, or that a product requirement was met. The spec graph is also not a scheduler: `parent` and `depends-on` here organize knowledge. Claith's execution graph and acceptance evidence require separate semantics.

## Workflows, review, and recovery

The product's normal workflow package is a family of skills. A root router sends onboarding to project setup, product behavior changes to brainstorming, and PR lifecycle work to shipping. It explicitly excludes its own runtime layer. Therefore a workflow written in prose is not equivalent to Claith's proposed durable delivery state machine. [Workflow module][workflow] [Workflow router][workflow-router]

The todo system provides a shared chat plan with artifacts and verification text. Its store enforces one active step and preserves completed work during replanning. The host can attach commits to completed steps, and independent review has an explicit tool set and a structured verdict. These provide useful examples for bounded work and visible review, but agent-written completion and verification fields are not independently verified acceptance evidence by themselves. [Todo model][todos] [Reviewer role][reviewer]

ThinkRail reconstructs clients by reading host state and then subscribing to deltas. Session catalogs combine live sessions with pi's on-disk sessions. The architecture distinguishes an individual attempt ending from the agent settling after retries, compaction, or queued continuations. On resume, concrete repair code fills unresolved tool calls with abort/error results rather than pretending those operations completed. These mechanisms support usable transcript recovery; they do not establish exactly-once external delivery. [Architecture][architecture] [Session repair][repair]

ThinkRail's own app state and pi's native session/auth storage remain distinct concerns: the default session factory calls `SessionManager.create(cwd)`. Claith should configure its worker's pi storage explicitly instead of assuming every embedded engine automatically writes beneath Claith's data directory. [Session manager][sessions]

Worktrees isolate branches and working directories, not operating-system permissions. Project trust and per-server MCP admission are explicit product controls; extending this to Claith requires actual execution permissions and restricted credentials where needed. Shared tools alone cannot prevent an unrestricted shell from reaching the same external system through another path. [Product goal][goal] [MCP host integration][sessions]

## A particularly relevant module: pi-dag

The repository also contains `packages/pi-dag`, a portable backend orchestrator over `pi-delegation`. Its spec explicitly says it is not bundled into ThinkRail and has no workflow UI or wire integration. It nevertheless has implementation and tests for durable graph scheduling, immutable attempts/evidence, human gates, command receipts, version checks, ownership, and recovery. [DAG contract][dag] [DAG runtime][dag-runtime]

Its commands use caller-supplied `commandId` and `expectedVersion`. An acknowledgement records durable intent rather than claiming completion. Restart restores work paused; uncertain dispatch must be reconciled before continuation or retry. The contract explicitly declines an exactly-once external-side-effect guarantee. This is closer to Claith's delivery requirements than the product's skill router, and a strong reference for correctness semantics. It remains a separate package, not proof of a shipped autonomous software factory. [DAG contract][dag] [DAG runtime][dag-runtime]

## What Claith should take

Recommended now:

1. Evaluate one shared coding harness with provider adapters beneath it. Keep Claith's Delivery Contract lifecycle and commands/events above it. Native Codex/Claude adapters can remain separate execution profiles when their native behavior is desirable.
2. Reuse the host-owned-state and versioned-client-contract split. Reconnecting clients read current state before consuming live updates.
3. Borrow spec graph principles: stable IDs, small relevant-context reads, dependency links, structural checks, and updating intent when implementation changes a recorded decision. First decide how this extends Claith's existing wiki; do not introduce parallel authoritative documents accidentally.
4. Use isolated workspaces and bounded tasks with independent review. Bind every acceptance result to the relevant contract revision and code revision.
5. Separate model tool proposals, acknowledged commands, running attempts, settled results, verified acceptance, and authorized delivery. Pi-dag offers useful examples.

For Claith's stack, ThinkRail's in-process TypeScript SDK cannot simply be imported into Python. A TypeScript pi worker behind JSON/RPC or a small application protocol could perform coding turns while Python/LangGraph owns delivery. Pi's documented RPC mode is designed for non-Node integrations; custom tools and headless interaction need a focused compatibility trial. [Pi modes](https://pi.dev/) [Pi RPC](https://pi.dev/docs/latest/rpc)

Embedding pi still has maintenance costs. ThinkRail tracks host adaptations for extension loading, MCP lifecycle, session discovery, and presentation persistence in an upgrade checklist. A Claith evaluation should pin the engine version and verify these integration behaviors rather than assuming that a shared harness removes lifecycle work. [Pi compatibility][pi-compatibility]

Defer a complete editor, arbitrary UI-extension marketplace, and automatic harness self-modification until actual delivery needs justify them. ThinkRail's shipped visualization extension has server/web halves, but general installation, marketplace, new panels, and contributed wire methods are explicitly deferred. The marketing direction of building its own capabilities is broader than the implemented extension contract. [Extension contract][thinkrail-extensions]

The product distinction is intentional: ThinkRail helps a person work with agents in a rich workspace. Claith should use suitable mechanisms to fulfill an approved outcome with less supervision. The fixed delivery loop stays part of Claith even if its coding engine becomes pi or another shared harness.

[goal]: https://github.com/JetBrains/thinkrail/blob/d299f20d2ba014f382ddbcc9b49f2aa63fada132/goal-and-requirements.md
[architecture]: https://github.com/JetBrains/thinkrail/blob/d299f20d2ba014f382ddbcc9b49f2aa63fada132/architecture.md
[catalog]: https://github.com/JetBrains/thinkrail/blob/d299f20d2ba014f382ddbcc9b49f2aa63fada132/package.json
[sessions]: https://github.com/JetBrains/thinkrail/blob/d299f20d2ba014f382ddbcc9b49f2aa63fada132/packages/server/src/agent/agentSessionManager.ts
[extensions]: https://github.com/JetBrains/thinkrail/blob/d299f20d2ba014f382ddbcc9b49f2aa63fada132/packages/server/src/agent/extensions.ts
[spec-module]: https://github.com/JetBrains/thinkrail/blob/d299f20d2ba014f382ddbcc9b49f2aa63fada132/packages/spec-graph/SPEC.md
[spec-skill]: https://github.com/JetBrains/thinkrail/blob/d299f20d2ba014f382ddbcc9b49f2aa63fada132/packages/spec-graph/skills/spec-graph/SKILL.md
[spec-parser]: https://github.com/JetBrains/thinkrail/blob/d299f20d2ba014f382ddbcc9b49f2aa63fada132/packages/spec-graph/core/parse.ts
[spec-extension]: https://github.com/JetBrains/thinkrail/blob/d299f20d2ba014f382ddbcc9b49f2aa63fada132/packages/spec-graph/index.ts
[spec-validator]: https://github.com/JetBrains/thinkrail/blob/d299f20d2ba014f382ddbcc9b49f2aa63fada132/packages/spec-graph/core/validate.ts
[workflow]: https://github.com/JetBrains/thinkrail/blob/d299f20d2ba014f382ddbcc9b49f2aa63fada132/packages/pi-thinkrail-workflow/SPEC.md
[workflow-router]: https://github.com/JetBrains/thinkrail/blob/d299f20d2ba014f382ddbcc9b49f2aa63fada132/packages/pi-thinkrail-workflow/skills/choosing-a-workflow/SKILL.md
[todos]: https://github.com/JetBrains/thinkrail/blob/d299f20d2ba014f382ddbcc9b49f2aa63fada132/packages/pi-todos/SPEC.md
[reviewer]: https://github.com/JetBrains/thinkrail/blob/d299f20d2ba014f382ddbcc9b49f2aa63fada132/packages/server/src/host/reviewerRole.ts
[repair]: https://github.com/JetBrains/thinkrail/blob/d299f20d2ba014f382ddbcc9b49f2aa63fada132/packages/server/src/agent/sessionRepair.ts
[dag]: https://github.com/JetBrains/thinkrail/blob/d299f20d2ba014f382ddbcc9b49f2aa63fada132/packages/pi-dag/SPEC.md
[dag-runtime]: https://github.com/JetBrains/thinkrail/blob/d299f20d2ba014f382ddbcc9b49f2aa63fada132/packages/pi-dag/runtime/service.ts
[thinkrail-extensions]: https://github.com/JetBrains/thinkrail/blob/d299f20d2ba014f382ddbcc9b49f2aa63fada132/thinkrail-extensions/SPEC.md
[pi-compatibility]: https://github.com/JetBrains/thinkrail/blob/d299f20d2ba014f382ddbcc9b49f2aa63fada132/pi-compatibility.md
