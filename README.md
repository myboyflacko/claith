# claith

Self-hosted agentic development environment that turns approved Delivery Contracts into evidence-backed software outcomes with minimal developer attention

## Development

This project uses Python 3.12, `uv`, Ruff, and pytest.

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

This service is for local development. The existing Python workflow below does
not yet connect to Temporal.

## Implementation-review workflow

Copy `claith.example.toml` to `claith.toml`, select an available model for both
profiles, and authenticate Codex with `uv run claith-login`. The in-memory MVP can
then be used through its Python API:

```python
import asyncio
from pathlib import Path

from claith.application import DeliveryRequest, bootstrap


async def main() -> None:
    async with bootstrap(Path("claith.toml")) as app:
        result = await app.run(
            DeliveryRequest(
                task="Implement the approved task",
                working_directory=Path.cwd(),
            )
        )
        print(result.model_dump_json(indent=2))


asyncio.run(main())
```

State and queued events exist only for the lifetime of this application instance.
When the result is interrupted, call `app.resume(result.workflow_id, decision)` in
the same instance with `HumanDecision.CONTINUE` or `HumanDecision.CANCEL`.
