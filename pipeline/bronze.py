"""Bronze: land each raw feed exactly as received (all columns as text for the legacy core,
native JSON types for the modern core) plus ingest metadata. Nothing is cleaned here."""

from __future__ import annotations

import polars as pl

from pipeline import AS_OF, BRONZE, RAW
from pipeline.delta import write_table

FEEDS = {
    "core_a_custmast": ("core_a", "CUSTMAST.psv"),
    "core_a_acctmast": ("core_a", "ACCTMAST.psv"),
    "core_a_txnhist": ("core_a", "TXNHIST.psv"),
    "core_b_customers": ("core_b", "customers.jsonl"),
    "core_b_accounts": ("core_b", "accounts.jsonl"),
    "core_b_transactions": ("core_b", "transactions.jsonl"),
}


def land(system: str, filename: str) -> pl.DataFrame:
    path = RAW / system / filename
    if filename.endswith(".psv"):
        df = pl.read_csv(path, separator="|", infer_schema=False)
    else:
        df = pl.read_ndjson(path)
    return df.with_columns(
        pl.lit(system).alias("_source_system"),
        pl.lit(f"{system}/{filename}").alias("_source_file"),
        pl.lit(AS_OF.isoformat()).alias("_ingest_batch"),
        pl.int_range(pl.len()).alias("_source_row"),
    )


def run() -> dict[str, int]:
    counts = {}
    for name, (system, filename) in FEEDS.items():
        df = land(system, filename)
        write_table(df, BRONZE, name, f"Raw landing of {system}/{filename}, untouched")
        counts[name] = df.height
    return counts
