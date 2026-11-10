---
id: pi-session-adapter
type: module-design
title: Role-neutral Pi session adapter
status: draft
parent: claith-architecture
depends-on: [planning-application]
---

## Responsibility and boundary

The adapter translates a caller-prepared agent configuration into a Pi SDK session and exposes an SDK-independent session interface. Role selection, permission policy, tool composition, task prompts and result acceptance belong to the caller under `planning-application`. The adapter does not inspect a role or add role-specific tools, completion protocols or correction prompts.

The referenced application session contract and relocated domain import are currently unresolved after the refactor. The former agents/pi.ts execution module is absent, and this adapter has no connected production caller. The lifecycle below describes the source implementation, not a functioning end-to-end role execution path.

## Configuration isolation

Callers supply model identity, developer instructions, tool names, custom tool implementations, working/session directories and optional system prompt, reasoning and Pi settings. Instructions and the supplied system prompt form the system message; no repository instructions, skills, prompt templates or extensions are discovered implicitly. Permission policy must already have constrained the supplied tool selection; an AgentDefinition permission label is not an SDK sandbox.

Pi settings are in-memory, with compaction enabled and retries disabled unless explicitly overridden. The adapter does not read Claith configuration files or write Pi settings. An injected model runtime is supported; otherwise Pi's configured model/auth runtime is used. Missing model or authentication fails before SDK session creation.

## Session lifecycle

A new session is created unless the caller explicitly supplies a transcript to reopen. The returned identity and transcript reference let the caller own persistence and recovery; the adapter does not guess a task identity or select a previous session.

sendPrompt forwards a message unchanged and waits for the Pi turn to finish. Sequential sends share the transcript; concurrent sends are rejected instead of becoming implicit steering messages. Completion does not imply a validated task result: supplied tools and the caller own structured submissions and delivery evidence.

abort delegates cancellation to Pi. dispose marks the wrapper closed, aborts active work and releases the SDK session even if abort fails. Repeated disposal shares the same completion or failure, and disposed sessions reject further prompts. Prompt failures propagate without application-level correction or retry.
