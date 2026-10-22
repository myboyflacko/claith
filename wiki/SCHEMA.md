# Project Wiki Schema

## Purpose

This Git-tracked wiki stores curated, durable project knowledge. Tickets, working notes, chats, sessions, secrets, and unreviewed or short-lived content do not belong here.

`raw/` is a separate store for original source artifacts that require immutable preservation. Curated knowledge may also come directly from project context or user-provided information without a raw copy.

## Root

```text
index.md   # entry point
SCHEMA.md  # these rules
log.md     # append-only change log
tags.md    # tag registry
raw/       # evidence store
```

The root contains no curated knowledge pages.

## Navigation and Grouping

- Organize knowledge into subject domains and, when needed, subdomains.
- Create a domain or subdomain with its first knowledge page: create the directory and its corresponding index together. Do not create empty placeholder areas.
- Group related knowledge pages in a shared directory. Use the named group index only for navigation; do not add an overview page solely to summarize the group. Create child pages only when their content must be referenced, updated, or retrieved independently.
- `index.md` is the only root index. Give every directory outside `raw/` its own named index.
- Keep indexes free of frontmatter. Briefly describe their immediate contents and link to pages in the same directory and indexes of direct subdomains.
- Use pathless wikilinks with the unique filename: `[[filename]]`. Aliases and section anchors are allowed. Do not create artificial placeholder pages.

## Names

Keep filenames unique across the wiki.

- Directory names: lowercase; join words within a term with `-`.
- Use `_` only to separate domain levels; use `-` to join words within a level or term.
- Domain indexes: use the full directory path in uppercase, separate levels with `_`, and append `_INDEX.md`.
- Knowledge pages: use the full domain path in lowercase, separate levels with `_`, and append `_` plus a descriptive lowercase title.

```text
research/source-quality/RESEARCH_SOURCE-QUALITY_INDEX.md
research/source-quality/research_source-quality_evaluation.md
```

## Curated Knowledge Pages

Every page must meet at least one of these criteria: document a decision; describe a system, concept, procedure, or project with long-term relevance; distill reusable insights from multiple sources; or serve as a central reference in its own right.

```yaml
---
title: ...
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [...]
sources: [...]
---
```

- Include at least one tag registered in `tags.md`.
- Keep `sources` limited to actual supporting wikilinks, wiki-relative `raw/` paths, or complete external URLs. Use `sources: []` when no such source exists.
- Update the existing page about the same topic in the same domain. Replace superseded statements and remove wholly obsolete pages; Git preserves their history.
- Remove source entries that support no current statement.

## Raw Evidence

`raw/` is not a wiki domain and has no indexes. Reserve it for imported files, source text designated for ingestion, and material explicitly preserved in its original form. Direct project statements and ordinary notes are curated without a raw copy. Use complete external URLs directly unless a local archival copy is needed or requested.

- Use collision-free filenames for new evidence objects.
- Give Markdown sources frontmatter with `title`, `owner`, and `created_at`. `source_url` is optional and applies only to web pages.
- Give non-Markdown sources a `.meta.yaml` sidecar file with the same base name and metadata.
- Preserve the original wording, language, bytes, and known provenance of raw evidence.
- Do not modify an evidence object after ingestion; add corrections or new versions as new evidence objects.
- Leave existing evidence objects unchanged when metadata rules are introduced later.

## Tags

`tags.md` is the only tag registry. Every tag used by a curated page has one registry row. Tags use lowercase letters and digits with hyphens between words. Meanings are nonempty, distinct text without table separators (`|`). Reuse a suitable registered tag before adding another.

## Changes

- Keep every current curated page listed in the relevant index and remove navigation to deleted pages.
- Keep `log.md` append-only and document every change. New entries include `Last changed by: <agent>` with the concrete executing agent name.
