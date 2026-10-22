"""Tests for workflow contracts."""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from claith.application.contracts import (
    EventEnvelope,
    ImplementationCompleted,
    ImplementationOutput,
    ReviewOutput,
)


def test_event_envelope_round_trips_with_discriminated_payload() -> None:
    envelope = EventEnvelope(
        workflow_id=uuid4(),
        event=ImplementationCompleted(
            round=1,
            output=ImplementationOutput(
                summary="Implemented",
                changed_files=["src/example.py"],
                verification=["pytest passed"],
            ),
            session_thread_id="thread-1",
        ),
    )

    restored = EventEnvelope.model_validate_json(envelope.model_dump_json())

    assert isinstance(restored.event, ImplementationCompleted)
    assert restored.event.output.summary == "Implemented"


def test_review_output_rejects_unknown_verdict() -> None:
    with pytest.raises(ValidationError):
        ReviewOutput.model_validate(
            {"verdict": "maybe", "summary": "Unsure", "findings": []}
        )


def test_output_contracts_forbid_unexpected_fields() -> None:
    with pytest.raises(ValidationError):
        ImplementationOutput.model_validate(
            {"summary": "Done", "changed_files": [], "verification": [], "extra": True}
        )
