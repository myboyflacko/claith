"""Asynchronous event transport and dispatch interfaces."""

import asyncio
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable

from claith.application.contracts import EventEnvelope

EventHandler = Callable[[EventEnvelope], Awaitable[None]]


class EventQueue(ABC):
    """Transport-neutral asynchronous workflow event queue."""

    @abstractmethod
    async def publish(self, event: EventEnvelope) -> bool:
        """Queue an event, returning false when its ID was already accepted."""

    @abstractmethod
    async def get(self) -> EventEnvelope:
        """Wait for and return the next event."""

    @abstractmethod
    def task_done(self) -> None:
        """Mark the most recently consumed event as processed."""


class InMemoryEventQueue(EventQueue):
    """FIFO event queue with process-lifetime duplicate suppression."""

    def __init__(self) -> None:
        self._queue: asyncio.Queue[EventEnvelope] = asyncio.Queue()
        self._accepted_ids: set[str] = set()
        self._lock = asyncio.Lock()

    async def publish(self, event: EventEnvelope) -> bool:
        event_id = str(event.event_id)
        async with self._lock:
            if event_id in self._accepted_ids:
                return False
            self._accepted_ids.add(event_id)
            await self._queue.put(event)
        return True

    async def get(self) -> EventEnvelope:
        return await self._queue.get()

    def task_done(self) -> None:
        self._queue.task_done()


class EventDispatcher:
    """Dispatch events to exactly one handler selected by event type."""

    def __init__(self) -> None:
        self._handlers: dict[str, EventHandler] = {}

    def register(self, event_type: str, handler: EventHandler) -> None:
        if event_type in self._handlers:
            raise ValueError(f"handler already registered for: {event_type}")
        self._handlers[event_type] = handler

    async def dispatch(self, envelope: EventEnvelope) -> None:
        event_type = envelope.event.type
        try:
            handler = self._handlers[event_type]
        except KeyError:
            raise ValueError(f"no handler registered for: {event_type}") from None
        await handler(envelope)
