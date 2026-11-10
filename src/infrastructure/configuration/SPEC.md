---
id: runtime-configuration
type: module-design
status: draft
title: Explicit configuration and profile initialization
parent: claith-architecture
---

## Responsibility

Configuration is explicit local input, not an import-time side effect. Bootstrap creates the directory structure first, then creates the main config and standard Implementer, Reviewer and Planner profiles concurrently. The CLI `init` path invokes bootstrap; it does not authenticate models, connect to Temporal or start delivery.

Initialization is create-only and repeatable: restore missing standard files/directories, preserve existing regular-file contents, and do not silently migrate or repair invalid user configuration. Blank model placeholders can be created successfully but must fail later loading until configured.

## Loading and profiles

The sectioned Claith config and named agent profiles have strict, independently invoked parsers. Profiles carry role, nonempty description, permissions, model/reasoning and a separate nonblank Markdown prompt. Planner and Reviewer profiles require repository read-only permissions. This is not a filesystem sandbox or an authorization model for application task-management tools.

Shared, profile-local and configured additional skill directories are validated on load. Relative additional paths resolve from the profile directory; absolute paths remain absolute. Initialization does not create user-specified additional directories. Parsing returns directory references, not loaded or executed skills.

Creation and loading remain separate: `init` must not reject an existing invalid profile merely because it would fail a parser. Runtime model authentication, tool selection and agent-session construction belong to callers, not configuration parsing.

## Current integration gap

The connected initialization path uses the directory-based profiles and sectioned config. The legacy `files.ts` loader still expects a different flat/inline layout and has stale imports; delivery is not wired to the new parsers. Neither the Planner template's phase-contract language nor the legacy loader defines the product direction in `claith-goal`.

Per-project Git targets and autonomy settings are product requirements without a selected configuration schema here. Skill execution is likewise not connected to Pi sessions; existing skill directories are not evidence of implicit SDK discovery.
