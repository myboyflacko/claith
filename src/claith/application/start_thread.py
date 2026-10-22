"""Send stdin to a new agent thread and write its result as JSON."""

import asyncio
import json
import sys
from pathlib import Path
from typing import TypedDict

from claith.agents import (
    AgentProvider,
    AgentRunRequest,
    AgentRuntime,
    AgentTurnResult,
    StartSessionRequest,
)
from claith.integrations.codex import CodexAdapter


class ThreadOutput(TypedDict):
    """JSON response emitted by the thread-start application."""

    thread_id: str | None
    turn_id: str | None
    status: str
    body: str | None
    error: str | None


def _output(session_id: str, result: AgentTurnResult) -> ThreadOutput:
    return {
        "thread_id": session_id,
        "turn_id": result.id,
        "status": result.status.value,
        "body": result.body,
        "error": result.error,
    }


async def start_thread(body: str) -> ThreadOutput:
    """Send a message in a new thread and return its collected response."""
    async with AgentRuntime(CodexAdapter()) as runtime:
        session = await runtime.start_session(
            AgentProvider.CODEX, StartSessionRequest(working_directory=Path.cwd())
        )
        result = await runtime.send(session, AgentRunRequest(body=body))

    return _output(session.thread_id, result)


def _write_json(output: ThreadOutput) -> None:
    json.dump(output, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


def _read_body() -> str:
    if sys.stdin.isatty():
        return sys.stdin.readline()
    return sys.stdin.read()


def main() -> None:
    """Read a message from stdin and emit exactly one JSON response."""
    body = _read_body()
    if not body.strip():
        _write_json(
            {
                "thread_id": None,
                "turn_id": None,
                "status": "failed",
                "body": None,
                "error": "stdin body must not be empty",
            }
        )
        raise SystemExit(2)

    try:
        output = asyncio.run(start_thread(body))
    except Exception as error:  # noqa: BLE001 - process boundary returns JSON errors
        _write_json(
            {
                "thread_id": None,
                "turn_id": None,
                "status": "failed",
                "body": None,
                "error": str(error),
            }
        )
        raise SystemExit(1) from None

    _write_json(output)


if __name__ == "__main__":
    main()
