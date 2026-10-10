# Bank Core 360

Two mismatched banking cores, one governed customer-360 lakehouse, queryable in plain English with lineage on every answer. Static, runs on GitHub Pages.

**Live:** https://calvintirrell.github.io/bank-core360/

Status: Phase 0 (scaffold and spikes). The product note, architecture diagram, and demo land in later phases.

## Layout

```
data/generators/   synthetic Core A (legacy) and Core B (acquired bank) feeds, seeded
pipeline/          bronze -> silver -> gold (Delta Lake) -> Parquet export + lineage
lakehouse/         committed pipeline outputs, including the Delta transaction logs
site/              Vite + React + TypeScript; DuckDB-WASM query layer and the agent UI
tests/             pytest
.github/workflows  pipeline -> commit outputs -> build site -> deploy Pages
```

## Run locally

```
.tools/bin/uv sync
.tools/bin/uv run python -m pipeline
cd site && pnpm install && pnpm dev
```
