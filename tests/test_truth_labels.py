"""The generator's ground-truth labels describe the data: a 'nickname' pair really differs by a
nickname, a 'typo' pair really has a different last name, and so on."""

from __future__ import annotations

import csv

import polars as pl

from data.generators.common import NICKNAMES
from pipeline import SILVER, TRUTH
from pipeline.delta import read_table


def _pairs() -> pl.DataFrame:
    with (TRUTH / "overlap.csv").open() as f:
        truth = pl.DataFrame(list(csv.DictReader(f)))
    cust = read_table(SILVER, "customers").select(
        "source_system", "source_customer_id", "first_name", "last_name", "ssn_last4", "postal_code"
    )
    a = cust.filter(pl.col("source_system") == "core_a").rename({"source_customer_id": "a_cif"}).drop("source_system")
    b = cust.filter(pl.col("source_system") == "core_b").rename({"source_customer_id": "b_customer_id"}).drop("source_system")
    return truth.join(a, on="a_cif").join(b, on="b_customer_id", suffix="_b")


def test_every_variation_label_is_true():
    p = _pairs()
    nick = p.filter(pl.col("kind") == "nickname")
    assert nick.height == 30
    assert nick.filter(pl.col("first_name") == pl.col("first_name_b")).height == 0
    assert all(NICKNAMES.get(a) == b for a, b in zip(nick["first_name"], nick["first_name_b"]))
    typo = p.filter(pl.col("kind") == "typo")
    assert typo.height == 15
    assert typo.filter(pl.col("last_name") == pl.col("last_name_b")).height == 0
    assert typo.filter(pl.col("first_name") != pl.col("first_name_b")).height == 0
    clean = p.filter(pl.col("kind") == "clean")
    assert clean.filter((pl.col("first_name") != pl.col("first_name_b")) | (pl.col("last_name") != pl.col("last_name_b"))).height == 0
    for kind in ("ssn_missing", "lastname_changed_ssn_missing", "ssn_missing_moved", "lastname_changed_ssn_missing_moved_newphone"):
        assert p.filter((pl.col("kind") == kind) & pl.col("ssn_last4_b").is_not_null()).height == 0, kind
    for kind in ("lastname_changed", "lastname_changed_ssn_missing", "lastname_changed_ssn_missing_moved_newphone"):
        assert p.filter((pl.col("kind") == kind) & (pl.col("last_name") == pl.col("last_name_b"))).height == 0, kind
    for kind in ("ssn_missing_moved", "lastname_changed_ssn_missing_moved_newphone"):
        assert p.filter((pl.col("kind") == kind) & (pl.col("postal_code") == pl.col("postal_code_b"))).height == 0, kind
