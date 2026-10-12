"""Reviewer decisions (ER-08) are honoured and reported, never dropped silently. Each test writes
its own decisions file and runs the matcher on the silver customers of the latest batch."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import polars as pl
import pytest

from pipeline import BATCHES, EXPORT, SILVER, match
from pipeline.delta import read_table

HEADER = ["core_a_cif", "core_b_customer_id", "decision", "decided_on", "reviewer", "note"]


@pytest.fixture(scope="module")
def cust() -> pl.DataFrame:
    return read_table(SILVER, "customers")


@pytest.fixture
def decisions_file(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("pipeline._as_of", BATCHES[-1])
    monkeypatch.setattr(match, "DECISIONS", tmp_path)

    def write(rows: list[list[str]]) -> Path:
        p = tmp_path / "review_decisions.csv"
        with p.open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(HEADER)
            w.writerows(rows)
        return p

    return write


def _xref_pair(xref: pl.DataFrame, b_id: str) -> tuple[str | None, int | None]:
    r = xref.filter((pl.col("source_system") == "core_b") & (pl.col("source_customer_id") == b_id)).row(0, named=True)
    return r["matched_with"], r["match_tier"]


def test_confirm_on_a_pair_the_rules_never_scored_merges_as_tier_3(cust, decisions_file):
    a = cust.filter(pl.col("source_system") == "core_a").row(0, named=True)
    b = cust.filter((pl.col("source_system") == "core_b") & (pl.col("dob") != a["dob"])).row(0, named=True)
    decisions_file([[a["source_customer_id"], b["source_customer_id"], "confirm", "2026-10-01", "ops", "confirmed by call"]])
    xref, _, report = match.resolve(cust)
    assert _xref_pair(xref, b["source_customer_id"]) == (a["source_customer_id"], 3)
    row = report["decisions"]["rows"][0]
    assert row["status"] == "applied" and row["was_candidate"] is False
    assert report["decisions"]["applied"] == 1 and report["confirmed_by_reviewer"] >= 1


def _first_tier1_pair(cust: pl.DataFrame, decisions_file) -> dict:
    """A pair the rules merge on their own (tier 1), found by resolving with no decisions on file."""
    decisions_file([])
    xref0, _, _ = match.resolve(cust)
    return xref0.filter((pl.col("source_system") == "core_b") & (pl.col("match_tier") == 1)).row(0, named=True)


def test_reject_blocks_a_pair_the_rules_would_merge(cust, decisions_file):
    tier1 = _first_tier1_pair(cust, decisions_file)
    decisions_file([[tier1["matched_with"], tier1["source_customer_id"], "reject", "2026-10-01", "ops", "different people"]])
    xref, _, report = match.resolve(cust)
    assert _xref_pair(xref, tier1["source_customer_id"]) == (None, None)
    assert report["decisions"]["reject_applied"] == 1 and report["rejected_by_reviewer"] == 1
    assert report["decisions"]["rows"][0]["was_candidate"] is True


def test_future_dated_decision_is_pending_not_applied(cust, decisions_file):
    tier1 = _first_tier1_pair(cust, decisions_file)
    decisions_file([[tier1["matched_with"], tier1["source_customer_id"], "reject", "2027-01-01", "ops", "later"]])
    xref, _, report = match.resolve(cust)
    assert _xref_pair(xref, tier1["source_customer_id"]) == (tier1["matched_with"], 1)
    assert report["decisions"] == {**report["decisions"], "pending": 1, "applied": 0, "reject_applied": 0}
    assert report["rejected_by_reviewer"] == 0


def test_unknown_id_is_reported_as_ignored(cust, decisions_file):
    decisions_file([["99999999", "not-a-real-id", "confirm", "2026-10-01", "ops", "typo"]])
    _, _, report = match.resolve(cust)
    d = report["decisions"]
    assert d["ignored_unknown_id"] == 1 and d["applied"] == 0 and d["rows"][0]["status"] == "ignored_unknown_id"


@pytest.mark.parametrize(
    "row", [["10000001", "x", "maybe", "2026-10-01", "ops", ""], ["10000001", "x", "confirm", "10/01/2026", "ops", ""]]
)
def test_malformed_decision_row_stops_the_pipeline(cust, decisions_file, row):
    decisions_file([row])
    with pytest.raises(ValueError, match="line 2"):
        match.resolve(cust)


def test_shipped_decisions_are_all_accounted_for():
    latest = json.loads((EXPORT / "match_report.json").read_text())["decisions"]
    first = json.loads((EXPORT / "v0" / "match_report.json").read_text())["decisions"]
    assert latest["total"] == first["total"] == 7
    assert (latest["applied"], latest["pending"], latest["ignored_unknown_id"]) == (7, 0, 0)
    assert (latest["confirm_applied"], latest["reject_applied"]) == (5, 2)
    assert (first["applied"], first["pending"]) == (0, 7), "all decisions are dated after the first batch"
    assert all(r["was_candidate"] for r in latest["rows"] if r["status"] == "applied"), (
        "the shipped decisions all came from the review queue"
    )
