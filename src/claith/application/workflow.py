"""LangGraph implementation-review workflow."""

from typing import Any, Literal, TypedDict, cast
from uuid import NAMESPACE_URL, UUID, uuid5

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from claith.application.contracts import (
    DeliveryCancelled,
    DeliveryCompleted,
    DeliveryFailed,
    DeliveryStatus,
    EventEnvelope,
    HumanDecision,
    HumanDecisionReceived,
    HumanInterrupt,
    ImplementationCompleted,
    ImplementationFailed,
    ImplementationOutput,
    ImplementationRequested,
    ReviewCompleted,
    ReviewFailed,
    ReviewOutput,
    ReviewRequested,
    ReviewVerdict,
)


class WorkflowState(TypedDict):
    """Checkpointed state for one implementation-review delivery."""

    workflow_id: str
    task: str
    working_directory: str
    status: str
    review_round: int
    max_review_rounds: int
    implementation_session_thread_id: str | None
    reviewer_session_thread_id: str | None
    implementation: dict[str, Any] | None
    review: dict[str, Any] | None
    pending_event: dict[str, Any] | None
    human_interrupt: dict[str, Any] | None
    terminal_event: dict[str, Any] | None
    error: str | None


def initial_state(
    workflow_id: UUID,
    task: str,
    working_directory: str,
    max_review_rounds: int,
) -> WorkflowState:
    """Build the complete initial state for a new delivery."""
    return {
        "workflow_id": str(workflow_id),
        "task": task,
        "working_directory": working_directory,
        "status": DeliveryStatus.RUNNING.value,
        "review_round": 1,
        "max_review_rounds": max_review_rounds,
        "implementation_session_thread_id": None,
        "reviewer_session_thread_id": None,
        "implementation": None,
        "review": None,
        "pending_event": None,
        "human_interrupt": None,
        "terminal_event": None,
        "error": None,
    }


def _event_id(state: WorkflowState, stage: str) -> UUID:
    return uuid5(
        NAMESPACE_URL,
        f"{state['workflow_id']}:{stage}:{state['review_round']}",
    )


def _envelope(state: WorkflowState, stage: str, event: Any) -> dict[str, Any]:
    return EventEnvelope(
        event_id=_event_id(state, stage),
        workflow_id=UUID(state["workflow_id"]),
        event=event,
    ).model_dump(mode="json")


def prepare_implementation(state: WorkflowState) -> dict[str, Any]:
    previous_review = (
        ReviewOutput.model_validate(state["review"]) if state["review"] else None
    )
    event = ImplementationRequested(
        round=state["review_round"],
        task=state["task"],
        working_directory=state["working_directory"],
        previous_review=previous_review,
        session_thread_id=state["implementation_session_thread_id"],
    )
    return {
        "status": DeliveryStatus.RUNNING.value,
        "pending_event": _envelope(state, "implementation", event),
        "human_interrupt": None,
    }


def _validated_result(state: WorkflowState, raw: object) -> EventEnvelope:
    envelope = EventEnvelope.model_validate(raw)
    pending = EventEnvelope.model_validate(state["pending_event"])
    if str(envelope.workflow_id) != state["workflow_id"]:
        raise ValueError("result workflow_id does not match the waiting workflow")
    if envelope.causation_id != pending.event_id:
        raise ValueError("result does not reference the pending request")
    return envelope


def await_implementation(
    state: WorkflowState,
) -> Command[Literal["prepare_review", "fail"]]:
    raw = interrupt(
        {
            "kind": "agent_result",
            "request": state["pending_event"],
        }
    )
    envelope = _validated_result(state, raw)
    event = envelope.event
    if isinstance(event, ImplementationFailed):
        return Command(
            update={
                "implementation_session_thread_id": event.session_thread_id,
                "pending_event": None,
                "error": event.error,
            },
            goto="fail",
        )
    if not isinstance(event, ImplementationCompleted):
        raise TypeError("workflow expected an implementation result")
    if event.round != state["review_round"]:
        raise ValueError("implementation result belongs to a different round")
    return Command(
        update={
            "implementation_session_thread_id": event.session_thread_id,
            "implementation": event.output.model_dump(mode="json"),
            "pending_event": None,
        },
        goto="prepare_review",
    )


def prepare_review(state: WorkflowState) -> dict[str, Any]:
    implementation = ImplementationOutput.model_validate(state["implementation"])
    event = ReviewRequested(
        round=state["review_round"],
        task=state["task"],
        working_directory=state["working_directory"],
        implementation=implementation,
        session_thread_id=state["reviewer_session_thread_id"],
    )
    return {"pending_event": _envelope(state, "review", event)}


def await_review(
    state: WorkflowState,
) -> Command[Literal["prepare_implementation", "complete", "human_review", "fail"]]:
    raw = interrupt(
        {
            "kind": "agent_result",
            "request": state["pending_event"],
        }
    )
    envelope = _validated_result(state, raw)
    event = envelope.event
    if isinstance(event, ReviewFailed):
        return Command(
            update={
                "reviewer_session_thread_id": event.session_thread_id,
                "pending_event": None,
                "error": event.error,
            },
            goto="fail",
        )
    if not isinstance(event, ReviewCompleted):
        raise TypeError("workflow expected a review result")
    if event.round != state["review_round"]:
        raise ValueError("review result belongs to a different round")

    update: dict[str, Any] = {
        "reviewer_session_thread_id": event.session_thread_id,
        "review": event.output.model_dump(mode="json"),
        "pending_event": None,
    }
    if event.output.verdict is ReviewVerdict.APPROVED:
        return Command(update=update, goto="complete")
    if state["review_round"] >= state["max_review_rounds"]:
        human_request = HumanInterrupt(
            reason="maximum review rounds reached",
            review_round=state["review_round"],
            last_review=event.output,
        )
        update.update(
            {
                "status": DeliveryStatus.INTERRUPTED.value,
                "human_interrupt": human_request.model_dump(mode="json"),
            }
        )
        return Command(update=update, goto="human_review")

    update["review_round"] = state["review_round"] + 1
    return Command(update=update, goto="prepare_implementation")


def human_review(
    state: WorkflowState,
) -> Command[Literal["prepare_implementation", "cancel"]]:
    raw = interrupt(
        {
            "kind": "human_decision",
            "request": state["human_interrupt"],
        }
    )
    envelope = EventEnvelope.model_validate(raw)
    if str(envelope.workflow_id) != state["workflow_id"]:
        raise ValueError("human decision workflow_id does not match")
    event = envelope.event
    if not isinstance(event, HumanDecisionReceived):
        raise TypeError("workflow expected a human decision")
    if event.decision is HumanDecision.CANCEL:
        return Command(goto="cancel")
    return Command(
        update={
            "status": DeliveryStatus.RUNNING.value,
            "review_round": state["review_round"] + 1,
            "max_review_rounds": state["max_review_rounds"] + 1,
            "human_interrupt": None,
        },
        goto="prepare_implementation",
    )


def complete(state: WorkflowState) -> dict[str, Any]:
    review = ReviewOutput.model_validate(state["review"])
    terminal = DeliveryCompleted(review=review)
    return {
        "status": DeliveryStatus.COMPLETED.value,
        "terminal_event": _envelope(state, "completed", terminal),
    }


def fail(state: WorkflowState) -> dict[str, Any]:
    error = state["error"] or "delivery failed"
    return {
        "status": DeliveryStatus.FAILED.value,
        "terminal_event": _envelope(state, "failed", DeliveryFailed(error=error)),
    }


def cancel(state: WorkflowState) -> dict[str, Any]:
    return {
        "status": DeliveryStatus.CANCELLED.value,
        "terminal_event": _envelope(state, "cancelled", DeliveryCancelled()),
    }


def build_workflow(checkpointer: BaseCheckpointSaver[Any]) -> Any:
    """Compile the implementation-review graph with injected persistence."""
    builder = StateGraph(WorkflowState)
    builder.add_node("prepare_implementation", prepare_implementation)
    builder.add_node("await_implementation", await_implementation)
    builder.add_node("prepare_review", prepare_review)
    builder.add_node("await_review", await_review)
    builder.add_node("human_review", human_review)
    builder.add_node("complete", complete)
    builder.add_node("fail", fail)
    builder.add_node("cancel", cancel)

    builder.add_edge(START, "prepare_implementation")
    builder.add_edge("prepare_implementation", "await_implementation")
    builder.add_edge("prepare_review", "await_review")
    builder.add_edge("complete", END)
    builder.add_edge("fail", END)
    builder.add_edge("cancel", END)
    return cast(Any, builder.compile(checkpointer=checkpointer))
