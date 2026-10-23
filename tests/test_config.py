"""Tests for TOML agent profile loading."""

from pathlib import Path

import pytest
from pydantic import ValidationError

from claith.infrastructure.config import load_config


def _write_config(tmp_path: Path, *, model: str = 'model = "test-model"') -> Path:
    prompts = tmp_path / "prompts"
    prompts.mkdir()
    (prompts / "implementer.md").write_text("Implement.", encoding="utf-8")
    (prompts / "reviewer.md").write_text("Review.", encoding="utf-8")
    path = tmp_path / "claith.toml"
    path.write_text(
        f"""
[agents.implementer]
provider = "codex"
{model}
instructions_file = "prompts/implementer.md"
workspace_access = "workspace_write"

[agents.reviewer]
provider = "codex"
model = "test-model"
instructions_file = "prompts/reviewer.md"
workspace_access = "read_only"

[workflow]
max_review_rounds = 3
""".strip(),
        encoding="utf-8",
    )
    return path


def test_load_config_resolves_and_reads_prompt_files(tmp_path: Path) -> None:
    config = load_config(_write_config(tmp_path))

    assert config.agents.implementer.instructions == "Implement."
    assert config.agents.reviewer.instructions_file.is_absolute()
    assert config.workflow.max_review_rounds == 3


def test_load_config_requires_explicit_model(tmp_path: Path) -> None:
    with pytest.raises(ValidationError):
        load_config(_write_config(tmp_path, model=""))


def test_load_config_requires_read_only_reviewer(tmp_path: Path) -> None:
    path = _write_config(tmp_path)
    contents = path.read_text(encoding="utf-8").replace(
        'workspace_access = "read_only"', 'workspace_access = "workspace_write"'
    )
    path.write_text(contents, encoding="utf-8")

    with pytest.raises(ValidationError, match="reviewer must use read_only"):
        load_config(path)
