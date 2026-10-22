"""Focused tests for workflow event correlation."""

import asyncio
from uuid import uuid4

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from claith.application.contracts import (
    EventEnvelope,
    ImplementationCompleted,
    ImplementationOutput,
)
from claith.application.workflow import build_workflow, initial_state


def test_mismatched_workflow_result_cannot_advance_state() -> None:
    async def scenario() -> None:
        workflow_id = uuid4()
        graph = build_workflow(InMemorySaver())
        config = {"configurable": {"thread_id": str(workflow_id)}}
        result = await graph.ainvoke(
            initial_state(workflow_id, "task", "/tmp", 3), config
        )
        request = EventEnvelope.model_validate(
            result["__interrupt__"][0].value["request"]
        )
        mismatched = EventEnvelope(
            workflow_id=uuid4(),
            causation_id=request.event_id,
            event=ImplementationCompleted(
                round=1,
                output=ImplementationOutput(summary="done"),
                session_thread_id="implementer-1",
            ),
        )

        with pytest.raises(ValueError, match="workflow_id does not match"):
            await graph.ainvoke(
                Command(resume=mismatched.model_dump(mode="json")), config
            )

    asyncio.run(scenario())
