"""Thin Delta Lake helpers (delta-rs). The first batch rebuilds every table (version 0); later
batches overwrite in place so each batch is one Delta version and the log holds the history."""

from __future__ import annotations

import shutil
from pathlib import Path

import polars as pl
from deltalake import DeltaTable, write_deltalake


def write_table(df: pl.DataFrame, layer: Path, name: str, description: str, fresh: bool = True) -> Path:
    """fresh=True rebuilds the table (version 0); fresh=False overwrites in place, which Delta records
    as a new version so the log holds the history (time travel)."""
    path = layer / name
    if fresh and path.exists():
        shutil.rmtree(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    write_deltalake(str(path), df.to_arrow(), mode="overwrite", name=name, description=description, schema_mode="overwrite")
    return path


def table_version(layer: Path, name: str) -> int:
    return DeltaTable(str(layer / name)).version()


def read_table(layer: Path, name: str) -> pl.DataFrame:
    return pl.from_arrow(DeltaTable(str(layer / name)).to_pyarrow_table())  # type: ignore[return-value]
