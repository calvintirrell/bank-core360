"""Silver: one standardized schema per entity, regardless of which core it came from.

Every transform here has a rule id (S-xx) that lineage.json points at."""

from __future__ import annotations

import polars as pl

from pipeline import BRONZE, SILVER
from pipeline.delta import read_table, write_table

PRODUCT_MAP_A = {"DDA": "checking", "SAV": "savings", "MTG": "mortgage", "CDA": "cd"}
PRODUCT_MAP_B = {"checking": "checking", "savings": "savings", "mortgage": "mortgage", "certificate_of_deposit": "cd"}
PRODUCT_CATEGORY = {"checking": "deposit", "savings": "deposit", "cd": "deposit", "mortgage": "loan"}

# S-07: nickname canonicalization used for the name match key (not for display names).
NICK_TO_FORMAL = {
    "Bill": "William",
    "Bob": "Robert",
    "Rick": "Richard",
    "Liz": "Elizabeth",
    "Kate": "Katherine",
    "Mike": "Michael",
    "Chris": "Christopher",
    "Jen": "Jennifer",
    "Peggy": "Margaret",
    "Jim": "James",
    "Tom": "Thomas",
    "Pat": "Patricia",
    "Joe": "Joseph",
    "Dan": "Daniel",
    "Matt": "Matthew",
    "Tony": "Anthony",
    "Steve": "Steven",
    "Andy": "Andrew",
    "Becky": "Rebecca",
    "Sam": "Samuel",
}


def _name_key(first: pl.Expr, last: pl.Expr) -> pl.Expr:
    """S-07/S-08: lowercase, nickname-canonicalized, hyphens to spaces."""
    f = first.str.to_titlecase().replace(NICK_TO_FORMAL).str.to_lowercase()
    l = last.str.to_lowercase().str.replace_all("-", " ")
    return pl.concat_str([f, pl.lit(" "), l]).str.strip_chars()


def customers() -> pl.DataFrame:
    a = read_table(BRONZE, "core_a_custmast")
    # S-01: "LAST, FIRST M" -> parts
    a = a.with_columns(
        pl.col("CUST_NAME").str.split_exact(", ", 1).struct.field("field_0").alias("_last"),
        pl.col("CUST_NAME").str.split_exact(", ", 1).struct.field("field_1").alias("_rest"),
    ).with_columns(
        pl.col("_rest").str.split(" ").list.get(0).alias("_first"),
        pl.col("_rest").str.split(" ").list.get(1, null_on_oob=True).alias("_middle"),
    )
    a_std = a.select(
        pl.lit("core_a").alias("source_system"),
        pl.col("CIF_NO").alias("source_customer_id"),
        pl.col("_first").str.to_titlecase().alias("first_name"),
        pl.col("_middle").alias("middle_initial"),
        pl.col("_last").str.to_titlecase().alias("last_name"),
        pl.col("DOB").str.strptime(pl.Date, "%Y%m%d").alias("dob"),  # S-02
        pl.col("SSN_LAST4").alias("ssn_last4"),
        pl.lit(None, dtype=pl.String).alias("email"),
        pl.col("PHONE").str.replace_all(r"\D", "").alias("phone_digits"),  # S-04
        pl.col("ADDR_LINE1").str.to_titlecase().alias("address_line1"),
        pl.col("CITY").str.to_titlecase().alias("city"),
        pl.col("ST").alias("state"),
        pl.col("ZIP").alias("postal_code"),
        pl.col("OPEN_DT").str.strptime(pl.Date, "%Y%m%d").alias("customer_since"),  # S-02
        (pl.col("CUST_STAT") == "A").alias("is_active"),  # S-05
    )

    b = read_table(BRONZE, "core_b_customers")
    b_std = b.select(
        pl.lit("core_b").alias("source_system"),
        pl.col("customer_id").alias("source_customer_id"),
        pl.col("first_name"),
        pl.col("middle_initial"),
        pl.col("last_name"),
        pl.col("date_of_birth").str.strptime(pl.Date, "%Y-%m-%d").alias("dob"),  # S-03
        pl.col("ssn_last_four").alias("ssn_last4"),
        pl.col("email"),
        pl.col("phone").str.replace_all(r"\D", "").alias("phone_digits"),  # S-04
        pl.col("address").struct.field("street").alias("address_line1"),  # S-06
        pl.col("address").struct.field("city").alias("city"),
        pl.col("address").struct.field("state").alias("state"),
        pl.col("address").struct.field("postal_code").alias("postal_code"),
        pl.col("created_at").str.to_datetime("%Y-%m-%dT%H:%M:%SZ").dt.date().alias("customer_since"),  # S-03
        pl.col("is_active"),
    )
    df = pl.concat([a_std, b_std]).with_columns(
        _name_key(pl.col("first_name"), pl.col("last_name")).alias("name_key"),
        pl.concat_str([pl.col("first_name"), pl.lit(" "), pl.col("last_name")]).alias("full_name"),
    )
    return df.sort(["source_system", "source_customer_id"])


def accounts() -> pl.DataFrame:
    a = read_table(BRONZE, "core_a_acctmast")
    a_std = a.select(
        pl.lit("core_a").alias("source_system"),
        pl.col("ACCT_NO").alias("source_account_id"),
        pl.col("CIF_NO").alias("source_customer_id"),
        pl.col("PROD_CD").replace_strict(PRODUCT_MAP_A).alias("product_type"),  # S-10
        pl.col("PROD_CD").alias("source_product_code"),
        pl.col("OPEN_DT").str.strptime(pl.Date, "%Y%m%d").alias("opened_on"),  # S-02
        (pl.col("CUR_BAL_CENTS").cast(pl.Int64) / 100.0).round(2).alias("balance"),  # S-11
        (pl.col("ACCT_STAT") == "O").alias("is_open"),  # S-12
    )
    b = read_table(BRONZE, "core_b_accounts")
    b_std = b.select(
        pl.lit("core_b").alias("source_system"),
        pl.col("account_id").alias("source_account_id"),
        pl.col("customer_id").alias("source_customer_id"),
        pl.col("product_type").replace_strict(PRODUCT_MAP_B).alias("product_type"),  # S-10
        pl.col("product_type").alias("source_product_code"),
        pl.col("opened_on").str.strptime(pl.Date, "%Y-%m-%d").alias("opened_on"),  # S-03
        pl.col("balance").cast(pl.Float64).round(2).alias("balance"),
        (pl.col("status") == "open").alias("is_open"),  # S-12
    )
    df = pl.concat([a_std, b_std]).with_columns(
        pl.col("product_type").replace_strict(PRODUCT_CATEGORY).alias("product_category")  # S-13
    )
    return df.sort(["source_system", "source_account_id"])


def transactions() -> pl.DataFrame:
    a = read_table(BRONZE, "core_a_txnhist")
    a_std = a.select(
        pl.lit("core_a").alias("source_system"),
        pl.col("TXN_ID").alias("source_txn_id"),
        pl.col("ACCT_NO").alias("source_account_id"),
        pl.col("TXN_DT").str.strptime(pl.Datetime("us"), "%m/%d/%Y").alias("txn_ts"),  # S-20
        pl.when(pl.col("DR_CR") == "C")
        .then(pl.col("AMT").cast(pl.Float64))
        .otherwise(-pl.col("AMT").cast(pl.Float64))
        .round(2)
        .alias("amount"),  # S-21
        pl.col("DESC").str.to_titlecase().alias("memo"),  # S-22
    )
    b = read_table(BRONZE, "core_b_transactions")
    b_std = b.select(
        pl.lit("core_b").alias("source_system"),
        pl.col("transaction_id").alias("source_txn_id"),
        pl.col("account_id").alias("source_account_id"),
        pl.col("posted_at").str.to_datetime("%Y-%m-%dT%H:%M:%SZ").cast(pl.Datetime("us")).alias("txn_ts"),  # S-20
        pl.col("amount").cast(pl.Float64).round(2).alias("amount"),
        pl.col("description").alias("memo"),
    )
    df = pl.concat([a_std, b_std]).with_columns(
        pl.when(pl.col("amount") >= 0).then(pl.lit("credit")).otherwise(pl.lit("debit")).alias("direction")  # S-23
    )
    return df.sort(["source_system", "source_txn_id"])


def run() -> dict[str, int]:
    out = {}
    for name, fn, desc in [
        ("customers", customers, "Standardized customers from both cores (one row per source record)"),
        ("accounts", accounts, "Standardized accounts with canonical product taxonomy"),
        ("transactions", transactions, "Standardized, signed transactions"),
    ]:
        df = fn()
        write_table(df, SILVER, name, desc)
        out[name] = df.height
    return out
