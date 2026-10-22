"""Autonomous agent workers for delivery workflow requests."""

from pathlib import Path
from uuid import NAMESPACE_URL, UUID, uuid5

from claith.agents import (
    AgentRunRequest,
    AgentRuntime,
    AgentSession,
    AgentTurnStatus,
    StartSessionRequest,
)
from claith.application.contracts import (
    EventEnvelope,
    ImplementationCompleted,
    ImplementationFailed,
    ImplementationOutput,
    ImplementationRequested,
    ReviewCompleted,
    ReviewFailed,
    ReviewOutput,
    ReviewRequested,
)
from claith.infrastructure.config import AgentProfile
from claith.infrastructure.messaging import EventQueue


def _result_id(request: EventEnvelope, outcome: str) -> UUID:
    return uuid5(NAMESPACE_URL, f"{request.event_id}:{outcome}")


class DeliveryWorkers:
    """Handle implementation and review requests with configured agents."""

    def __init__(
        self,
        runtime: AgentRuntime,
        queue: EventQueue,
        implementer: AgentProfile,
        reviewer: AgentProfile,
    ) -> None:
        self._runtime = runtime
        self._queue = queue
        self._implementer = implementer
        self._reviewer = reviewer

    async def handle_implementation(self, envelope: EventEnvelope) -> None:
        event = envelope.event
        if not isinstance(event, ImplementationRequested):
            raise TypeError("implementation handler received an incompatible event")

        thread_id = event.session_thread_id
        try:
            session = await self._session(
                self._implementer, event.working_directory, thread_id
            )
            result = await self._runtime.send(
                session,
                AgentRunRequest(
                    body=self._implementation_prompt(event),
                    model=self._implementer.model,
                    effort=self._implementer.reasoning_effort,
                    output_schema=ImplementationOutput.model_json_schema(),
                ),
            )
            if result.status is not AgentTurnStatus.COMPLETED or result.body is None:
                raise RuntimeError(
                    result.error or f"implementer turn ended as {result.status}"
                )
            output = ImplementationOutput.model_validate_json(result.body)
            response_event: ImplementationCompleted | ImplementationFailed = (
                ImplementationCompleted(
                    round=event.round,
                    output=output,
                    session_thread_id=session.thread_id,
                )
            )
            outcome = "completed"
        except Exception as error:  # noqa: BLE001 - worker boundary converts failures to events
            response_event = ImplementationFailed(
                round=event.round,
                error=str(error),
                session_thread_id=thread_id,
            )
            outcome = "failed"

        await self._queue.publish(
            EventEnvelope(
                event_id=_result_id(envelope, outcome),
                workflow_id=envelope.workflow_id,
                causation_id=envelope.event_id,
                event=response_event,
            )
        )

    async def handle_review(self, envelope: EventEnvelope) -> None:
        event = envelope.event
        if not isinstance(event, ReviewRequested):
            raise TypeError("review handler received an incompatible event")

        thread_id = event.session_thread_id
        try:
            session = await self._session(
                self._reviewer, event.working_directory, thread_id
            )
            result = await self._runtime.send(
                session,
                AgentRunRequest(
                    body=self._review_prompt(event),
                    model=self._reviewer.model,
                    effort=self._reviewer.reasoning_effort,
                    output_schema=ReviewOutput.model_json_schema(),
                ),
            )
            if result.status is not AgentTurnStatus.COMPLETED or result.body is None:
                raise RuntimeError(
                    result.error or f"reviewer turn ended as {result.status}"
                )
            output = ReviewOutput.model_validate_json(result.body)
            response_event: ReviewCompleted | ReviewFailed = ReviewCompleted(
                round=event.round,
                output=output,
                session_thread_id=session.thread_id,
            )
            outcome = "completed"
        except Exception as error:  # noqa: BLE001 - worker boundary converts failures to events
            response_event = ReviewFailed(
                round=event.round,
                error=str(error),
                session_thread_id=thread_id,
            )
            outcome = "failed"

        await self._queue.publish(
            EventEnvelope(
                event_id=_result_id(envelope, outcome),
                workflow_id=envelope.workflow_id,
                causation_id=envelope.event_id,
                event=response_event,
            )
        )

    async def _session(
        self, profile: AgentProfile, working_directory: str, thread_id: str | None
    ) -> AgentSession:
        if thread_id is not None:
            return AgentSession(provider=profile.provider, thread_id=thread_id)
        return await self._runtime.start_session(
            profile.provider,
            StartSessionRequest(
                working_directory=Path(working_directory),
                instructions=profile.instructions,
                model=profile.model,
                workspace_access=profile.workspace_access,
            ),
        )

    @staticmethod
    def _implementation_prompt(event: ImplementationRequested) -> str:
        prompt = [
            "Implement the following task autonomously in the provided workspace.",
            "Only change files needed for the task and run relevant verification.",
            f"Task:\n{event.task}",
        ]
        if event.previous_review is not None:
            prompt.extend(
                [
                    "The reviewer requested changes. Address every actionable finding:",
                    event.previous_review.model_dump_json(indent=2),
                ]
            )
        return "\n\n".join(prompt)

    @staticmethod
    def _review_prompt(event: ReviewRequested) -> str:
        return "\n\n".join(
            [
                "Review the implementation in the workspace against the task.",
                "Do not modify files. Approve only when the task is complete and correct.",
                f"Task:\n{event.task}",
                "Implementer report:",
                event.implementation.model_dump_json(indent=2),
            ]
        )
