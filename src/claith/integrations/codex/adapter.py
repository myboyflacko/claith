"""Async adapter for the Codex SDK."""

from dataclasses import dataclass
from typing import override

from openai_codex import (
    AsyncChatgptLoginHandle,
    AsyncCodex,
    AsyncThread,
    CodexConfig,
    Sandbox,
)
from openai_codex.types import CancelLoginAccountStatus
from openai_codex.types import ReasoningEffort as CodexReasoningEffort

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
    WorkspaceAccess,
)

_SANDBOX_BY_ACCESS = {
    WorkspaceAccess.READ_ONLY: Sandbox.read_only,
    WorkspaceAccess.WORKSPACE_WRITE: Sandbox.workspace_write,
    WorkspaceAccess.FULL_ACCESS: Sandbox.full_access,
}


@dataclass(slots=True)
class _CodexLoginFlow(LoginFlow):
    handle: AsyncChatgptLoginHandle

    @property
    def id(self) -> str:
        return self.handle.login_id

    @property
    def url(self) -> str:
        return self.handle.auth_url

    async def wait(self) -> LoginResult:
        result = await self.handle.wait()
        return LoginResult(success=result.success, error=result.error)

    async def cancel(self) -> bool:
        result = await self.handle.cancel()
        return result.status is CancelLoginAccountStatus.canceled


class CodexAdapter(AgentAdapter):
    """Own an async Codex client and expose Claith's required operations."""

    def __init__(self, config: CodexConfig | None = None) -> None:
        self._client = AsyncCodex(config=config)
        self._threads: dict[str, AsyncThread] = {}

    @property
    @override
    def provider(self) -> AgentProvider:
        return AgentProvider.CODEX

    @override
    async def start(self) -> None:
        await self._client.__aenter__()

    @override
    async def close(self) -> None:
        """Close the underlying Codex client."""
        await self._client.close()

    @override
    async def login(self) -> LoginFlow:
        """Start browser-based ChatGPT login."""
        handle = await self._client.login_chatgpt()
        return _CodexLoginFlow(handle)

    @override
    async def start_session(self, request: StartSessionRequest) -> AgentSession:
        """Start a Codex thread and expose it as an agent session."""
        thread = await self._client.thread_start(
            base_instructions=request.instructions,
            cwd=str(request.working_directory) if request.working_directory else None,
            model=request.model,
            sandbox=_SANDBOX_BY_ACCESS[request.workspace_access],
        )
        self._threads[thread.id] = thread
        return AgentSession(provider=self.provider, thread_id=thread.id)

    @override
    async def send(self, thread_id: str, request: AgentRunRequest) -> AgentTurnResult:
        """Send a message to a Codex thread and collect its final response."""
        thread = self._threads.get(thread_id)
        if thread is None:
            thread = await self._client.thread_resume(thread_id)
            self._threads[thread_id] = thread

        effort = CodexReasoningEffort(request.effort.value) if request.effort else None
        result = await thread.run(
            request.body,
            effort=effort,
            model=request.model,
            output_schema=request.output_schema,
        )
        return AgentTurnResult(
            id=result.id,
            status=AgentTurnStatus(result.status.value),
            body=result.final_response,
            error=result.error.message if result.error else None,
        )
