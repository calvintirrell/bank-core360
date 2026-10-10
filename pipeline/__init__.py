"""bank-core360 pipeline: two mismatched banking cores -> bronze -> silver -> gold (Delta) -> export.

Phase 0 ships only the export skeleton used by the DuckDB-WASM spike. Phases 1+ add the
generators, bronze/silver/gold stages, entity resolution and lineage.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAKEHOUSE = ROOT / "lakehouse"
EXPORT = LAKEHOUSE / "export"
SEED = 360  # every run is deterministic; identical code => identical bytes => no new commit
