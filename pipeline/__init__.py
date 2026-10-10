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
AS_OF = date(2026, 9, 30)  # business "as of" date for dormancy and recency rules
DORMANT_DAYS = 180
