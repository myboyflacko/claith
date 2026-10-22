"""Log in to the configured agent provider."""

import asyncio

from claith.agents import AgentRuntime
from claith.integrations.codex import CodexAdapter


async def login() -> None:
    """Run an interactive Codex login to completion."""
    async with AgentRuntime(CodexAdapter()) as runtime:
        flow = await runtime.login()
        print(f"Open this URL in your browser:\n{flow.url}", flush=True)
        result = await flow.wait()

    if not result.success:
        message = result.error or "unknown error"
        raise RuntimeError(f"Login failed: {message}")

    print("Login successful.")


def main() -> None:
    """Run the login application."""
    asyncio.run(login())


if __name__ == "__main__":
    main()
