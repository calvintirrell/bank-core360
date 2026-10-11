"""End-to-end checks on the pipeline outputs. The pipeline runs once per session (about 3 s)."""

from __future__ import annotations

import csv
import json
import subprocess
import sys

import duckdb
import polars as pl
import pytest

from pipeline import BATCHES, EXPORT, ROOT, SILVER, TRUTH, raw_dir
from pipeline.delta import read_table
from pipeline.lineage import LINEAGE


@pytest.fixture(scope="session", autouse=True)
def run_pipeline() -> None:
    subprocess.run([sys.executable, "-m", "pipeline"], cwd=ROOT, check=True, capture_output=True)


V0 = EXPORT / "v0"


@pytest.fixture(scope="session")
def con() -> duckdb.DuckDBPyConnection:
    """Views over the latest export, plus *_v0 views over the first batch."""
    c = duckdb.connect()
    for t in ("customer_360", "account_360", "transactions", "review_queue"):
        c.execute(f"CREATE VIEW {t} AS SELECT * FROM read_parquet('{EXPORT / (t + '.parquet')}')")
        c.execute(f"CREATE VIEW {t}_v0 AS SELECT * FROM read_parquet('{V0 / (t + '.parquet')}')")
    return c


@pytest.fixture(scope="session")
def manifest_v0() -> dict:
    return json.loads((V0 / "manifest.json").read_text())


@pytest.fixture(scope="session")
def match_report_v0() -> dict:
    return json.loads((V0 / "match_report.json").read_text())


@pytest.fixture(scope="session")
def changes() -> dict:
    return json.loads((EXPORT / "changes.json").read_text())


@pytest.fixture(scope="session")
def manifest() -> dict:
    return json.loads((EXPORT / "manifest.json").read_text())


@pytest.fixture(scope="session")
def match_report() -> dict:
    return json.loads((EXPORT / "match_report.json").read_text())


# --- shape and integrity ------------------------------------------------------------------------


def test_row_counts(con, manifest, manifest_v0):
    assert con.sql("SELECT count(*) FROM transactions_v0").fetchone()[0] == 50_000
    assert con.sql("SELECT count(*) FROM transactions").fetchone()[0] == manifest["generator"]["transactions"]
    for m, view in ((manifest_v0, "customer_360_v0"), (manifest, "customer_360")):
        n = con.sql(f"SELECT count(*) FROM {view}").fetchone()[0]
        assert n == m["export"]["customer_360"]["rows"]
        # unique people + true pairs that stay unmerged (one extra row each)
        unmatched_true_pairs = m["match"]["truth_pairs"] - m["match"]["auto_merged"]
        assert n == m["generator"]["unique_people"] + unmatched_true_pairs


def test_no_orphan_accounts_or_transactions(con):
    assert con.sql("SELECT count(*) FROM account_360 WHERE customer_key IS NULL").fetchone()[0] == 0
    assert con.sql("SELECT count(*) FROM transactions WHERE customer_key IS NULL").fetchone()[0] == 0
    assert (
        con.sql("SELECT count(*) FROM account_360 a LEFT JOIN customer_360 c USING (customer_key) WHERE c.customer_key IS NULL").fetchone()[
            0
        ]
        == 0
    )


def test_customer_key_unique_and_source_ids_unique(con):
    assert con.sql("SELECT count(*) - count(DISTINCT customer_key) FROM customer_360").fetchone()[0] == 0
    xref = read_table(SILVER, "customer_xref")
    assert xref.select(["source_system", "source_customer_id"]).n_unique() == xref.height


def test_balances_reconcile_to_raw(con):
    raw_a = con.sql(
        f"SELECT sum(CAST(CUR_BAL_CENTS AS BIGINT)) / 100.0 FROM read_csv('{raw_dir(BATCHES[-1]) / 'core_a' / 'ACCTMAST.psv'}', delim='|', header=true, all_varchar=true)"
    ).fetchone()[0]
    raw_b = con.sql(f"SELECT sum(balance) FROM read_json('{raw_dir(BATCHES[-1]) / 'core_b' / 'accounts.jsonl'}')").fetchone()[0]
    silver = con.sql("SELECT sum(balance) FROM account_360").fetchone()[0]
    assert abs(silver - (raw_a + raw_b)) < 0.01


def test_transaction_sign_convention(con):
    a = con.sql("SELECT min(amount), max(amount) FROM transactions WHERE source_system='core_a' AND direction='debit'").fetchone()
    assert a[1] < 0
    assert con.sql("SELECT count(*) FROM transactions WHERE (amount >= 0) != (direction = 'credit')").fetchone()[0] == 0


# --- entity resolution --------------------------------------------------------------------------


@pytest.mark.parametrize("which", ["v0", "latest"])
def test_match_quality_against_truth(which, match_report, match_report_v0):
    r = match_report_v0 if which == "v0" else match_report
    assert r["precision"] == 1.0, "no false merges allowed"
    assert r["recall"] >= 0.85  # 10 overlap pairs are designed to be undetectable
    assert r["traps_merged"] == 0
    assert r["tier_1_deterministic"] > r["tier_2_fuzzy"] > 0
    assert r["review_queue"] > 0


def test_reviewer_decisions_apply_only_from_batch_two(match_report, match_report_v0, changes):
    assert match_report_v0["confirmed_by_reviewer"] == 0 and match_report_v0["tier_3_confirmed"] == 0
    assert match_report["confirmed_by_reviewer"] == 5 and match_report["tier_3_confirmed"] == 5
    assert match_report["rejected_by_reviewer"] == 2
    assert match_report["auto_merged"] == match_report_v0["auto_merged"] + 5
    assert match_report["by_kind"]["trap_review"]["unmatched"] == 2
    assert match_report_v0["by_kind"]["trap_review"]["review"] == 2
    assert changes["customers_merged_by_reviewer"] == 5 and changes["pairs_rejected_by_reviewer"] == 2


def test_changes_between_batches_are_sane(changes):
    assert changes["new_customers"] == 40
    assert changes["customers_after"] == changes["customers_before"] + 40 - 5
    assert 10 <= changes["address_changes"] <= 25
    assert changes["accounts_woke_up"] >= 8
    assert changes["accounts_went_quiet"] >= 12
    assert changes["transactions_in_new_month"] > 3000


def test_each_overlap_kind_lands_where_designed(match_report_v0):
    k = match_report_v0["by_kind"]
    assert k["clean"]["merged"] == 180
    assert k["nickname"]["merged"] == 30
    assert k["middle_hyphen"]["merged"] == 15
    assert k["ssn_missing"]["merged"] == 10
    assert k["lastname_changed_ssn_missing"]["review"] == 15
    assert k["trap"]["merged"] == 0
    # phone / postal-code boosts are decisive: same name + no SSN merges only while the contact
    # details still agree; once the person moved, it drops to review
    assert k["ssn_missing"]["merged"] == 10
    assert k["ssn_missing_moved"]["review"] == 10
    assert k["lastname_changed_ssn_missing_moved_newphone"]["unmatched"] == 10


def test_merged_customers_have_both_ids(con, manifest):
    bad = con.sql(
        "SELECT count(*) FROM customer_360 WHERE source_systems='core_a+core_b' AND (core_a_cif IS NULL OR core_b_customer_id IS NULL OR match_confidence IS NULL)"
    ).fetchone()[0]
    assert bad == 0
    assert (
        con.sql("SELECT count(*) FROM customer_360 WHERE source_systems='core_a+core_b'").fetchone()[0] == manifest["match"]["auto_merged"]
    )


# --- business rules -----------------------------------------------------------------------------


def test_dormancy_matches_generator_truth(con):
    with (TRUTH / "dormant_accounts.csv").open() as f:
        truth = {(r["core"], r["account_id"]) for r in csv.DictReader(f)}
    flagged = {
        ("A" if s == "core_a" else "B", i)
        for s, i in con.sql(
            "SELECT source_system, source_account_id FROM account_360_v0 WHERE is_dormant_180d AND product_type='checking'"
        ).fetchall()
    }
    # every designed-dormant account is flagged; a handful more may be dormant by chance
    # (all of an account's transactions happened to fall outside the 180-day window)
    assert truth <= flagged
    assert len(flagged - truth) <= 3


def test_gate_question_mortgage_and_dormant_checking(con):
    """The interview question: customers with a mortgage and a checking account dormant 6 months."""
    via_360 = con.sql("SELECT count(*) FROM customer_360 WHERE has_mortgage AND checking_dormant_180d").fetchone()[0]
    via_accounts = con.sql(
        """SELECT count(DISTINCT m.customer_key) FROM account_360 m JOIN account_360 c USING (customer_key)
           WHERE m.product_type='mortgage' AND m.is_open AND c.product_type='checking' AND c.is_dormant_180d"""
    ).fetchone()[0]
    assert via_360 == via_accounts > 0
    cross_core = con.sql(
        "SELECT count(*) FROM customer_360 WHERE has_mortgage AND checking_dormant_180d AND source_systems='core_a+core_b'"
    ).fetchone()[0]
    assert cross_core >= 20, "the cross-core case (mortgage in one core, dormant checking in the other) must be visible"


def test_as_of_consistent_with_generator():
    from data.generators.common import AS_OF as GEN_AS_OF
    from data.generators.common import AS_OF_2 as GEN_AS_OF_2

    assert [GEN_AS_OF, GEN_AS_OF_2] == BATCHES


def test_customer_keys_are_stable_across_batches(con):
    # every key present in both versions refers to the same Core A cif / Core B id
    bad = con.sql(
        """SELECT count(*) FROM customer_360_v0 a JOIN customer_360 b USING (customer_key)
           WHERE coalesce(a.core_a_cif, '') != coalesce(b.core_a_cif, '')
              OR (a.core_b_customer_id IS NOT NULL AND b.core_b_customer_id IS NOT NULL AND a.core_b_customer_id != b.core_b_customer_id)"""
    ).fetchone()[0]
    assert bad == 0


def test_review_queue_is_unmerged_pairs(con, match_report):
    n = con.sql("SELECT count(*) FROM review_queue").fetchone()[0]
    assert n == match_report["review_queue"] > 0
    assert con.sql("SELECT count(*) FROM review_queue WHERE core_a_customer_key = core_b_customer_key").fetchone()[0] == 0
    assert con.sql("SELECT count(*) FROM review_queue WHERE confidence < 0.55 OR confidence >= 0.80").fetchone()[0] == 0
    assert con.sql("SELECT count(*) FROM review_queue_v0").fetchone()[0] == match_report["review_queue"] + 5 + 2
    assert con.sql(
        "SELECT list(priority ORDER BY priority) = list(priority ORDER BY combined_balance DESC, confidence DESC) FROM review_queue"
    ).fetchone()[0]


def test_emails_match_surnames(con):
    """Core B-only people have an email built from their own surname. Allowed exceptions: the 5
    same-name traps (another person's name, own email) and the 25 designed last-name-change cases
    that stay unmerged (review queue or undetectable), whose email keeps the maiden surname."""
    bad = con.sql(
        "SELECT count(*) FROM customer_360 WHERE source_systems = 'core_b' AND email IS NOT NULL AND NOT contains(email, lower(last_name))"
    ).fetchone()[0]
    assert bad <= 30
    assert con.sql("SELECT count(*) FROM customer_360 WHERE source_systems = 'core_a' AND email IS NOT NULL").fetchone()[0] == 0


def test_quality_checks_all_pass():
    q = json.loads((EXPORT / "quality.json").read_text())
    assert q["passed"] is True
    assert len(q["checks"]) >= 8
    for c in q["checks"]:
        assert c["passed"], c["id"]
        assert c["plain"].endswith(".")


# --- lineage ------------------------------------------------------------------------------------


@pytest.mark.parametrize("table", ["customer_360", "account_360", "transactions", "review_queue"])
def test_every_exported_column_has_lineage(table):
    cols = pl.read_parquet_schema(EXPORT / f"{table}.parquet").keys()
    documented = LINEAGE["tables"][table]["columns"].keys()
    assert set(cols) == set(documented), f"lineage drift in {table}: {set(cols) ^ set(documented)}"


def test_every_column_has_a_plain_sentence():
    for table, t in LINEAGE["tables"].items():
        for name, c in t["columns"].items():
            assert c.get("plain", "").strip(), f"{table}.{name} has no plain-language sentence"
            assert c["plain"].endswith("."), f"{table}.{name} plain sentence should end with a period"


def test_lineage_rules_all_defined():
    rules = LINEAGE["rules"]
    for table in LINEAGE["tables"].values():
        for name, c in table["columns"].items():
            for r in c["rules"]:
                assert r in rules, f"{name} references undefined rule {r}"
            assert c["sources"], f"{name} has no source"
