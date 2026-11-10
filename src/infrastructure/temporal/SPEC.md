---
id: temporal-runtime
type: module-design
status: draft
title: Durable execution and activity effects
parent: claith-architecture
depends-on:
  [delivery-domain, planning-application, runtime-configuration, git-workspace]
---

## Responsibility

Temporal provides durable execution independently of an attached client or Planner conversation. `project-workflow` owns replayable scheduling and task lifecycle rules; Activities perform external effects and validate their results. Model calls, Git, filesystem/process access, configuration loading and SQLite operations never run directly in workflow code.

Workflow history owns dispatched attempts, decisions, timers and progress. Queries return read-only JSON-safe views and cannot schedule Activities. Signals in the current project scheduler enqueue commands; invalid commands become diagnostics rather than uncaught workflow failures. Code changes affecting replay require compatibility with existing histories rather than silently changing earlier decisions.

## Persistence and effects

The source contains a real Node SQLite evidence adapter in `activities/projectActivities.ts`: project-keyed evidence uses transactional writes and rejects changed content under an existing evidence identity. Read workflows/Activities page durable evidence outside Queries. This is an evidence store, not the required Planner task queue.

JSON run inputs, records, manifests and delivery checkpoints retain immutable execution inputs and inspectable evidence references. Filesystem dispatch reservations survive fresh project executions and conservatively retain uncertain workspace capacity. Large outputs stay in artifacts, not workflow history.

Effects may outlive an Activity timeout or be repeated after failure. Cancellation, ownership checks and reconciliation are required before repeating uncertain work. Scoped resume commands identify the current blocker and command; a stale response must not unblock another decision. Repair-budget extensions require explicit input.

## Current integration boundary

Worker/activity registrations, workflow bundle paths and clients retain stale imports after the refactor. Implementer/Reviewer execution modules are missing. The source algorithms and authored tests therefore do not establish a currently runnable worker or delivery CLI.

The target SQLite task-source handoff is defined in `claith-architecture`. Current project scheduling instead receives explicit tasks/JSON plans into workflow state. Adding a task database must not turn mutable database reads into replay inputs or make queue edits a second running-workflow scheduler.
