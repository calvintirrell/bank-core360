"""Entry point: `uv run python -m pipeline` (generates raw feeds, then bronze -> silver -> match
-> gold -> export). Every output is deterministic for a given SEED."""

from __future__ import annotations

import json
import sys
import time

import polars as pl

from pipeline import AS_OF, EXPORT, GOLD, SEED, SILVER, bronze, gold, lineage, match, silver
from pipeline.delta import read_table


def export() -> dict[str, dict]:
    EXPORT.mkdir(parents=True, exist_ok=True)
    c360 = read_table(GOLD, "customer_360")
    a360 = read_table(GOLD, "account_360")
    txns = (
        read_table(SILVER, "transactions")
        .join(a360.select(["source_system", "source_account_id", "customer_key"]), on=["source_system", "source_account_id"], how="left")
        .select(["customer_key", "source_system", "source_txn_id", "source_account_id", "txn_ts", "amount", "memo", "direction"])
        .sort(["source_system", "source_txn_id"])
    )
    tables = {"customer_360": c360, "account_360": a360, "transactions": txns}
    out = {}
    for name, df in tables.items():
        df.write_parquet(EXPORT / f"{name}.parquet", compression="zstd", statistics=True)
        out[name] = {"rows": df.height, "columns": df.columns}
    return out


def main() -> int:
    t0 = time.perf_counter()
    from data.generators.__main__ import main as generate

    generate()
    b = bronze.run()
    s = silver.run()
    m = match.run()
    g = gold.run()
    lineage.write()
    e = export()
    manifest = {
        "schema_version": 1,
        "seed": SEED,
        "as_of": AS_OF.isoformat(),
        "bronze": b,
        "silver": s,
        "gold": g,
        "export": e,
        "match": {
            k: m[k]
            for k in (
                "truth_pairs",
                "auto_merged",
                "tier_1_deterministic",
                "tier_2_fuzzy",
                "review_queue",
                "precision",
                "recall",
                "traps_merged",
            )
            if k in m
        },
    }
    (EXPORT / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    # spike.parquet from Phase 0 is superseded
    (EXPORT / "spike.parquet").unlink(missing_ok=True)
    print(json.dumps(manifest["match"]), f"| {time.perf_counter() - t0:.1f}s")
    print(pl.DataFrame({"table": list(e), "rows": [v["rows"] for v in e.values()]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
