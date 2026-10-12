"""Replay cache: the fingerprint covers everything a cached explanation could quote, and an empty
explanation is never reused."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from pipeline import EXPORT, replay

R1 = {"columns": ["n"], "rows": [[1]], "row_count": 1}


def test_fingerprint_changes_with_data_model_question_sql_and_prompt(monkeypatch):
    q = {"question": "How many?", "sql": "SELECT 1"}
    base = replay._fingerprint(q, R1)
    assert replay._fingerprint(q, {**R1, "rows": [[2]]}) != base, "a different result row must change it"
    assert replay._fingerprint(q, R1, model="other-model") != base
    assert replay._fingerprint({**q, "question": "How many now?"}, R1) != base
    assert replay._fingerprint({**q, "sql": "SELECT 2"}, R1) != base
    assert replay._fingerprint(q, R1) == base, "and it is stable"
    monkeypatch.setattr(replay, "build_prompt", lambda: "a different system prompt")
    assert replay._fingerprint(q, R1) != base


def test_reusable_requires_same_fingerprint_and_a_real_explanation():
    good = {"fingerprint": "abc", "agent": {"explanation": "Twelve people."}}
    assert replay.reusable(good, "abc")
    assert not replay.reusable(good, "xyz")
    assert not replay.reusable({"fingerprint": "abc", "agent": {"explanation": None}}, "abc")
    assert not replay.reusable({"fingerprint": "abc", "agent": None}, "abc")
    assert not replay.reusable(None, "abc")


@pytest.fixture
def export_copy(tmp_path: Path, monkeypatch) -> Path:
    d = tmp_path / "export"
    shutil.copytree(EXPORT, d, ignore=shutil.ignore_patterns("v0"))
    monkeypatch.setattr(replay, "EXPORT", d)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    return d


def test_write_keeps_good_transcripts_and_drops_stale_or_empty_ones(export_copy):
    first = replay.write()
    assert first["regenerated"] == 0 and first["with_transcript"] == 0, "no key: nothing generated, nothing to reuse"
    data = json.loads((export_copy / "replay.json").read_text())
    ids = [e["id"] for e in data["questions"]]
    # plant transcripts: one good, one with a stale fingerprint, one with an empty explanation
    data["questions"][0]["agent"] = {"explanation": "Kept.", "calls": 1}
    data["questions"][1]["agent"] = {"explanation": "Stale.", "calls": 1}
    data["questions"][1]["fingerprint"] = "0000000000000000"
    data["questions"][2]["agent"] = {"explanation": None, "calls": 4}
    (export_copy / "replay.json").write_text(json.dumps(data))
    second = replay.write()
    out = {e["id"]: e for e in json.loads((export_copy / "replay.json").read_text())["questions"]}
    assert out[ids[0]]["agent"]["explanation"] == "Kept."
    assert out[ids[1]]["agent"] is None, "a changed fingerprint drops the old transcript"
    assert out[ids[2]]["agent"] is None, "an empty explanation is never reused"
    assert second["with_transcript"] == 1
