# claith

Self-hosted agentic development environment that turns approved Delivery Contracts into evidence-backed software outcomes with minimal developer attention

## Development

The repository currently contains project documentation and a local Temporal
development service. The replacement application runtime has not been implemented
yet.

### Temporal development server

With Docker and Docker Compose installed, start the
[Temporal CLI development server](https://docs.temporal.io/cli/setup-cli):

```bash
docker compose up -d --wait
```

The Temporal API is available at `127.0.0.1:7233` and the Web UI at
<http://127.0.0.1:8233>. Both ports are bound to the local host only.
SQLite state is stored in the `temporal-data` Docker volume and survives
container recreation. Stop the service with `docker compose down`; add
`--volumes` only to intentionally delete the stored state.

This service is for local development.
