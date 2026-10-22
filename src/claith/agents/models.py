"""Provider-independent values used by agent runtimes."""

from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path


class WorkspaceAccess(StrEnum):
    """Filesystem access granted to an agent session."""

    READ_ONLY = "read_only"
    WORKSPACE_WRITE = "workspace_write"
    FULL_ACCESS = "full_access"


class AgentTurnStatus(StrEnum):
    """Provider-independent state of a completed agent turn."""

    COMPLETED = "completed"
    INTERRUPTED = "interrupted"
    FAILED = "failed"


@dataclass(frozen=True, slots=True, kw_only=True)
class StartSessionRequest:
    """Configuration shared by all agent runtime sessions."""

    working_directory: Path | None = None
    instructions: str | None = None
    model: str | None = None
    workspace_access: WorkspaceAccess = WorkspaceAccess.WORKSPACE_WRITE


@dataclass(frozen=True, slots=True)
class LoginResult:
    """Provider-independent result of an interactive login attempt."""

    success: bool
    error: str | None = None


@dataclass(frozen=True, slots=True)
class AgentSession:
    """Provider-independent reference to an agent conversation."""

    id: str


@dataclass(frozen=True, slots=True)
class AgentTurnResult:
    """Provider-independent result of sending a message to an agent."""

    id: str
    status: AgentTurnStatus
    body: str | None = None
    error: str | None = None
