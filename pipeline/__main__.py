"""Entry point: `uv run python -m pipeline` (generates raw feeds, then bronze -> silver -> match
-> gold -> export). Every output is deterministic for a given SEED."""

from __future__ import annotations

import json
import sys
import time

import polars as pl

from pipeline import AS_OF, EXPORT, GOLD, SEED, SILVER, agent_prompt, bronze, gold, lineage, match, replay, silver
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
    tables = {"customer_360": c360, "account_360": a360, "transactions": txns, "review_queue": read_table(GOLD, "review_queue")}
    out = {}
    for name, df in tables.items():
        df.write_parquet(EXPORT / f"{name}.parquet", compression="zstd", statistics=True)
        out[name] = {"rows": df.height, "columns": df.columns}
    return out


def raw_samples(n: int = 4) -> dict:
    """First rows of every raw feed, exactly as received, so the UI can show the two cores side by side."""
    from pipeline import RAW

    out: dict = {}
    for system in ("core_a", "core_b"):
        out[system] = {}
        for path in sorted((RAW / system).iterdir()):
            lines = path.read_text().splitlines()
            if path.suffix == ".psv":
                cols = lines[0].split("|")
                rows = [ln.split("|") for ln in lines[1 : 1 + n]]
            else:
                recs = [json.loads(ln) for ln in lines[:n]]
                cols = list(recs[0].keys())
                rows = [[v if isinstance(v, str) else json.dumps(v) for v in r.values()] for r in recs]
            out[system][path.name] = {"columns": cols, "rows": rows, "total_rows": len(lines) - (1 if path.suffix == ".psv" else 0)}
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
    (EXPORT / "raw_samples.json").write_text(json.dumps(raw_samples(), indent=1) + "\n")
    agent_prompt.write()
    r = replay.write()
    manifest = {
        "schema_version": 1,
        "seed": SEED,
        "as_of": AS_OF.isoformat(),
        "bronze": b,
        "silver": s,
        "gold": g,
        "export": e,
        "replay": r,
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
