"""Gold: customer_360 and account_360 (rule ids G-xx, referenced by lineage.json).

Survivorship (G-01): contact fields prefer Core B (newer system) when a customer exists in both;
customer_since is the earliest across cores; is_active is true if active in any core.
Dormancy (G-10): an open checking account with no transactions in the DORMANT_DAYS before AS_OF.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import polars as pl

from pipeline import DORMANT_DAYS, GOLD, SILVER, get_as_of
from pipeline.delta import read_table, write_table


def account_360(accounts: pl.DataFrame, txns: pl.DataFrame, xref: pl.DataFrame) -> pl.DataFrame:
    as_of = datetime.combine(get_as_of(), datetime.max.time())
    cutoff_180 = as_of - timedelta(days=DORMANT_DAYS)
    cutoff_90 = as_of - timedelta(days=90)
    agg = txns.group_by(["source_system", "source_account_id"]).agg(
        pl.col("txn_ts").max().alias("last_txn_ts"),
        pl.len().alias("txn_count_365d"),
        (pl.col("txn_ts") >= cutoff_90).sum().alias("txn_count_90d"),
        (pl.col("txn_ts") >= cutoff_180).sum().alias("txn_count_180d"),
        pl.col("amount").filter(pl.col("amount") > 0).sum().alias("credits_365d"),
        pl.col("amount").filter(pl.col("amount") < 0).sum().alias("debits_365d"),
    )
    df = (
        accounts.join(
            xref.select(["source_system", "source_customer_id", "customer_key"]), on=["source_system", "source_customer_id"], how="left"
        )
        .join(agg, on=["source_system", "source_account_id"], how="left")
        .with_columns(
            pl.col("txn_count_365d").fill_null(0),
            pl.col("txn_count_90d").fill_null(0),
            pl.col("txn_count_180d").fill_null(0),
            pl.col("credits_365d").fill_null(0.0).round(2),
            pl.col("debits_365d").fill_null(0.0).round(2),
        )
        .with_columns(
            (pl.lit(as_of) - pl.col("last_txn_ts")).dt.total_days().alias("days_since_last_txn"),
            (pl.col("is_open") & (pl.col("txn_count_180d") == 0)).alias("is_dormant_180d"),  # G-10
        )
    )
    return df.select(
        "customer_key",
        "source_system",
        "source_account_id",
        "source_customer_id",
        "product_type",
        "product_category",
        "source_product_code",
        "opened_on",
        "balance",
        "is_open",
        "last_txn_ts",
        "days_since_last_txn",
        "txn_count_90d",
        "txn_count_180d",
        "txn_count_365d",
        "credits_365d",
        "debits_365d",
        "is_dormant_180d",
    ).sort(["customer_key", "source_system", "source_account_id"])


def customer_360(cust: pl.DataFrame, xref: pl.DataFrame, acct360: pl.DataFrame) -> pl.DataFrame:
    c = cust.join(xref, on=["source_system", "source_customer_id"], how="left")
    # G-01 survivorship: order so core_b wins for contact fields via first() after sort.
    c = c.with_columns(pl.when(pl.col("source_system") == "core_b").then(0).otherwise(1).alias("_pref")).sort(["customer_key", "_pref"])
    base = c.group_by("customer_key").agg(
        pl.col("first_name").first(),
        pl.col("last_name").first(),
        pl.col("full_name").first(),
        pl.col("dob").first(),
        pl.col("email").drop_nulls().first(),
        pl.col("phone_digits").first().alias("phone"),
        pl.col("city").first(),
        pl.col("state").first(),
        pl.col("postal_code").first(),
        pl.col("customer_since").min(),  # G-02 earliest relationship date
        pl.col("is_active").any(),  # G-03
        (pl.col("source_system") == "core_a").any().alias("in_core_a"),
        (pl.col("source_system") == "core_b").any().alias("in_core_b"),
        pl.col("source_customer_id").filter(pl.col("source_system") == "core_a").first().alias("core_a_cif"),
        pl.col("source_customer_id").filter(pl.col("source_system") == "core_b").first().alias("core_b_customer_id"),
        pl.col("match_tier").max(),
        pl.col("match_confidence").max(),
    )
    base = base.with_columns(
        pl.when(pl.col("in_core_a") & pl.col("in_core_b"))
        .then(pl.lit("core_a+core_b"))
        .when(pl.col("in_core_a"))
        .then(pl.lit("core_a"))
        .otherwise(pl.lit("core_b"))
        .alias("source_systems")  # G-04
    )
    open_accts = acct360.filter(pl.col("is_open"))
    agg = open_accts.group_by("customer_key").agg(
        pl.len().alias("open_accounts"),
        (pl.col("product_type") == "checking").any().alias("has_checking"),
        (pl.col("product_type") == "savings").any().alias("has_savings"),
        (pl.col("product_type") == "mortgage").any().alias("has_mortgage"),
        (pl.col("product_type") == "cd").any().alias("has_cd"),
        pl.col("balance").filter(pl.col("product_category") == "deposit").sum().round(2).alias("deposit_balance"),  # G-05
        pl.col("balance").filter(pl.col("product_category") == "loan").sum().round(2).alias("loan_balance"),  # G-06
        pl.col("last_txn_ts").max().alias("last_activity_ts"),
        pl.col("txn_count_90d").sum().alias("txn_count_90d"),
        pl.col("is_dormant_180d").filter(pl.col("product_type") == "checking").any().alias("checking_dormant_180d"),  # G-11
        pl.col("last_txn_ts").filter(pl.col("product_type") == "checking").max().alias("checking_last_txn_ts"),
    )
    df = base.join(agg, on="customer_key", how="left").with_columns(
        pl.col("open_accounts").fill_null(0),
        pl.col("has_checking").fill_null(False),
        pl.col("has_savings").fill_null(False),
        pl.col("has_mortgage").fill_null(False),
        pl.col("has_cd").fill_null(False),
        pl.col("deposit_balance").fill_null(0.0),
        pl.col("loan_balance").fill_null(0.0),
        pl.col("txn_count_90d").fill_null(0),
        pl.col("checking_dormant_180d").fill_null(False),
    )
    return df.select(
        "customer_key",
        "full_name",
        "first_name",
        "last_name",
        "dob",
        "email",
        "phone",
        "city",
        "state",
        "postal_code",
        "customer_since",
        "is_active",
        "source_systems",
        "in_core_a",
        "in_core_b",
        "core_a_cif",
        "core_b_customer_id",
        "match_tier",
        "match_confidence",
        "open_accounts",
        "has_checking",
        "has_savings",
        "has_mortgage",
        "has_cd",
        "deposit_balance",
        "loan_balance",
        "last_activity_ts",
        "txn_count_90d",
        "checking_last_txn_ts",
        "checking_dormant_180d",
    ).sort("customer_key")


def review_queue(cust: pl.DataFrame, xref: pl.DataFrame, review: pl.DataFrame, c360: pl.DataFrame) -> pl.DataFrame:
    """G-20: candidate pairs below the auto-merge threshold, enriched so a human can triage them.
    Each side is still its own customer_360 row; nothing here is merged."""
    a = cust.filter(pl.col("source_system") == "core_a").select(
        pl.col("source_customer_id").alias("core_a_cif"),
        pl.col("full_name").alias("core_a_name"),
        pl.col("dob"),
    )
    b = cust.filter(pl.col("source_system") == "core_b").select(
        pl.col("source_customer_id").alias("core_b_customer_id"),
        pl.col("full_name").alias("core_b_name"),
        pl.col("ssn_last4").is_null().alias("core_b_ssn_missing"),
    )
    xa = xref.filter(pl.col("source_system") == "core_a").select(
        pl.col("source_customer_id").alias("core_a_cif"), pl.col("customer_key").alias("core_a_customer_key")
    )
    xb = xref.filter(pl.col("source_system") == "core_b").select(
        pl.col("source_customer_id").alias("core_b_customer_id"), pl.col("customer_key").alias("core_b_customer_key")
    )
    bal = c360.select("customer_key", (pl.col("deposit_balance") + pl.col("loan_balance")).alias("balance"), "open_accounts")
    df = (
        review.join(a, on="core_a_cif", how="left")
        .join(b, on="core_b_customer_id", how="left")
        .join(xa, on="core_a_cif", how="left")
        .join(xb, on="core_b_customer_id", how="left")
        .join(
            bal.rename({"customer_key": "core_a_customer_key", "balance": "core_a_balance", "open_accounts": "core_a_open_accounts"}),
            on="core_a_customer_key",
            how="left",
        )
        .join(
            bal.rename({"customer_key": "core_b_customer_key", "balance": "core_b_balance", "open_accounts": "core_b_open_accounts"}),
            on="core_b_customer_key",
            how="left",
        )
        .with_columns(
            (pl.col("core_a_balance").fill_null(0.0) + pl.col("core_b_balance").fill_null(0.0)).round(2).alias("combined_balance")
        )
        .sort(["combined_balance", "confidence"], descending=[True, True])
        .with_row_index("priority", offset=1)
    )
    return df.select(
        "priority",
        "core_a_customer_key",
        "core_b_customer_key",
        "core_a_cif",
        "core_b_customer_id",
        "core_a_name",
        "core_b_name",
        "dob",
        "confidence",
        "name_similarity",
        "ssn_signal",
        "core_b_ssn_missing",
        "phone_match",
        "postal_code_match",
        "core_a_balance",
        "core_b_balance",
        "combined_balance",
        "core_a_open_accounts",
        "core_b_open_accounts",
    )


def run(fresh: bool = True) -> dict[str, int]:
    cust = read_table(SILVER, "customers")
    accounts = read_table(SILVER, "accounts")
    txns = read_table(SILVER, "transactions")
    xref = read_table(SILVER, "customer_xref")
    a360 = account_360(accounts, txns, xref)
    c360 = customer_360(cust, xref, a360)
    rq = review_queue(cust, xref, read_table(SILVER, "match_review_queue"), c360)
    write_table(a360, GOLD, "account_360", "One row per account with resolved customer_key, activity and dormancy", fresh=fresh)
    write_table(c360, GOLD, "customer_360", "One row per resolved customer across both cores", fresh=fresh)
    write_table(
        rq, GOLD, "review_queue", "Cross-core candidate pairs below the auto-merge threshold, enriched for human triage", fresh=fresh
    )
    return {"account_360": a360.height, "customer_360": c360.height, "review_queue": rq.height}
