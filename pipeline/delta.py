"""Thin Delta Lake helpers (delta-rs). Tables are rebuilt from scratch each run so the log only
holds intentional versions, not one per CI execution."""

from __future__ import annotations

import shutil
from pathlib import Path

import polars as pl
from deltalake import DeltaTable, write_deltalake


def write_table(df: pl.DataFrame, layer: Path, name: str, description: str) -> Path:
    path = layer / name
    if path.exists():
        shutil.rmtree(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    write_deltalake(str(path), df.to_arrow(), mode="overwrite", name=name, description=description)
    return path


def read_table(layer: Path, name: str) -> pl.DataFrame:
    return pl.from_arrow(DeltaTable(str(layer / name)).to_pyarrow_table())  # type: ignore[return-value]
