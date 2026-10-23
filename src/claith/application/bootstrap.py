"""Bootstrap and public facade for the first Claith delivery workflow."""

from pathlib import Path
from types import TracebackType
from typing import Any, Self
from uuid import UUID, uuid4

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from claith.agents import AgentProvider, AgentRuntime
from claith.application.contracts import (
    DeliveryRequest,
    DeliveryResult,
    DeliveryStateSnapshot,
    DeliveryStatus,
    EventEnvelope,
    HumanDecision,
    HumanDecisionReceived,
    HumanInterrupt,
    ImplementationOutput,
    ReviewOutput,
)
from claith.application.workers import DeliveryWorkers
from claith.application.workflow import WorkflowState, build_workflow, initial_state
from claith.infrastructure.config import ClaithConfig, load_config
from claith.infrastructure.messaging import (
    EventDispatcher,
    EventQueue,
    InMemoryEventQueue,
)
from claith.integrations.codex import CodexAdapter


class ClaithApplication:
    """Run and inspect implementation-review deliveries in one process."""

    def __init__(
        self,
        config: ClaithConfig,
        runtime: AgentRuntime,
        queue: EventQueue,
        dispatcher: EventDispatcher,
        graph: Any,
    ) -> None:
        self._config = config
        self._runtime = runtime
        self._queue = queue
        self._dispatcher = dispatcher
        self._graph = graph

    async def __aenter__(self) -> Self:
        await self._runtime.__aenter__()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self._runtime.__aexit__(exc_type, exc_value, traceback)

    async def run(self, request: DeliveryRequest) -> DeliveryResult:
        """Start a delivery and run until it terminates or needs a human."""
        workflow_id = uuid4()
        state = initial_state(
            workflow_id=workflow_id,
            task=request.task,
            working_directory=str(request.working_directory),
            max_review_rounds=self._config.workflow.max_review_rounds,
        )
        return await self._drive(workflow_id, state)

    async def resume(
        self, workflow_id: UUID, decision: HumanDecision
    ) -> DeliveryResult:
        """Resume a human-interrupted workflow with continue or cancel."""
        snapshot = await self.get_state(workflow_id)
        if snapshot.status is not DeliveryStatus.INTERRUPTED:
            raise ValueError("workflow is not waiting for a human decision")
        envelope = EventEnvelope(
            workflow_id=workflow_id,
            event=HumanDecisionReceived(decision=decision),
        )
        return await self._drive(
            workflow_id,
            Command(resume=envelope.model_dump(mode="json")),
        )

    async def get_state(self, workflow_id: UUID) -> DeliveryStateSnapshot:
        """Return the current checkpointed workflow projection."""
        snapshot = await self._graph.aget_state(self._graph_config(workflow_id))
        if not snapshot.values:
            raise KeyError(f"unknown workflow: {workflow_id}")
        return self._snapshot(snapshot.values)

    async def _drive(
        self, workflow_id: UUID, graph_input: WorkflowState | Command[Any]
    ) -> DeliveryResult:
        config = self._graph_config(workflow_id)
        current_input: WorkflowState | Command[Any] = graph_input
        while True:
            values = await self._graph.ainvoke(current_input, config)
            status = DeliveryStatus(values["status"])
            if status in {
                DeliveryStatus.COMPLETED,
                DeliveryStatus.FAILED,
                DeliveryStatus.CANCELLED,
            }:
                return DeliveryResult.model_validate(self._snapshot_data(values))

            interrupts = values.get("__interrupt__", ())
            if not interrupts:
                raise RuntimeError(
                    "workflow yielded without an interrupt or terminal state"
                )
            interrupt_value = interrupts[0].value
            if interrupt_value.get("kind") == "human_decision":
                return DeliveryResult.model_validate(self._snapshot_data(values))
            if interrupt_value.get("kind") != "agent_result":
                raise RuntimeError("workflow produced an unknown interrupt")

            request_event = EventEnvelope.model_validate(interrupt_value["request"])
            await self._queue.publish(request_event)
            result_event = await self._run_until_result(request_event)
            current_input = Command(resume=result_event.model_dump(mode="json"))

    async def _run_until_result(self, request: EventEnvelope) -> EventEnvelope:
        while True:
            event = await self._queue.get()
            try:
                if event.causation_id == request.event_id:
                    return event
                await self._dispatcher.dispatch(event)
            finally:
                self._queue.task_done()

    @staticmethod
    def _graph_config(workflow_id: UUID) -> dict[str, dict[str, str]]:
        return {"configurable": {"thread_id": str(workflow_id)}}

    @staticmethod
    def _snapshot_data(values: dict[str, Any]) -> dict[str, Any]:
        return {
            "workflow_id": values["workflow_id"],
            "status": values["status"],
            "review_round": values["review_round"],
            "max_review_rounds": values["max_review_rounds"],
            "implementation": values.get("implementation"),
            "review": values.get("review"),
            "interrupt": values.get("human_interrupt"),
            "error": values.get("error"),
        }

    @classmethod
    def _snapshot(cls, values: dict[str, Any]) -> DeliveryStateSnapshot:
        data = cls._snapshot_data(values)
        if data["implementation"] is not None:
            data["implementation"] = ImplementationOutput.model_validate(
                data["implementation"]
            )
        if data["review"] is not None:
            data["review"] = ReviewOutput.model_validate(data["review"])
        if data["interrupt"] is not None:
            data["interrupt"] = HumanInterrupt.model_validate(data["interrupt"])
        return DeliveryStateSnapshot.model_validate(data)


def bootstrap(
    config_path: Path,
    *,
    runtime: AgentRuntime | None = None,
    queue: EventQueue | None = None,
    checkpointer: BaseCheckpointSaver[Any] | None = None,
) -> ClaithApplication:
    """Build an in-process Claith application from a TOML configuration."""
    config = load_config(config_path)
    providers = {
        config.agents.implementer.provider,
        config.agents.reviewer.provider,
    }
    unsupported = providers - {AgentProvider.CODEX}
    if unsupported:
        names = ", ".join(sorted(provider.value for provider in unsupported))
        raise ValueError(f"unsupported providers: {names}")

    agent_runtime = runtime or AgentRuntime([CodexAdapter()])
    event_queue = queue or InMemoryEventQueue()
    event_dispatcher = EventDispatcher()
    workers = DeliveryWorkers(
        runtime=agent_runtime,
        queue=event_queue,
        implementer=config.agents.implementer,
        reviewer=config.agents.reviewer,
    )
    event_dispatcher.register("implementation_requested", workers.handle_implementation)
    event_dispatcher.register("review_requested", workers.handle_review)
    graph = build_workflow(checkpointer or InMemorySaver())
    return ClaithApplication(
        config=config,
        runtime=agent_runtime,
        queue=event_queue,
        dispatcher=event_dispatcher,
        graph=graph,
    )
