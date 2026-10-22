"""Interfaces implemented by agent runtime adapters."""

from abc import abstractmethod
from types import TracebackType
from typing import Protocol, Self, runtime_checkable

from claith.agents.models import LoginResult, StartSessionRequest


@runtime_checkable
class LoginFlow(Protocol):
    """An interactive provider login that can be completed or canceled."""

    @property
    def id(self) -> str: ...

    @property
    def url(self) -> str: ...

    async def wait(self) -> LoginResult: ...

    async def cancel(self) -> bool: ...


@runtime_checkable
class AgentSession(Protocol):
    """A provider-independent handle to an agent conversation."""

    @property
    def id(self) -> str: ...


@runtime_checkable
class AgentRuntime(Protocol):
    """Common interface implemented by every agent SDK adapter."""

    @abstractmethod
    async def __aenter__(self) -> Self: ...

    @abstractmethod
    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None: ...

    @abstractmethod
    async def login(self) -> LoginFlow: ...

    @abstractmethod
    async def start_session(self, request: StartSessionRequest) -> AgentSession: ...

    @abstractmethod
    async def close(self) -> None: ...
