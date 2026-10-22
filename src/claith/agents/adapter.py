"""Abstract interface implemented by agent SDK adapters."""

from abc import ABC, abstractmethod

from claith.agents.models import AgentSession, LoginResult, StartSessionRequest


class LoginFlow(ABC):
    """An interactive provider login that can be completed or canceled."""

    @property
    @abstractmethod
    def id(self) -> str: ...

    @property
    @abstractmethod
    def url(self) -> str: ...

    @abstractmethod
    async def wait(self) -> LoginResult: ...

    @abstractmethod
    async def cancel(self) -> bool: ...


class AgentAdapter(ABC):
    """Provider SDK operations required by the agent runtime."""

    @abstractmethod
    async def start(self) -> None: ...

    @abstractmethod
    async def login(self) -> LoginFlow: ...

    @abstractmethod
    async def start_session(self, request: StartSessionRequest) -> AgentSession: ...

    @abstractmethod
    async def close(self) -> None: ...
