"""Data-quality checks on the export, written to export/quality.json and enforced: the pipeline
fails if any check fails, so CI never commits data that would not pass. Each check carries a plain
sentence for the non-technical view and the SQL for the technical one."""

from __future__ import annotations

import json

import duckdb
import polars as pl

from pipeline import BATCHES, DORMANT_DAYS, SILVER, get_as_of, raw_dir, version_dir
from pipeline.lineage import LINEAGE


class QualityError(RuntimeError):
    pass


class KeyCollisionError(QualityError):
    """Two different source records hashed to the same customer_key (raised by the matcher, ER-07)."""


def _xref() -> pl.DataFrame:
    """The silver customer_xref of the current batch (source record -> customer_key)."""
    from pipeline.delta import read_table

    return read_table(SILVER, "customer_xref")


def _con() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    out = version_dir()
    for t in ("customer_360", "account_360", "transactions", "review_queue"):
        con.execute(f"CREATE VIEW {t} AS SELECT * FROM read_parquet('{out / (t + '.parquet')}')")
    con.register("customer_xref", _xref().to_arrow())
    i = BATCHES.index(get_as_of())
    if i > 0:
        prev = version_dir(BATCHES[i - 1])
        con.execute(f"CREATE VIEW customer_360_prev AS SELECT * FROM read_parquet('{prev / 'customer_360.parquet'}')")
    con.execute(
        f"CREATE VIEW raw_a_accounts AS SELECT * FROM read_csv('{raw_dir() / 'core_a' / 'ACCTMAST.psv'}', delim='|', header=true, all_varchar=true)"
    )
    con.execute(f"CREATE VIEW raw_b_accounts AS SELECT * FROM read_json('{raw_dir() / 'core_b' / 'accounts.jsonl'}')")
    return con


def run() -> list[dict]:
    con = _con()
    as_of = get_as_of()
    match = json.loads((version_dir() / "match_report.json").read_text())
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

    # Q-04 one key per person: checked on the source-record level (customer_xref), where a hash
    # collision or a double-used source record is visible, not on customer_360 where group-by hides it
    sql = """SELECT (SELECT count(*) - count(DISTINCT source_system || ':' || source_customer_id) FROM customer_xref)
                  + (SELECT count(*) FROM (
                        SELECT customer_key, count(*) AS records, count(matched_with) AS matched, count(DISTINCT source_system) AS systems
                        FROM customer_xref GROUP BY 1)
                     WHERE records > 1 AND NOT (records = 2 AND matched = 2 AND systems = 2))
                  + (SELECT count(*) - count(DISTINCT customer_key) FROM customer_360)"""
    n = con.execute(sql).fetchone()[0]
    check(
        "Q-04",
        "Nobody is listed twice",
        "Each bank record was used once, and a customer key is shared only by the two records of one matched person.",
        sql,
        n,
        0,
        n == 0,
        "Counts source records used twice, keys held by records that are not one matched Core A + Core B pair, and duplicate customer_360 keys",
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
    sql = f"SELECT count(*), min(txn_ts), max(txn_ts) FROM transactions WHERE txn_ts < TIMESTAMP '{as_of.isoformat()}' - INTERVAL 365 DAY OR txn_ts > TIMESTAMP '{as_of.isoformat()}' + INTERVAL 1 DAY"
    n = con.execute(sql).fetchone()[0]
    check(
        "Q-07",
        "Transactions fall inside the year of data",
        f"All transactions are dated within the 365 days before the as-of date, {as_of.isoformat()}.",
        sql,
        n,
        0,
        n == 0,
    )

    # Q-08 dormancy recomputed from the transactions themselves (not from the gold counters)
    sql = f"""SELECT count(*) FROM account_360 a
             LEFT JOIN (SELECT source_system, source_account_id, max(txn_ts) AS last_ts FROM transactions GROUP BY 1, 2) t
                    USING (source_system, source_account_id)
             WHERE a.is_dormant_180d != (a.is_open AND (t.last_ts IS NULL OR t.last_ts < TIMESTAMP '{as_of.isoformat()} 23:59:59.999999' - INTERVAL {DORMANT_DAYS} DAY))"""
    n = con.execute(sql).fetchone()[0]
    check(
        "Q-08",
        "'Quiet' means what it says",
        f"An account is flagged quiet exactly when it is open and the transaction list shows nothing in the {DORMANT_DAYS} days before the as-of date, never otherwise.",
        sql,
        n,
        0,
        n == 0,
        "Recomputed from max(txn_ts) per account in the exported transactions, independently of account_360.txn_count_180d",
    )

    # Q-09 customer keys stable across batches (ER-07)
    i = BATCHES.index(as_of)
    if i == 0:
        check(
            "Q-09",
            "People keep the same key from one month to the next",
            "This is the first load, so there is no earlier month to compare against yet.",
            None,
            "first load",
            "nothing to compare",
            True,
            "Evaluated from the second batch onwards",
        )
    else:
        sql = """SELECT (SELECT count(*) FROM customer_360_prev p JOIN customer_360 c ON p.core_a_cif = c.core_a_cif
                         WHERE p.customer_key != c.customer_key)
                      + (SELECT count(*) FROM customer_360_prev p JOIN customer_360 c ON p.core_b_customer_id = c.core_b_customer_id
                         WHERE p.customer_key != c.customer_key
                           AND NOT (p.source_systems = 'core_b' AND c.source_systems = 'core_a+core_b'))"""
        n = con.execute(sql).fetchone()[0]
        check(
            "Q-09",
            "People keep the same key from one month to the next",
            f"Every person present in both {BATCHES[i - 1].isoformat()} and {as_of.isoformat()} has the same customer key in both, so history lines up.",
            sql,
            n,
            0,
            n == 0,
            "A Riverside-only person whom a reviewer merged this month legitimately moves to the Harbor key (ER-07)",
        )

    # Q-10 customer-level checking flag agrees with the account level (G-11)
    sql = """SELECT count(*) FROM customer_360 c
             LEFT JOIN (SELECT customer_key, bool_or(is_dormant_180d) AS any_dormant FROM account_360
                        WHERE is_open AND product_type = 'checking' GROUP BY 1) a USING (customer_key)
             WHERE c.checking_dormant_180d != coalesce(a.any_dormant, false)"""
    n = con.execute(sql).fetchone()[0]
    check(
        "Q-10",
        "A person's 'quiet checking' flag matches their accounts",
        "A person is marked as having a quiet checking account exactly when at least one of their open checking accounts is quiet.",
        sql,
        n,
        0,
        n == 0,
        "customer_360.checking_dormant_180d versus bool_or(account_360.is_dormant_180d) over open checking accounts",
    )

    payload = {"as_of": as_of.isoformat(), "passed": all(c["passed"] for c in checks), "checks": checks}
    (version_dir() / "quality.json").write_text(json.dumps(payload, indent=1, default=str) + "\n")
    failed = [c["id"] for c in checks if not c["passed"]]
    if failed:
        raise QualityError(f"data quality checks failed: {failed}")
    return checks
