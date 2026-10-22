"""Provider-independent agent runtime."""

from types import TracebackType
from typing import Self

from claith.agents.adapter import AgentAdapter, LoginFlow
from claith.agents.models import AgentSession, AgentTurnResult, StartSessionRequest


class AgentRuntime:
    """Expose one agent SDK adapter through Claith's common interface."""

    def __init__(self, adapter: AgentAdapter) -> None:
        if not isinstance(adapter, AgentAdapter):
            raise TypeError("adapter must implement AgentAdapter")
        self._adapter = adapter

    async def __aenter__(self) -> Self:
        await self._adapter.start()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.close()

    async def login(self) -> LoginFlow:
        return await self._adapter.login()

    async def start_session(self, request: StartSessionRequest) -> AgentSession:
        return await self._adapter.start_session(request)

    async def send_message(self, session: AgentSession, body: str) -> AgentTurnResult:
        return await self._adapter.send_message(session, body)

    async def close(self) -> None:
        await self._adapter.close()
