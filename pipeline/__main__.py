"""Entry point: `uv run python -m pipeline`."""

import json

import pyarrow as pa
import pyarrow.parquet as pq

from pipeline import EXPORT, SEED


def write_spike() -> None:
    """Phase 0 spike table: proves Parquet on GitHub Pages is queryable from DuckDB-WASM."""
    table = pa.table(
        {
            "core": ["A", "A", "B", "B", "B"],
            "customer_key": ["c-0001", "c-0002", "c-0003", "c-0004", "c-0005"],
            "product": ["checking", "mortgage", "checking", "savings", "mortgage"],
            "balance": [1250.42, 215000.00, 88.10, 5400.00, 310500.00],
        }
    )
    EXPORT.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, EXPORT / "spike.parquet", compression="zstd")


def write_manifest() -> None:
    """Deterministic manifest (no timestamps) so unchanged code never produces a new commit."""
    manifest = {"schema_version": 0, "seed": SEED, "tables": {"spike": {"rows": 5}}}
    (EXPORT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    write_spike()
    write_manifest()
    print(f"wrote {EXPORT}")
