---
title: Repository Structure
created: 2026-10-22
updated: 2026-10-22
tags: [project]
sources: []
---

# Repository Structure

The source package is divided into five areas with distinct responsibilities.

| Area | Purpose |
| --- | --- |
| `agents/` | Contains the domain concepts and rules related to agents and their roles. |
| `application/` | Coordinates application use cases and workflows using the domain and available interfaces. |
| `integrations/` | Adapts external products, services, and SDKs to Claith's internal formats. |
| `infrastructure/` | Provides technical foundations such as persistence, messaging, configuration, and runtime facilities. |
| `interface/` | Exposes entry points through which users or other systems interact with Claith. |
