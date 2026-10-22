"""Start a Codex thread in the current working directory."""

import asyncio
from pathlib import Path

from claith.agents import AgentRuntime, StartSessionRequest
from claith.integrations.codex import CodexAdapter


async def start_thread() -> None:
    """Start a thread and print its provider-independent session ID."""
    async with AgentRuntime(CodexAdapter()) as runtime:
        session = await runtime.start_session(
            StartSessionRequest(working_directory=Path.cwd())
        )

    print(session.id)


def main() -> None:
    """Run the thread-start application."""
    asyncio.run(start_thread())


if __name__ == "__main__":
    main()
