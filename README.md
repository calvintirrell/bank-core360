# Bank Core 360

Two mismatched banking cores, one governed customer-360 lakehouse, queryable in plain English with lineage on every answer. Static, runs on GitHub Pages.

**Live:** https://calvintirrell.github.io/bank-core360/

Status: Phase 1 (data and pipeline) complete. The query UI, agent, product note and architecture diagram land in later phases.

## Layout

```
data/generators/   synthetic Core A (legacy) and Core B (acquired bank) feeds, seeded
data/truth/        generator ground truth, used only to score entity resolution
pipeline/          bronze -> silver -> match -> gold (Delta Lake) -> Parquet export + lineage
lakehouse/raw/     the two feeds exactly as a bank would hand them over
lakehouse/bronze|silver|gold/   Delta tables (open the _delta_log folders)
lakehouse/export/  gold Parquet + lineage.json + match_report.json + manifest.json
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

## Pipeline

| Layer | What happens | Tables |
|---|---|---|
| raw | Core A: pipe-delimited `CUSTMAST` / `ACCTMAST` / `TXNHIST` with CIF numbers, `YYYYMMDD` dates, product codes, balances in cents. Core B: JSON lines with UUIDs, ISO dates, nested addresses. | 6 files |
| bronze | Landed untouched, plus ingest metadata | 6 Delta tables |
| silver | One schema per entity: parsed dates, signed amounts, canonical product taxonomy, 10-digit phones, name keys | customers, accounts, transactions |
| match | Entity resolution across cores: DOB blocking, SSN conflict reject, tier 1 deterministic, tier 2 fuzzy with a 0-1 confidence, review queue below threshold. Scored against ground truth. | customer_xref, match_review_queue |
| gold | `customer_360` (one row per resolved customer, survivorship rules, product flags, dormancy) and `account_360` | 2 Delta tables |
| export | Plain Parquet for the browser, `lineage.json` mapping every gold column to its source core, field and transform rule | 3 Parquet + 3 JSON |

Every run is deterministic for the seed, so CI commits new data only when the code changed the outputs.
