"""Data-quality checks on the export, written to export/quality.json and enforced: the pipeline
fails if any check fails, so CI never commits data that would not pass. Each check carries a plain
sentence for the non-technical view and the SQL for the technical one."""

from __future__ import annotations

import json

import duckdb

from pipeline import AS_OF, DORMANT_DAYS, EXPORT, RAW
from pipeline.lineage import LINEAGE


class QualityError(RuntimeError):
    pass


def _con() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    for t in ("customer_360", "account_360", "transactions", "review_queue"):
        con.execute(f"CREATE VIEW {t} AS SELECT * FROM read_parquet('{EXPORT / (t + '.parquet')}')")
    con.execute(
        f"CREATE VIEW raw_a_accounts AS SELECT * FROM read_csv('{RAW / 'core_a' / 'ACCTMAST.psv'}', delim='|', header=true, all_varchar=true)"
    )
    con.execute(f"CREATE VIEW raw_b_accounts AS SELECT * FROM read_json('{RAW / 'core_b' / 'accounts.jsonl'}')")
    return con


def run() -> list[dict]:
    con = _con()
    match = json.loads((EXPORT / "match_report.json").read_text())
    checks: list[dict] = []

    def check(cid: str, title: str, plain: str, sql: str | None, value, expected, passed: bool, detail: str = "") -> None:
        checks.append(
            {
                "id": cid,
                "title": title,
                "plain": plain,
                "sql": sql,
                "value": value,
                "expected": expected,
                "passed": bool(passed),
                "detail": detail,
            }
        )

    # Q-01 balances reconcile to the raw files
    sql = """SELECT round((SELECT sum(CAST(CUR_BAL_CENTS AS BIGINT)) / 100.0 FROM raw_a_accounts) + (SELECT sum(balance) FROM raw_b_accounts), 2) AS raw_total,
                    round((SELECT sum(balance) FROM account_360), 2) AS gold_total"""
    raw_total, gold_total = con.execute(sql).fetchone()
    diff = round(abs(raw_total - gold_total), 2)
    check(
        "Q-01",
        "Balances add up to the files the banks sent",
        "Every balance on this page, added together, equals the two banks' files to the cent.",
        sql,
        {"raw_total": raw_total, "gold_total": gold_total, "difference": diff},
        "difference < 0.01",
        diff < 0.01,
        "Harbor Bank cents / 100 plus Riverside Bank dollars versus the sum of account_360.balance",
    )

    # Q-02 every account has an owner
    sql = "SELECT count(*) FROM account_360 a LEFT JOIN customer_360 c USING (customer_key) WHERE c.customer_key IS NULL OR a.customer_key IS NULL"
    n = con.execute(sql).fetchone()[0]
    check("Q-02", "Every account belongs to a known person", "No account is floating without a customer behind it.", sql, n, 0, n == 0)

    # Q-03 every transaction has an account and a person
    sql = """SELECT count(*) FROM transactions t LEFT JOIN account_360 a ON a.source_system = t.source_system AND a.source_account_id = t.source_account_id
             WHERE a.source_account_id IS NULL OR t.customer_key IS NULL"""
    n = con.execute(sql).fetchone()[0]
    check("Q-03", "Every transaction belongs to a known account", "No money moved on an account we cannot find.", sql, n, 0, n == 0)

    # Q-04 one row per person, no duplicate ids
    sql = """SELECT (SELECT count(*) - count(DISTINCT customer_key) FROM customer_360)
                  + (SELECT count(core_a_cif) - count(DISTINCT core_a_cif) FROM customer_360)
                  + (SELECT count(core_b_customer_id) - count(DISTINCT core_b_customer_id) FROM customer_360)"""
    n = con.execute(sql).fetchone()[0]
    check(
        "Q-04",
        "Nobody is listed twice",
        "Each person has exactly one entry, and no bank record was used for two people.",
        sql,
        n,
        0,
        n == 0,
    )

    # Q-05 lineage coverage
    cols = {
        t: {r[0] for r in con.execute(f"DESCRIBE {t}").fetchall()} for t in ("customer_360", "account_360", "transactions", "review_queue")
    }
    missing = [
        f"{t}.{c}"
        for t, cs in cols.items()
        for c in cs
        if c not in LINEAGE["tables"][t]["columns"] or not LINEAGE["tables"][t]["columns"][c].get("plain")
    ]
    check(
        "Q-05",
        "Every number can be traced to its source",
        "Every column on this page names the bank system it came from, the field, and the rule applied, in plain words.",
        None,
        {"columns": sum(len(c) for c in cols.values()), "missing": missing},
        "0 missing",
        not missing,
    )

    # Q-06 matching scored against the answer key
    check(
        "Q-06",
        "The matching made no wrong merges",
        f"Checked against the answer key: {match['auto_merged']} merges, {match['false_positives']} wrong, {match['traps_merged']} of the same-name traps fooled it.",
        None,
        {"precision": match["precision"], "false_positives": match["false_positives"], "traps_merged": match["traps_merged"]},
        "precision = 1.0 and 0 traps merged",
        match["precision"] == 1.0 and match["traps_merged"] == 0,
    )

    # Q-07 transactions within the feed window
    sql = f"SELECT count(*), min(txn_ts), max(txn_ts) FROM transactions WHERE txn_ts < TIMESTAMP '{AS_OF.isoformat()}' - INTERVAL 365 DAY OR txn_ts > TIMESTAMP '{AS_OF.isoformat()}' + INTERVAL 1 DAY"
    n = con.execute(sql).fetchone()[0]
    check(
        "Q-07",
        "Transactions fall inside the year of data",
        f"All transactions are dated within the 365 days before the as-of date, {AS_OF.isoformat()}.",
        sql,
        n,
        0,
        n == 0,
    )

    # Q-08 dormancy flag consistent with activity
    sql = "SELECT count(*) FROM account_360 WHERE is_dormant_180d != (is_open AND txn_count_180d = 0)"
    n = con.execute(sql).fetchone()[0]
    check(
        "Q-08",
        "'Quiet' means what it says",
        f"An account is flagged quiet exactly when it is open and had no transactions in the {DORMANT_DAYS} days before the as-of date, never otherwise.",
        sql,
        n,
        0,
        n == 0,
    )

    payload = {"as_of": AS_OF.isoformat(), "passed": all(c["passed"] for c in checks), "checks": checks}
    (EXPORT / "quality.json").write_text(json.dumps(payload, indent=1, default=str) + "\n")
    failed = [c["id"] for c in checks if not c["passed"]]
    if failed:
        raise QualityError(f"data quality checks failed: {failed}")
    return checks
