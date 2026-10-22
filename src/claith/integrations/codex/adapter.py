"""Async adapter for the Codex SDK."""

from types import TracebackType
from typing import Self

from openai_codex import (
    ApprovalMode,
    AsyncChatgptLoginHandle,
    AsyncCodex,
    AsyncThread,
    CodexConfig,
    Sandbox,
)
from openai_codex.types import JsonObject, Personality


class CodexAdapter:
    """Own an async Codex client and expose Claith's required operations."""

    def __init__(self, config: CodexConfig | None = None) -> None:
        self._client = AsyncCodex(config=config)

    async def __aenter__(self) -> Self:
        await self._client.__aenter__()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self._client.__aexit__(exc_type, exc_value, traceback)

    async def close(self) -> None:
        """Close the underlying Codex client."""
        await self._client.close()

    async def login(self) -> AsyncChatgptLoginHandle:
        """Start browser-based ChatGPT login."""
        return await self._client.login_chatgpt()

    async def thread_start(
        self,
        *,
        approval_mode: ApprovalMode = ApprovalMode.auto_review,
        base_instructions: str | None = None,
        config: JsonObject | None = None,
        cwd: str | None = None,
        developer_instructions: str | None = None,
        ephemeral: bool | None = None,
        model: str | None = None,
        model_provider: str | None = None,
        personality: Personality | None = None,
        sandbox: Sandbox | None = None,
    ) -> AsyncThread:
        """Start a Codex thread with the SDK's thread options."""
        return await self._client.thread_start(
            approval_mode=approval_mode,
            base_instructions=base_instructions,
            config=config,
            cwd=cwd,
            developer_instructions=developer_instructions,
            ephemeral=ephemeral,
            model=model,
            model_provider=model_provider,
            personality=personality,
            sandbox=sandbox,
        )
