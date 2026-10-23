"""Tests for provider-addressed agent runtime behavior."""

import asyncio

import pytest

from claith.agents import (
    AgentProvider,
    AgentRunRequest,
    AgentRuntime,
    StartSessionRequest,
)
from tests.fakes import FakeAdapter


def test_runtime_routes_sessions_to_provider_adapter() -> None:
    async def scenario() -> None:
        adapter = FakeAdapter({"None": [{"ok": True}]})
        async with AgentRuntime(adapter) as runtime:
            session = await runtime.start_session(
                AgentProvider.CODEX, StartSessionRequest()
            )
            await runtime.send(session, AgentRunRequest(body="hello"))

        assert adapter.started
        assert adapter.closed
        assert adapter.sent[0][0] == session.thread_id

    asyncio.run(scenario())


def test_runtime_rejects_unregistered_provider() -> None:
    runtime = AgentRuntime(FakeAdapter())

    async def scenario() -> None:
        with pytest.raises(ValueError, match="no adapter registered"):
            await runtime.start_session(
                "claude",  # type: ignore[arg-type]
                StartSessionRequest(),
            )

    asyncio.run(scenario())
