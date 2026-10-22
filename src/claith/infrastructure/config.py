"""Validated TOML configuration for Claith applications."""

import tomllib
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, model_validator

from claith.agents import AgentProvider, AgentReasoningEffort, WorkspaceAccess


class AgentProfile(BaseModel):
    """Configuration for one autonomous agent role."""

    model_config = ConfigDict(extra="forbid")

    provider: AgentProvider
    model: str = Field(min_length=1)
    reasoning_effort: AgentReasoningEffort = AgentReasoningEffort.MEDIUM
    instructions_file: Path
    workspace_access: WorkspaceAccess
    instructions: str = Field(default="", exclude=True)


class AgentProfiles(BaseModel):
    """Profiles required by the first delivery workflow."""

    model_config = ConfigDict(extra="forbid")

    implementer: AgentProfile
    reviewer: AgentProfile

    @model_validator(mode="after")
    def validate_role_permissions(self) -> "AgentProfiles":
        if self.implementer.workspace_access is WorkspaceAccess.READ_ONLY:
            raise ValueError("implementer must have write access")
        if self.reviewer.workspace_access is not WorkspaceAccess.READ_ONLY:
            raise ValueError("reviewer must use read_only workspace access")
        return self


class WorkflowConfig(BaseModel):
    """Control parameters for the implementation-review workflow."""

    model_config = ConfigDict(extra="forbid")

    max_review_rounds: int = Field(default=3, ge=1)


class ClaithConfig(BaseModel):
    """Root Claith configuration."""

    model_config = ConfigDict(extra="forbid")

    agents: AgentProfiles
    workflow: WorkflowConfig = Field(default_factory=WorkflowConfig)


def load_config(path: Path) -> ClaithConfig:
    """Load and validate a Claith TOML file and its prompt files."""
    config_path = path.expanduser().resolve()
    with config_path.open("rb") as file:
        config = ClaithConfig.model_validate(tomllib.load(file))

    base = config_path.parent
    profiles: dict[str, AgentProfile] = {}
    for role in ("implementer", "reviewer"):
        profile = getattr(config.agents, role)
        instructions_file = (base / profile.instructions_file).resolve()
        instructions = instructions_file.read_text(encoding="utf-8").strip()
        if not instructions:
            raise ValueError(f"{role} instructions file must not be empty")
        profiles[role] = profile.model_copy(
            update={
                "instructions_file": instructions_file,
                "instructions": instructions,
            }
        )

    return config.model_copy(update={"agents": AgentProfiles.model_validate(profiles)})
