"""Tests for in-memory event transport."""

import asyncio
from uuid import uuid4

import pytest

from claith.application.contracts import DeliveryRequested, EventEnvelope
from claith.infrastructure.messaging import EventDispatcher, InMemoryEventQueue


def test_queue_is_fifo_and_suppresses_duplicate_ids() -> None:
    async def scenario() -> None:
        queue = InMemoryEventQueue()
        workflow_id = uuid4()
        first = EventEnvelope(
            workflow_id=workflow_id,
            event=DeliveryRequested(task="one", working_directory="/tmp"),
        )
        second = EventEnvelope(
            workflow_id=workflow_id,
            event=DeliveryRequested(task="two", working_directory="/tmp"),
        )

        assert await queue.publish(first)
        assert not await queue.publish(first)
        assert await queue.publish(second)
        assert (await queue.get()).event_id == first.event_id
        queue.task_done()
        assert (await queue.get()).event_id == second.event_id
        queue.task_done()

    asyncio.run(scenario())


def test_dispatcher_routes_and_surfaces_errors() -> None:
    async def scenario() -> None:
        dispatcher = EventDispatcher()
        envelope = EventEnvelope(
            workflow_id=uuid4(),
            event=DeliveryRequested(task="task", working_directory="/tmp"),
        )
        handled: list[EventEnvelope] = []

        async def handler(event: EventEnvelope) -> None:
            handled.append(event)

        dispatcher.register("delivery_requested", handler)
        await dispatcher.dispatch(envelope)
        assert handled == [envelope]

        with pytest.raises(ValueError, match="already registered"):
            dispatcher.register("delivery_requested", handler)

    asyncio.run(scenario())
