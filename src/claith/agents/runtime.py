"""Provider-independent agent runtime."""

from collections.abc import Iterable
from types import TracebackType
from typing import Self

from claith.agents.adapter import AgentAdapter, LoginFlow
from claith.agents.models import (
    AgentProvider,
    AgentRunRequest,
    AgentSession,
    AgentTurnResult,
    StartSessionRequest,
)


class AgentRuntime:
    """Route provider-independent operations to registered SDK adapters."""

    def __init__(self, adapters: AgentAdapter | Iterable[AgentAdapter]) -> None:
        candidates = (
            [adapters] if isinstance(adapters, AgentAdapter) else list(adapters)
        )
        if not candidates:
            raise ValueError("at least one agent adapter is required")

        self._adapters: dict[AgentProvider, AgentAdapter] = {}
        for adapter in candidates:
            if not isinstance(adapter, AgentAdapter):
                raise TypeError("every adapter must implement AgentAdapter")
            if adapter.provider in self._adapters:
                raise ValueError(f"duplicate adapter for provider: {adapter.provider}")
            self._adapters[adapter.provider] = adapter

    async def __aenter__(self) -> Self:
        started: list[AgentAdapter] = []
        try:
            for adapter in self._adapters.values():
                await adapter.start()
                started.append(adapter)
        except Exception:
            for adapter in reversed(started):
                await adapter.close()
            raise
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.close()

    def _adapter_for(self, provider: AgentProvider) -> AgentAdapter:
        try:
            return self._adapters[provider]
        except KeyError:
            raise ValueError(
                f"no adapter registered for provider: {provider}"
            ) from None

    def _only_provider(self) -> AgentProvider:
        if len(self._adapters) != 1:
            raise ValueError(
                "provider is required when multiple adapters are registered"
            )
        return next(iter(self._adapters))

    async def login(self, provider: AgentProvider | None = None) -> LoginFlow:
        return await self._adapter_for(provider or self._only_provider()).login()

    async def start_session(
        self, provider: AgentProvider, request: StartSessionRequest
    ) -> AgentSession:
        return await self._adapter_for(provider).start_session(request)

    async def send(
        self, session: AgentSession, request: AgentRunRequest
    ) -> AgentTurnResult:
        return await self._adapter_for(session.provider).send(
            session.thread_id, request
        )

    async def close(self) -> None:
        for adapter in reversed(tuple(self._adapters.values())):
            await adapter.close()
