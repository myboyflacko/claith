"""End-to-end tests for the in-process delivery application."""

import asyncio
from pathlib import Path

from claith.agents import AgentRuntime
from claith.application import (
    DeliveryRequest,
    DeliveryStatus,
    HumanDecision,
    bootstrap,
)
from tests.fakes import FakeAdapter


def _config(tmp_path: Path) -> Path:
    prompts = tmp_path / "prompts"
    prompts.mkdir()
    (prompts / "implementer.md").write_text("Implement safely.", encoding="utf-8")
    (prompts / "reviewer.md").write_text("Review strictly.", encoding="utf-8")
    config = tmp_path / "claith.toml"
    config.write_text(
        """
[agents.implementer]
provider = "codex"
model = "implementation-model"
reasoning_effort = "high"
instructions_file = "prompts/implementer.md"
workspace_access = "workspace_write"

[agents.reviewer]
provider = "codex"
model = "review-model"
reasoning_effort = "medium"
instructions_file = "prompts/reviewer.md"
workspace_access = "read_only"

[workflow]
max_review_rounds = 3
""".strip(),
        encoding="utf-8",
    )
    return config


def _implementation(round_number: int) -> dict[str, object]:
    return {
        "summary": f"implemented round {round_number}",
        "changed_files": ["src/example.py"],
        "verification": ["pytest passed"],
    }


def _review(verdict: str, round_number: int) -> dict[str, object]:
    findings: list[dict[str, object]] = []
    if verdict == "changes_requested":
        findings.append(
            {
                "severity": "high",
                "message": f"fix round {round_number}",
                "file": "src/example.py",
                "line": 1,
            }
        )
    return {
        "verdict": verdict,
        "summary": f"reviewed round {round_number}",
        "findings": findings,
    }


def test_real_pipeline_completes_after_approval(tmp_path: Path) -> None:
    adapter = FakeAdapter(
        {
            "ImplementationOutput": [_implementation(1)],
            "ReviewOutput": [_review("approved", 1)],
        }
    )

    async def scenario() -> None:
        async with bootstrap(
            _config(tmp_path), runtime=AgentRuntime(adapter)
        ) as application:
            result = await application.run(
                DeliveryRequest(task="Implement it", working_directory=tmp_path)
            )
            snapshot = await application.get_state(result.workflow_id)

        assert result.status is DeliveryStatus.COMPLETED
        assert result.review is not None
        assert result.review.verdict.value == "approved"
        assert snapshot.status is DeliveryStatus.COMPLETED

    asyncio.run(scenario())
    assert adapter.sessions_started == {"implementer": 1, "reviewer": 1}
    assert [request.model for _, request in adapter.sent] == [
        "implementation-model",
        "review-model",
    ]


def test_review_loop_interrupts_then_continues_one_round(tmp_path: Path) -> None:
    adapter = FakeAdapter(
        {
            "ImplementationOutput": [_implementation(index) for index in range(1, 5)],
            "ReviewOutput": [
                _review("changes_requested", 1),
                _review("changes_requested", 2),
                _review("changes_requested", 3),
                _review("approved", 4),
            ],
        }
    )

    async def scenario() -> None:
        async with bootstrap(
            _config(tmp_path), runtime=AgentRuntime(adapter)
        ) as application:
            interrupted = await application.run(
                DeliveryRequest(task="Implement it", working_directory=tmp_path)
            )
            assert interrupted.status is DeliveryStatus.INTERRUPTED
            assert interrupted.review_round == 3
            assert interrupted.interrupt is not None

            completed = await application.resume(
                interrupted.workflow_id, HumanDecision.CONTINUE
            )

        assert completed.status is DeliveryStatus.COMPLETED
        assert completed.review_round == 4
        assert completed.max_review_rounds == 4

    asyncio.run(scenario())
    assert adapter.sessions_started == {"implementer": 1, "reviewer": 1}
    assert [thread_id for thread_id, _ in adapter.sent] == [
        "implementer-1",
        "reviewer-1",
        "implementer-1",
        "reviewer-1",
        "implementer-1",
        "reviewer-1",
        "implementer-1",
        "reviewer-1",
    ]


def test_human_can_cancel_interrupted_delivery(tmp_path: Path) -> None:
    adapter = FakeAdapter(
        {
            "ImplementationOutput": [_implementation(index) for index in range(1, 4)],
            "ReviewOutput": [
                _review("changes_requested", index) for index in range(1, 4)
            ],
        }
    )

    async def scenario() -> None:
        async with bootstrap(
            _config(tmp_path), runtime=AgentRuntime(adapter)
        ) as application:
            interrupted = await application.run(
                DeliveryRequest(task="Implement it", working_directory=tmp_path)
            )
            cancelled = await application.resume(
                interrupted.workflow_id, HumanDecision.CANCEL
            )

        assert cancelled.status is DeliveryStatus.CANCELLED

    asyncio.run(scenario())


def test_rejected_extra_round_interrupts_again(tmp_path: Path) -> None:
    adapter = FakeAdapter(
        {
            "ImplementationOutput": [_implementation(index) for index in range(1, 5)],
            "ReviewOutput": [
                _review("changes_requested", index) for index in range(1, 5)
            ],
        }
    )

    async def scenario() -> None:
        async with bootstrap(
            _config(tmp_path), runtime=AgentRuntime(adapter)
        ) as application:
            first_interrupt = await application.run(
                DeliveryRequest(task="Implement it", working_directory=tmp_path)
            )
            second_interrupt = await application.resume(
                first_interrupt.workflow_id, HumanDecision.CONTINUE
            )

        assert second_interrupt.status is DeliveryStatus.INTERRUPTED
        assert second_interrupt.review_round == 4
        assert second_interrupt.max_review_rounds == 4

    asyncio.run(scenario())


def test_invalid_agent_output_fails_delivery(tmp_path: Path) -> None:
    adapter = FakeAdapter({"ImplementationOutput": ["not-json"]})

    async def scenario() -> None:
        async with bootstrap(
            _config(tmp_path), runtime=AgentRuntime(adapter)
        ) as application:
            result = await application.run(
                DeliveryRequest(task="Implement it", working_directory=tmp_path)
            )

        assert result.status is DeliveryStatus.FAILED
        assert result.error is not None

    asyncio.run(scenario())
