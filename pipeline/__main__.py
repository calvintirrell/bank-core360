"""Entry point: `uv run python -m pipeline`. Generates both raw batches, then for each batch runs
bronze -> silver -> match -> gold -> lineage -> prompt -> export -> quality (the first batch creates
every Delta table at version 0, the second overwrites it as version 1), then builds the replay
cache on the latest batch and the change summary between the two. Deterministic for SEED."""

from __future__ import annotations

import json
import sys
import time

import polars as pl

from pipeline import (
    BATCHES,
    EXPORT,
    GOLD,
    SEED,
    SILVER,
    agent_prompt,
    bronze,
    gold,
    iceberg,
    lineage,
    match,
    quality,
    raw_dir,
    replay,
    set_as_of,
    silver,
    version_dir,
)
from pipeline.delta import read_table, table_version

TABLES = ("customer_360", "account_360", "transactions", "review_queue")


def export() -> dict[str, dict]:
    out = version_dir()
    out.mkdir(parents=True, exist_ok=True)
    c360 = read_table(GOLD, "customer_360")
    a360 = read_table(GOLD, "account_360")
    txns = (
        read_table(SILVER, "transactions")
        .join(a360.select(["source_system", "source_account_id", "customer_key"]), on=["source_system", "source_account_id"], how="left")
        .select(["customer_key", "source_system", "source_txn_id", "source_account_id", "txn_ts", "amount", "memo", "direction"])
        .sort(["source_system", "source_txn_id"])
    )
    tables = {"customer_360": c360, "account_360": a360, "transactions": txns, "review_queue": read_table(GOLD, "review_queue")}
    res = {}
    for name, df in tables.items():
        df.write_parquet(out / f"{name}.parquet", compression="zstd", statistics=True)
        res[name] = {"rows": df.height, "columns": df.columns}
    return res


def raw_samples(n: int = 4) -> dict:
    """First rows of every raw feed of the current batch, exactly as received, for the side-by-side view."""
    out: dict = {}
    for system in ("core_a", "core_b"):
        out[system] = {}
        for path in sorted((raw_dir() / system).iterdir()):
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


def changes(prev_dir, cur_dir) -> dict:
    """What changed between two exported versions, in numbers the page turns into sentences."""
    c0 = pl.read_parquet(prev_dir / "customer_360.parquet")
    c1 = pl.read_parquet(cur_dir / "customer_360.parquet")
    a0 = pl.read_parquet(prev_dir / "account_360.parquet")
    a1 = pl.read_parquet(cur_dir / "account_360.parquet")
    t1 = pl.read_parquet(cur_dir / "transactions.parquet")
    m0 = json.loads((prev_dir / "match_report.json").read_text())
    m1 = json.loads((cur_dir / "match_report.json").read_text())
    keys0, keys1 = set(c0["customer_key"]), set(c1["customer_key"])
    both = c0.select("customer_key", "postal_code", "city").join(
        c1.select("customer_key", "postal_code", "city"), on="customer_key", suffix="_new"
    )
    acct_key = ["source_system", "source_account_id"]
    d0 = a0.filter(pl.col("is_open")).select(acct_key + ["is_dormant_180d", "product_type"])
    d1 = a1.filter(pl.col("is_open")).select(acct_key + ["is_dormant_180d"])
    j = d0.join(d1, on=acct_key, suffix="_new")
    went_quiet = j.filter(~pl.col("is_dormant_180d") & pl.col("is_dormant_180d_new"))
    woke_up = j.filter(pl.col("is_dormant_180d") & ~pl.col("is_dormant_180d_new"))
    # reviewer decisions applied in THIS batch (dated after the previous as-of), not cumulative
    rows = m1.get("decisions", {}).get("rows", [])
    this_batch = [r for r in rows if r["status"] == "applied" and r["decided_on"] > m0["as_of"]]
    return {
        "from_as_of": m0["as_of"],
        "to_as_of": m1["as_of"],
        "customers_before": c0.height,
        "customers_after": c1.height,
        "new_customers": len(keys1 - keys0),
        "customers_merged_by_reviewer": sum(1 for r in this_batch if r["decision"] == "confirm"),
        "pairs_rejected_by_reviewer": sum(1 for r in this_batch if r["decision"] == "reject"),
        "review_queue_before": m0["review_queue"],
        "review_queue_after": m1["review_queue"],
        "address_changes": both.filter(pl.col("postal_code") != pl.col("postal_code_new")).height,
        "accounts_went_quiet": went_quiet.height,  # all products, open in both months
        "accounts_woke_up": woke_up.height,
        "checking_accounts_went_quiet": went_quiet.filter(pl.col("product_type") == "checking").height,
        "checking_accounts_woke_up": woke_up.filter(pl.col("product_type") == "checking").height,
        "new_accounts": a1.join(a0.select(acct_key), on=acct_key, how="anti").height,  # opened since, not a net figure
        "transactions_in_new_month": t1.filter(pl.col("txn_ts") > pl.lit(m0["as_of"]).str.to_datetime("%Y-%m-%d")).height,
        "deposits_before": round(c0["deposit_balance"].sum(), 2),
        "deposits_after": round(c1["deposit_balance"].sum(), 2),
    }


def main() -> int:
    t0 = time.perf_counter()
    from data.generators.__main__ import main as generate

    gen = generate()
    versions = []
    for i, as_of in enumerate(BATCHES):
        set_as_of(as_of)
        fresh = i == 0
        b = bronze.run(fresh)
        s = silver.run(fresh)
        m = match.run(fresh)
        g = gold.run(fresh)
        ice = iceberg.run(fresh)
        lineage.write()
        agent_prompt.write()
        e = export()
        q = quality.run()
        manifest = {
            "schema_version": 2,
            "seed": SEED,
            "as_of": as_of.isoformat(),
            "version": i,
            "is_latest": i == len(BATCHES) - 1,
            "versions": [{"as_of": d.isoformat(), "dir": "" if j == len(BATCHES) - 1 else f"v{j}"} for j, d in enumerate(BATCHES)],
            "delta_versions": {f"gold/{t}": table_version(GOLD, t) for t in ("customer_360", "account_360", "review_queue")},
            "iceberg": {t: {"snapshots": v["snapshots"], "rows": v["rows"]} for t, v in ice.items()},
            "generator": gen[as_of.isoformat()],
            "bronze": b,
            "silver": s,
            "gold": g,
            "export": e,
            "quality": {"checks": len(q), "passed": sum(1 for c in q if c["passed"])},
            "match": {
                k: m[k]
                for k in (
                    "truth_pairs",
                    "auto_merged",
                    "tier_1_deterministic",
                    "tier_2_fuzzy",
                    "tier_3_confirmed",
                    "review_queue",
                    "precision",
                    "recall",
                    "traps_merged",
                    "confirmed_by_reviewer",
                    "rejected_by_reviewer",
                )
                if k in m
            },
        }
        if not fresh:
            iceberg.write_summary(ice)
            (EXPORT / "raw_samples.json").write_text(json.dumps(raw_samples(), indent=1) + "\n")
            # `regenerated` is run state (how many transcripts this run rebuilt), not data: keep it out of
            # the manifest so a run that reuses every transcript leaves the export byte-identical.
            manifest["replay"] = {k: v for k, v in replay.write().items() if k != "regenerated"}
            ch = changes(version_dir(BATCHES[i - 1]), EXPORT)
            (EXPORT / "changes.json").write_text(json.dumps(ch, indent=1) + "\n")
            manifest["changes"] = ch
        (version_dir() / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        versions.append(manifest)
        print(f"[{as_of}] {json.dumps(manifest['match'])}")
    print(json.dumps(versions[-1].get("changes", {"batches": len(BATCHES)})), f"| {time.perf_counter() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
