"""bank-core360 pipeline: two mismatched banking cores -> bronze -> silver -> gold (Delta) -> export.

Stages (each writes Delta tables under lakehouse/, rebuilt from scratch every run):
  bronze  land the raw feeds as-is with ingest metadata
  silver  standardize types, dates, product taxonomy, names, phones; one schema per entity
  match   entity resolution across cores (deterministic + fuzzy tiers, confidence scored)
  gold    customer_360 / account_360 with survivorship rules and dormancy flags
  export  gold + silver transactions as plain Parquet for the browser, plus lineage + reports
"""

from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAKEHOUSE = ROOT / "lakehouse"
RAW = LAKEHOUSE / "raw"
BRONZE = LAKEHOUSE / "bronze"
SILVER = LAKEHOUSE / "silver"
GOLD = LAKEHOUSE / "gold"
EXPORT = LAKEHOUSE / "export"
TRUTH = ROOT / "data" / "truth"

SEED = 360
DORMANT_DAYS = 180

# Two batches: the initial load and a second month. Each batch is a Delta version of every table.
BATCHES: list[date] = [date(2026, 9, 30), date(2026, 10, 31)]
AS_OF = BATCHES[-1]  # the current as-of (latest batch)
_as_of = BATCHES[0]


def get_as_of() -> date:
    """The as-of date of the batch currently being processed (set by the orchestrator)."""
    return _as_of


def set_as_of(d: date) -> None:
    global _as_of
    _as_of = d


def raw_dir(as_of: date | None = None) -> Path:
    return RAW / (as_of or get_as_of()).isoformat()


def version_dir(as_of: date | None = None) -> Path:
    """Export directory for a batch: the latest batch exports to EXPORT itself, earlier ones to EXPORT/v<i>."""
    d = as_of or get_as_of()
    i = BATCHES.index(d)
    return EXPORT if i == len(BATCHES) - 1 else EXPORT / f"v{i}"
