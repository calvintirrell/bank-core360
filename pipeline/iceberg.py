"""Apache Iceberg mirror of the gold layer (5C). Delta remains the system of record; the same
gold tables are also written as Iceberg through a local SQLite catalog so a warehouse or BI tool
that speaks Iceberg can read them. Each batch becomes an Iceberg snapshot."""

from __future__ import annotations

import json
import shutil

import polars as pl
from pyiceberg.catalog import load_catalog

from pipeline import EXPORT, GOLD, LAKEHOUSE, get_as_of
from pipeline.delta import read_table

ICEBERG = LAKEHOUSE / "iceberg"
TABLES = ("customer_360", "account_360", "review_queue")


def _catalog():
    ICEBERG.mkdir(parents=True, exist_ok=True)
    return load_catalog(
        "local",
        type="sql",
        uri=f"sqlite:///{ICEBERG / 'catalog.db'}",
        warehouse=f"file://{ICEBERG / 'warehouse'}",
        init_catalog_tables="true",
    )


def run(fresh: bool) -> dict:
    if fresh and ICEBERG.exists():
        shutil.rmtree(ICEBERG)
    cat = _catalog()
    if ("gold",) not in cat.list_namespaces():
        cat.create_namespace("gold")
    info = {}
    for name in TABLES:
        df: pl.DataFrame = read_table(GOLD, name)
        arrow = df.to_arrow()
        ident = f"gold.{name}"
        if cat.table_exists(ident):
            tbl = cat.load_table(ident)
            tbl.overwrite(arrow)
        else:
            tbl = cat.create_table(ident, schema=arrow.schema)
            tbl.append(arrow)
        tbl = cat.load_table(ident)
        snaps = list(tbl.snapshots())
        # Deterministic summary only: snapshot ids and metadata file names carry UUIDs and would
        # make the export differ on every run, which the CI commit rule treats as a data change.
        info[name] = {
            "metadata_dir": f"lakehouse/iceberg/warehouse/gold/{name}/metadata",
            "snapshots": len(snaps),
            "rows": len(arrow),
            "as_of": get_as_of().isoformat(),
        }
    return info


def write_summary(info: dict) -> None:
    payload = {
        "format": "Apache Iceberg (pyiceberg, SQLite catalog)",
        "catalog": "lakehouse/iceberg/catalog.db",
        "warehouse": "lakehouse/iceberg/warehouse",
        "tables": info,
        "why": "Delta Lake is the system of record here; the Iceberg mirror lets a warehouse, query engine or BI tool that standardises on Iceberg read the same gold tables without a copy job.",
    }
    (EXPORT / "iceberg.json").write_text(json.dumps(payload, indent=1) + "\n")
