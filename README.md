# claith

Self-hosted agentic development environment that turns approved Delivery Contracts into evidence-backed software outcomes with minimal developer attention

## Development

This project uses Python 3.12, `uv`, Ruff, and pytest.

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
