"""Typed contracts exchanged by Claith workflows and workers."""

from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ReviewVerdict(StrEnum):
    """Possible reviewer decisions."""

    APPROVED = "approved"
    CHANGES_REQUESTED = "changes_requested"


class FindingSeverity(StrEnum):
    """Severity assigned to a review finding."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class HumanDecision(StrEnum):
    """Decisions accepted by a paused delivery workflow."""

    CONTINUE = "continue"
    CANCEL = "cancel"


class DeliveryStatus(StrEnum):
    """Externally observable delivery states."""

    RUNNING = "running"
    INTERRUPTED = "interrupted"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ReviewFinding(BaseModel):
    """One actionable problem found by the reviewer."""

    model_config = ConfigDict(extra="forbid")

    severity: FindingSeverity
    message: str = Field(min_length=1)
    file: str | None
    line: int | None = Field(ge=1)


class ImplementationOutput(BaseModel):
    """Structured result returned by an implementer agent."""

    model_config = ConfigDict(extra="forbid")

    summary: str = Field(min_length=1)
    changed_files: list[str]
    verification: list[str]


class ReviewOutput(BaseModel):
    """Structured result returned by a reviewer agent."""

    model_config = ConfigDict(extra="forbid")

    verdict: ReviewVerdict
    summary: str = Field(min_length=1)
    findings: list[ReviewFinding]


class DeliveryRequest(BaseModel):
    """Input required to start an implementation-review workflow."""

    model_config = ConfigDict(extra="forbid")

    task: str = Field(min_length=1)
    working_directory: Path

    @field_validator("working_directory")
    @classmethod
    def require_directory(cls, value: Path) -> Path:
        path = value.expanduser().resolve()
        if not path.is_dir():
            raise ValueError("working_directory must be an existing directory")
        return path


class DeliveryRequested(BaseModel):
    type: Literal["delivery_requested"] = "delivery_requested"
    task: str
    working_directory: str


class ImplementationRequested(BaseModel):
    type: Literal["implementation_requested"] = "implementation_requested"
    round: int = Field(ge=1)
    task: str
    working_directory: str
    previous_review: ReviewOutput | None = None
    session_thread_id: str | None = None


class ImplementationCompleted(BaseModel):
    type: Literal["implementation_completed"] = "implementation_completed"
    round: int = Field(ge=1)
    output: ImplementationOutput
    session_thread_id: str


class ImplementationFailed(BaseModel):
    type: Literal["implementation_failed"] = "implementation_failed"
    round: int = Field(ge=1)
    error: str = Field(min_length=1)
    session_thread_id: str | None = None


class ReviewRequested(BaseModel):
    type: Literal["review_requested"] = "review_requested"
    round: int = Field(ge=1)
    task: str
    working_directory: str
    implementation: ImplementationOutput
    session_thread_id: str | None = None


class ReviewCompleted(BaseModel):
    type: Literal["review_completed"] = "review_completed"
    round: int = Field(ge=1)
    output: ReviewOutput
    session_thread_id: str


class ReviewFailed(BaseModel):
    type: Literal["review_failed"] = "review_failed"
    round: int = Field(ge=1)
    error: str = Field(min_length=1)
    session_thread_id: str | None = None


class HumanDecisionReceived(BaseModel):
    type: Literal["human_decision_received"] = "human_decision_received"
    decision: HumanDecision


class DeliveryCompleted(BaseModel):
    type: Literal["delivery_completed"] = "delivery_completed"
    review: ReviewOutput


class DeliveryFailed(BaseModel):
    type: Literal["delivery_failed"] = "delivery_failed"
    error: str = Field(min_length=1)


class DeliveryCancelled(BaseModel):
    type: Literal["delivery_cancelled"] = "delivery_cancelled"
    reason: str = "cancelled by human"


DeliveryEvent = Annotated[
    DeliveryRequested
    | ImplementationRequested
    | ImplementationCompleted
    | ImplementationFailed
    | ReviewRequested
    | ReviewCompleted
    | ReviewFailed
    | HumanDecisionReceived
    | DeliveryCompleted
    | DeliveryFailed
    | DeliveryCancelled,
    Field(discriminator="type"),
]


class EventEnvelope(BaseModel):
    """Transport-neutral envelope for every workflow event."""

    model_config = ConfigDict(extra="forbid")

    event_id: UUID = Field(default_factory=uuid4)
    workflow_id: UUID
    causation_id: UUID | None = None
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    event: DeliveryEvent


class HumanInterrupt(BaseModel):
    """Human action requested by a paused workflow."""

    reason: str
    review_round: int
    last_review: ReviewOutput
    allowed_decisions: tuple[HumanDecision, ...] = (
        HumanDecision.CONTINUE,
        HumanDecision.CANCEL,
    )


class DeliveryStateSnapshot(BaseModel):
    """Read-only projection of current workflow state."""

    workflow_id: UUID
    status: DeliveryStatus
    review_round: int
    max_review_rounds: int
    implementation: ImplementationOutput | None = None
    review: ReviewOutput | None = None
    interrupt: HumanInterrupt | None = None
    error: str | None = None


class DeliveryResult(DeliveryStateSnapshot):
    """Result returned when application execution yields control."""
