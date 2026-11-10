---
id: git-workspace
type: module-design
status: draft
title: Verified Git delivery and workspace ownership
parent: claith-architecture
depends-on: [delivery-domain]
---

## Responsibility

The workspace boundary turns an accepted candidate into a verified Git delivery without discarding unrelated work. It owns isolated candidate/integration workspaces, revision-bound command evidence, repository writer ownership, delivery checkpoints and cleanup. It neither plans tasks nor decides agent permissions.

## Verification and delivery safety

Candidate evidence applies to one exact revision. Setup/check commands come from the implementation's verification plan; setup effects have persisted checkpoints and interrupted effects require reconciliation. Checks must not modify tracked files. An altered revision or command set cannot reuse previous evidence.

Integration validates the candidate, checks and accepted review before merging in an isolated integration worktree. The integrated revision is checked again before advancing the target branch and pushing the exact verified object without force. A changed expected base blocks delivery instead of silently rebasing or overwriting unrelated commits.

Push recovery checks remote ancestry before repeating an uncertain push. Cleanup requires confirmed delivery and validates ownership of temporary branches/worktrees; dirty, changed or uncertain state is retained for reconciliation. Cancellation/failure does not undo an already confirmed push.

## Ownership and recovery

Filesystem ownership records bind a writer to its process identity and token. Same-worker managed repository mutations can queue; another live writer or surviving subprocess group remains a blocker. A timeout alone does not establish that an external effect stopped.

The durable subprocess runner in adjacent `infrastructure/process.ts` records process-group identity and output and supports cancellation/recovery using Linux process information. Managed project Git operations use it; native workspace Git code also contains direct subprocess calls, so not every Git operation has the same recovery wrapper.

## Git target requirement and current limit

`claith-goal` requires project-specific integration and push targets. Native task delivery currently hardcodes local `dev` and `origin/dev`; the project adapter rejects other delivery branches despite carrying default-branch metadata. A push target, permission to publish/deploy and a human acceptance policy are separate concepts.

Per-project Git delivery is therefore a requirement, not existing capability. Stale domain/process/storage imports also prevent treating this source as a connected production adapter. This specification does not authorize an assistant maintaining this repository to push or merge its own changes.
