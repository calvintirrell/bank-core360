"""The quality checks must be able to fail. Each test corrupts a copy of the export (or the matcher's
key function) and expects the pipeline to refuse it. Runs against the temp data root from conftest."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import polars as pl
import pytest

from pipeline import BATCHES, EXPORT, SILVER, version_dir
from pipeline.delta import read_table


@pytest.fixture
def latest(monkeypatch):
    """Quality checks evaluate the batch set as the current as-of; point them at the latest one."""
    monkeypatch.setattr("pipeline._as_of", BATCHES[-1])


@pytest.fixture
def broken_export(tmp_path: Path, monkeypatch, latest) -> Path:
    """A copy of the latest export that quality.run() reads from and writes quality.json into."""
    from pipeline import quality

    bad = tmp_path / "export"
    shutil.copytree(EXPORT, bad, ignore=shutil.ignore_patterns("v0", "replay.json"))
    monkeypatch.setattr(quality, "version_dir", lambda as_of=None: bad if as_of is None else version_dir(as_of))
    return bad


def _failed_ids(exc: BaseException) -> list[str]:
    return [s.strip(" '[]") for s in str(exc).split(":", 1)[1].split(",")]


def test_checks_pass_on_the_real_export(latest):
    from pipeline import quality

    checks = quality.run()
    assert len(checks) == 10
    assert all(c["passed"] for c in checks)


def test_flipped_dormancy_flag_fails_q08(broken_export):
    from pipeline import quality

    a = pl.read_parquet(broken_export / "account_360.parquet")
    a = a.with_columns(
        pl.when(pl.arange(0, a.height) == 0).then(~pl.col("is_dormant_180d")).otherwise(pl.col("is_dormant_180d")).alias("is_dormant_180d")
    )
    a.write_parquet(broken_export / "account_360.parquet")
    with pytest.raises(quality.QualityError) as e:
        quality.run()
    assert "Q-08" in _failed_ids(e.value)
    q = json.loads((broken_export / "quality.json").read_text())
    assert q["passed"] is False and next(c for c in q["checks"] if c["id"] == "Q-08")["value"] == 1


def test_changed_customer_key_fails_q09(broken_export):
    from pipeline import quality

    c = pl.read_parquet(broken_export / "customer_360.parquet")
    c = c.with_columns(
        pl.when(pl.arange(0, c.height) == 0).then(pl.lit("C9999999")).otherwise(pl.col("customer_key")).alias("customer_key")
    )
    c.write_parquet(broken_export / "customer_360.parquet")
    with pytest.raises(quality.QualityError) as e:
        quality.run()
    assert "Q-09" in _failed_ids(e.value)


def test_customer_flag_disagreeing_with_accounts_fails_q10(broken_export):
    from pipeline import quality

    c = pl.read_parquet(broken_export / "customer_360.parquet")
    c = c.with_columns(
        pl.when(pl.arange(0, c.height) == 0)
        .then(~pl.col("checking_dormant_180d"))
        .otherwise(pl.col("checking_dormant_180d"))
        .alias("checking_dormant_180d")
    )
    c.write_parquet(broken_export / "customer_360.parquet")
    with pytest.raises(quality.QualityError) as e:
        quality.run()
    assert "Q-10" in _failed_ids(e.value)


def test_colliding_keys_in_xref_fail_q04(broken_export, monkeypatch):
    """Two unrelated source records sharing a key (what a hash collision would produce) is refused."""
    from pipeline import quality

    xref = read_table(SILVER, "customer_xref")
    unmatched = xref.filter(pl.col("matched_with").is_null())
    victim_key, target_key = unmatched["customer_key"][0], unmatched["customer_key"][1]
    bad = xref.with_columns(
        pl.when(pl.col("customer_key") == victim_key).then(pl.lit(target_key)).otherwise(pl.col("customer_key")).alias("customer_key")
    )
    monkeypatch.setattr(quality, "_xref", lambda: bad)
    with pytest.raises(quality.QualityError) as e:
        quality.run()
    assert "Q-04" in _failed_ids(e.value)


def test_matcher_refuses_a_hash_collision(monkeypatch, latest):
    from pipeline import match
    from pipeline.quality import KeyCollisionError

    cust = read_table(SILVER, "customers")
    monkeypatch.setattr(match, "stable_key", lambda system, source_id: "C0000000")
    with pytest.raises(KeyCollisionError, match="C0000000"):
        match.resolve(cust)


def test_matcher_reports_the_key_space(latest):
    """One key per resolved person: keys issued == customer_360 rows == source records - merged pairs."""
    report = json.loads((EXPORT / "match_report.json").read_text())
    manifest = json.loads((EXPORT / "manifest.json").read_text())
    xref = read_table(SILVER, "customer_xref")
    assert report["keys"]["collisions"] == 0
    assert report["keys"]["issued"] == manifest["export"]["customer_360"]["rows"] == xref.height - report["auto_merged"]
