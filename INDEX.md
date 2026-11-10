# Specification Index

## Product and architecture

- [Product goal and requirements](goal-and-requirements.md) — Goal-driven collaborative planning and autonomous task delivery.
- [System architecture](architecture.md) — Planning, SQLite task intent, deterministic execution and module boundaries.

## Modules

- [Delivery domain](src/domain/SPEC.md) — Task identity, structured submissions and revision-bound evidence acceptance.
- [Planning application](src/application/SPEC.md) — Planner task management, role/tool policy and agent composition.
- [Runtime configuration](src/infrastructure/configuration/SPEC.md) — Explicit initialization and strict configuration/profile loading.
- [Pi session adapter](src/infrastructure/pi/SPEC.md) — Prepared-session isolation and role-neutral lifecycle.
- [Temporal runtime](src/infrastructure/temporal/SPEC.md) — Durable execution, Activity effects and evidence persistence.
  - [Project workflows](src/infrastructure/temporal/workflows/SPEC.md) — Admission, task delivery, replay and recovery contracts.
- [Git workspace](src/infrastructure/workspace/SPEC.md) — Writer ownership, verification, integration, push and cleanup safety.
