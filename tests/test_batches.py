"""Batch mechanics: Delta history on every table, manifests that know which batch is latest, and
generator invariants that hold across batches."""

from __future__ import annotations

import json

import polars as pl
from deltalake import DeltaTable

from pipeline import BATCHES, EXPORT, GOLD, SILVER

V0 = EXPORT / "v0"


def _delta(layer, name, version=None) -> pl.DataFrame:
    return pl.from_arrow(DeltaTable(str(layer / name), version=version).to_pyarrow_table())


def test_every_table_has_one_delta_version_per_batch():
    for layer, name in (
        (GOLD, "customer_360"),
        (GOLD, "account_360"),
        (GOLD, "review_queue"),
        (SILVER, "customer_xref"),
        (SILVER, "match_review_queue"),
        (SILVER, "customers"),
        (SILVER, "transactions"),
    ):
        assert DeltaTable(str(layer / name)).version() == len(BATCHES) - 1, f"{name} lacks batch history"


def test_delta_time_travel_matches_the_exported_first_batch():
    v0 = _delta(GOLD, "customer_360", version=0).sort("customer_key")
    exported = pl.read_parquet(V0 / "customer_360.parquet").sort("customer_key")
    assert v0.equals(exported)
    xref0 = _delta(SILVER, "customer_xref", version=0)
    xref1 = _delta(SILVER, "customer_xref")
    assert xref1.height > xref0.height, "the second batch added customers to the crosswalk"


def test_manifests_know_which_batch_is_latest():
    first = json.loads((V0 / "manifest.json").read_text())
    latest = json.loads((EXPORT / "manifest.json").read_text())
    assert (first["is_latest"], latest["is_latest"]) == (False, True)
    assert [v["as_of"] for v in latest["versions"]] == [d.isoformat() for d in BATCHES]
    assert latest["versions"][-1]["dir"] == "" and latest["versions"][0]["dir"] == "v0"
    assert "changes" in latest and "changes" not in first


def test_no_account_opens_before_its_customer_or_after_the_as_of():
    for d, as_of in ((V0, BATCHES[0]), (EXPORT, BATCHES[-1])):
        a = pl.read_parquet(d / "account_360.parquet")
        c = pl.read_parquet(d / "customer_360.parquet").select("customer_key", "customer_since")
        j = a.join(c, on="customer_key")
        early = j.filter(pl.col("opened_on") < pl.col("customer_since"))
        assert early.height == 0, f"{early.height} accounts in {as_of} open before the customer relationship"
        assert j.filter(pl.col("opened_on") > pl.lit(as_of)).height == 0


def test_no_transaction_before_its_account_opened():
    for d in (V0, EXPORT):
        t = pl.read_parquet(d / "transactions.parquet").select("source_system", "source_account_id", "txn_ts")
        a = pl.read_parquet(d / "account_360.parquet").select("source_system", "source_account_id", "opened_on")
        early = t.join(a, on=["source_system", "source_account_id"]).filter(pl.col("txn_ts").dt.date() < pl.col("opened_on"))
        assert early.height == 0, f"{early.height} transactions in {d.name or 'latest'} predate their account"
