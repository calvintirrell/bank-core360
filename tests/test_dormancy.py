"""Customer-level dormancy columns agree with each other and with the accounts (G-11, G-12, G-13)."""

from __future__ import annotations

from datetime import datetime, timedelta

import duckdb
import polars as pl
import pytest

from pipeline import BATCHES, DORMANT_DAYS, EXPORT


@pytest.mark.parametrize("sub, as_of", [("v0", BATCHES[0]), ("", BATCHES[-1])])
def test_quiet_date_is_never_inside_the_window(sub, as_of):
    c = pl.read_parquet(EXPORT / sub / "customer_360.parquet")
    cutoff = datetime.combine(as_of, datetime.max.time()) - timedelta(days=DORMANT_DAYS)
    flagged = c.filter(pl.col("checking_dormant_180d"))
    assert flagged.height > 0
    # the date shown next to the flag is the quiet account's own last use, so it is always older than the window
    assert flagged.filter(pl.col("dormant_checking_last_txn_ts") >= cutoff).height == 0
    # ...whereas the max over every checking account can be recent (that was the audit finding)
    assert flagged.filter(pl.col("checking_last_txn_ts") >= cutoff).height > 0
    assert c.filter(~pl.col("checking_dormant_180d") & pl.col("dormant_checking_last_txn_ts").is_not_null()).height == 0


def test_all_dormant_implies_any_dormant_and_matches_accounts():
    con = duckdb.connect()
    con.execute(f"CREATE VIEW c AS SELECT * FROM read_parquet('{EXPORT / 'customer_360.parquet'}')")
    con.execute(f"CREATE VIEW a AS SELECT * FROM read_parquet('{EXPORT / 'account_360.parquet'}')")
    assert con.execute("SELECT count(*) FROM c WHERE checking_all_dormant_180d AND NOT checking_dormant_180d").fetchone()[0] == 0
    assert con.execute("SELECT count(*) FROM c WHERE checking_all_dormant_180d AND NOT has_checking").fetchone()[0] == 0
    n_any, n_all = con.execute(
        "SELECT count(*) FILTER (checking_dormant_180d), count(*) FILTER (checking_all_dormant_180d) FROM c"
    ).fetchone()
    assert n_any > n_all > 0, "some people have one quiet and one active checking account"
    mismatch = con.execute(
        """SELECT count(*) FROM c LEFT JOIN (
               SELECT customer_key, bool_and(is_dormant_180d) AS all_d, max(last_txn_ts) FILTER (is_dormant_180d) AS quiet_ts
               FROM a WHERE is_open AND product_type = 'checking' GROUP BY 1) x USING (customer_key)
           WHERE c.checking_all_dormant_180d != coalesce(x.all_d, false)
              OR c.dormant_checking_last_txn_ts IS DISTINCT FROM x.quiet_ts"""
    ).fetchone()[0]
    assert mismatch == 0
