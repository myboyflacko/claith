"""Test doubles shared by Claith tests."""

import json
from collections import defaultdict, deque
from collections.abc import Iterable

from claith.agents import (
    AgentAdapter,
    AgentProvider,
    AgentRunRequest,
    AgentSession,
    AgentTurnResult,
    AgentTurnStatus,
    LoginFlow,
    LoginResult,
    StartSessionRequest,
)


class FakeLoginFlow(LoginFlow):
    @property
    def id(self) -> str:
        return "login-1"

    @property
    def url(self) -> str:
        return "https://example.test/login"

    async def wait(self) -> LoginResult:
        return LoginResult(success=True)

    async def cancel(self) -> bool:
        return True


class FakeAdapter(AgentAdapter):
    """Adapter returning queued JSON objects by output-schema title."""

    def __init__(
        self,
        responses: dict[str, Iterable[dict[str, object] | str]] | None = None,
        provider: AgentProvider = AgentProvider.CODEX,
    ) -> None:
        self._provider = provider
        self.responses = {
            title: deque(values) for title, values in (responses or {}).items()
        }
        self.started = False
        self.closed = False
        self.sessions_started: defaultdict[str, int] = defaultdict(int)
        self.sent: list[tuple[str, AgentRunRequest]] = []

    @property
    def provider(self) -> AgentProvider:
        return self._provider

    async def start(self) -> None:
        self.started = True

    async def login(self) -> LoginFlow:
        return FakeLoginFlow()

    async def start_session(self, request: StartSessionRequest) -> AgentSession:
        role = (
            "reviewer"
            if request.workspace_access.value == "read_only"
            else "implementer"
        )
        self.sessions_started[role] += 1
        return AgentSession(
            provider=self.provider,
            thread_id=f"{role}-{self.sessions_started[role]}",
        )

    async def send(self, thread_id: str, request: AgentRunRequest) -> AgentTurnResult:
        self.sent.append((thread_id, request))
        title = str((request.output_schema or {}).get("title"))
        response = self.responses[title].popleft()
        body = response if isinstance(response, str) else json.dumps(response)
        return AgentTurnResult(
            id=f"turn-{len(self.sent)}",
            status=AgentTurnStatus.COMPLETED,
            body=body,
        )

    async def close(self) -> None:
        self.closed = True
