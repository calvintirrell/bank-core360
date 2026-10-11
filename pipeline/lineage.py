"""Column-level lineage for the gold layer, emitted as lakehouse/export/lineage.json.

Every gold column maps to the source core(s), source field(s), and the transform rule that
produced it. The UI reads this to badge query results; tests assert 100% coverage."""

from __future__ import annotations

import json

from pipeline import AS_OF, DORMANT_DAYS, EXPORT

A = "core_a"
B = "core_b"


def src(system: str, table: str, field: str) -> dict:
    return {"system": system, "table": table, "field": field}


def col(sources: list[dict], transform: str, rules: list[str], plain: str = "") -> dict:
    """plain = one sentence a non-technical reader understands; filled in by PLAIN below."""
    return {"sources": sources, "transform": transform, "rules": rules, "plain": plain}


BOTH_CUST = lambda fa, fb: [src(A, "CUSTMAST.psv", fa), src(B, "customers.jsonl", fb)]
BOTH_ACCT = lambda fa, fb: [src(A, "ACCTMAST.psv", fa), src(B, "accounts.jsonl", fb)]
BOTH_TXN = lambda fa, fb: [src(A, "TXNHIST.psv", fa), src(B, "transactions.jsonl", fb)]

RULES = {
    "S-01": "Core A CUST_NAME 'LAST, FIRST M' split into last / first / middle initial",
    "S-02": "Core A dates YYYYMMDD parsed to ISO date",
    "S-03": "Core B ISO-8601 dates / timestamps parsed; timestamps truncated to date where noted",
    "S-04": "Phone reduced to 10 digits (Core A already digits; Core B '(xxx) xxx-xxxx' stripped)",
    "S-05": "Core A CUST_STAT 'A' -> is_active true, else false",
    "S-06": "Core B nested address object flattened",
    "S-07": "Nickname canonicalization for matching only (Bill->William, Liz->Elizabeth, ...)",
    "S-08": "Name key = lowercase 'first last', hyphens to spaces; used for matching, not display",
    "S-10": "Product taxonomy: A DDA/SAV/MTG/CDA and B checking/savings/mortgage/certificate_of_deposit -> checking/savings/mortgage/cd",
    "S-11": "Core A CUR_BAL_CENTS integer cents / 100 -> dollars",
    "S-12": "Open flag: A ACCT_STAT 'O', B status 'open'",
    "S-13": "Product category: checking/savings/cd -> deposit, mortgage -> loan",
    "S-20": "Transaction time: A MM/DD/YYYY (date only, midnight), B ISO timestamp",
    "S-21": "Core A AMT + DR_CR -> signed amount (credit positive, debit negative); B already signed",
    "S-22": "Core A DESC upper-case memo title-cased",
    "S-23": "direction = credit if amount >= 0 else debit",
    "ER-01": "Blocking: candidate pairs must share date of birth",
    "ER-02": "Hard reject when both cores have SSN last-4 and they differ",
    "ER-03": "Tier 1 deterministic: equal name key and equal SSN last-4 -> confidence 1.00",
    "ER-04": "Tier 2 fuzzy: 0.40*name similarity (token-set ratio) + 0.30*ssn (1 equal / 0.5 missing) + 0.15*phone + 0.15*postal code; auto-merge >= 0.80",
    "ER-05": "Review queue: 0.55 <= confidence < 0.80, not merged",
    "ER-06": "Greedy one-to-one assignment by descending confidence",
    "ER-07": "customer_key surrogate: Core A records in CIF order, then unmatched Core B in id order",
    "G-01": "Survivorship: contact/name fields prefer Core B (newer system) when present in both",
    "G-02": "customer_since = earliest relationship date across cores",
    "G-03": "is_active = active in any core",
    "G-04": "source_systems = which cores contributed to this customer",
    "G-05": "deposit_balance = sum of open deposit-category balances",
    "G-06": "loan_balance = sum of open loan-category balances",
    "G-10": f"is_dormant_180d = open account with zero transactions in the {DORMANT_DAYS} days before {AS_OF.isoformat()}",
    "G-11": "checking_dormant_180d = any open checking account dormant per G-10",
    "G-20": "review_queue = candidate pairs scored 0.55-0.80 (ER-05), not merged; each side remains its own customer_360 row; priority = rank by combined balance",
}

CUSTOMER_360 = {
    "customer_key": col(
        BOTH_CUST("CIF_NO", "customer_id"), "entity resolution -> stable surrogate key", ["ER-01", "ER-03", "ER-04", "ER-06", "ER-07"]
    ),
    "full_name": col(BOTH_CUST("CUST_NAME", "first_name,last_name"), "first + last, Core B preferred", ["S-01", "G-01"]),
    "first_name": col(BOTH_CUST("CUST_NAME", "first_name"), "title case, Core B preferred", ["S-01", "G-01"]),
    "last_name": col(BOTH_CUST("CUST_NAME", "last_name"), "title case, Core B preferred", ["S-01", "G-01"]),
    "dob": col(BOTH_CUST("DOB", "date_of_birth"), "parsed to date", ["S-02", "S-03"]),
    "email": col([src(B, "customers.jsonl", "email")], "Core B only (Core A has no email)", ["G-01"]),
    "phone": col(BOTH_CUST("PHONE", "phone"), "10 digits, Core B preferred", ["S-04", "G-01"]),
    "city": col(BOTH_CUST("CITY", "address.city"), "title case, Core B preferred", ["S-06", "G-01"]),
    "state": col(BOTH_CUST("ST", "address.state"), "Core B preferred", ["S-06", "G-01"]),
    "postal_code": col(BOTH_CUST("ZIP", "address.postal_code"), "Core B preferred", ["S-06", "G-01"]),
    "customer_since": col(BOTH_CUST("OPEN_DT", "created_at"), "earliest across cores", ["S-02", "S-03", "G-02"]),
    "is_active": col(BOTH_CUST("CUST_STAT", "is_active"), "active in any core", ["S-05", "G-03"]),
    "source_systems": col(BOTH_CUST("CIF_NO", "customer_id"), "which cores contributed", ["G-04"]),
    "in_core_a": col([src(A, "CUSTMAST.psv", "CIF_NO")], "present in Core A", ["G-04"]),
    "in_core_b": col([src(B, "customers.jsonl", "customer_id")], "present in Core B", ["G-04"]),
    "core_a_cif": col([src(A, "CUSTMAST.psv", "CIF_NO")], "pass-through", []),
    "core_b_customer_id": col([src(B, "customers.jsonl", "customer_id")], "pass-through", []),
    "match_tier": col(
        BOTH_CUST("CUST_NAME,DOB,SSN_LAST4,PHONE,ZIP", "first_name,last_name,date_of_birth,ssn_last_four,phone,address.postal_code"),
        "1 deterministic / 2 fuzzy / null single-core",
        ["ER-03", "ER-04"],
    ),
    "match_confidence": col(
        BOTH_CUST("CUST_NAME,DOB,SSN_LAST4,PHONE,ZIP", "first_name,last_name,date_of_birth,ssn_last_four,phone,address.postal_code"),
        "0-1 score; 1.00 for tier 1",
        ["ER-03", "ER-04"],
    ),
    "open_accounts": col(BOTH_ACCT("ACCT_STAT", "status"), "count of open accounts", ["S-12"]),
    "has_checking": col(BOTH_ACCT("PROD_CD", "product_type"), "any open checking", ["S-10", "S-12"]),
    "has_savings": col(BOTH_ACCT("PROD_CD", "product_type"), "any open savings", ["S-10", "S-12"]),
    "has_mortgage": col(BOTH_ACCT("PROD_CD", "product_type"), "any open mortgage", ["S-10", "S-12"]),
    "has_cd": col(BOTH_ACCT("PROD_CD", "product_type"), "any open cd", ["S-10", "S-12"]),
    "deposit_balance": col(BOTH_ACCT("CUR_BAL_CENTS", "balance"), "sum of open deposit balances in dollars", ["S-11", "S-13", "G-05"]),
    "loan_balance": col(BOTH_ACCT("CUR_BAL_CENTS", "balance"), "sum of open loan balances in dollars", ["S-11", "S-13", "G-06"]),
    "last_activity_ts": col(BOTH_TXN("TXN_DT", "posted_at"), "max transaction time across open accounts", ["S-20"]),
    "txn_count_90d": col(BOTH_TXN("TXN_DT", "posted_at"), "transactions in the 90 days before as-of", ["S-20"]),
    "checking_last_txn_ts": col(BOTH_TXN("TXN_DT", "posted_at"), "max transaction time on open checking accounts", ["S-20"]),
    "checking_dormant_180d": col(
        BOTH_TXN("TXN_DT", "posted_at"), "any open checking account with no activity in 180 days", ["S-20", "G-10", "G-11"]
    ),
}

ACCOUNT_360 = {
    "customer_key": col(BOTH_ACCT("CIF_NO", "customer_id"), "joined through customer_xref", ["ER-07"]),
    "source_system": col(BOTH_ACCT("(file)", "(file)"), "which core the account lives in", []),
    "source_account_id": col(BOTH_ACCT("ACCT_NO", "account_id"), "pass-through", []),
    "source_customer_id": col(BOTH_ACCT("CIF_NO", "customer_id"), "pass-through", []),
    "product_type": col(BOTH_ACCT("PROD_CD", "product_type"), "canonical taxonomy", ["S-10"]),
    "product_category": col(BOTH_ACCT("PROD_CD", "product_type"), "deposit / loan", ["S-13"]),
    "source_product_code": col(BOTH_ACCT("PROD_CD", "product_type"), "pass-through of the source code", []),
    "opened_on": col(BOTH_ACCT("OPEN_DT", "opened_on"), "parsed to date", ["S-02", "S-03"]),
    "balance": col(BOTH_ACCT("CUR_BAL_CENTS", "balance"), "dollars", ["S-11"]),
    "is_open": col(BOTH_ACCT("ACCT_STAT", "status"), "open flag", ["S-12"]),
    "last_txn_ts": col(BOTH_TXN("TXN_DT", "posted_at"), "max transaction time", ["S-20"]),
    "days_since_last_txn": col(BOTH_TXN("TXN_DT", "posted_at"), "as-of minus last transaction", ["S-20"]),
    "txn_count_90d": col(BOTH_TXN("TXN_DT", "posted_at"), "count in the 90 days before as-of", ["S-20"]),
    "txn_count_180d": col(BOTH_TXN("TXN_DT", "posted_at"), "count in the 180 days before as-of", ["S-20"]),
    "txn_count_365d": col(BOTH_TXN("TXN_DT", "posted_at"), "count in the feed window", ["S-20"]),
    "credits_365d": col(BOTH_TXN("AMT,DR_CR", "amount"), "sum of positive amounts", ["S-21"]),
    "debits_365d": col(BOTH_TXN("AMT,DR_CR", "amount"), "sum of negative amounts", ["S-21"]),
    "is_dormant_180d": col(BOTH_TXN("TXN_DT", "posted_at"), "open and no transactions in 180 days", ["S-12", "S-20", "G-10"]),
}

TRANSACTIONS = {
    "customer_key": col(BOTH_ACCT("CIF_NO", "customer_id"), "joined through account -> customer_xref", ["ER-07"]),
    "source_system": col(BOTH_TXN("(file)", "(file)"), "which core", []),
    "source_txn_id": col(BOTH_TXN("TXN_ID", "transaction_id"), "pass-through", []),
    "source_account_id": col(BOTH_TXN("ACCT_NO", "account_id"), "pass-through", []),
    "txn_ts": col(BOTH_TXN("TXN_DT", "posted_at"), "timestamp", ["S-20"]),
    "amount": col(BOTH_TXN("AMT,DR_CR", "amount"), "signed dollars", ["S-21"]),
    "memo": col(BOTH_TXN("DESC", "description"), "title case", ["S-22"]),
    "direction": col(BOTH_TXN("DR_CR", "amount"), "credit / debit", ["S-23"]),
}

REVIEW_QUEUE = {
    "priority": col(BOTH_CUST("CIF_NO", "customer_id"), "1 = most money at stake", ["G-20"]),
    "core_a_customer_key": col([src(A, "CUSTMAST.psv", "CIF_NO")], "customer_key of the Core A side (unmerged)", ["ER-07", "G-20"]),
    "core_b_customer_key": col([src(B, "customers.jsonl", "customer_id")], "customer_key of the Core B side (unmerged)", ["ER-07", "G-20"]),
    "core_a_cif": col([src(A, "CUSTMAST.psv", "CIF_NO")], "pass-through", []),
    "core_b_customer_id": col([src(B, "customers.jsonl", "customer_id")], "pass-through", []),
    "core_a_name": col([src(A, "CUSTMAST.psv", "CUST_NAME")], "title case", ["S-01"]),
    "core_b_name": col([src(B, "customers.jsonl", "first_name,last_name")], "first + last", []),
    "dob": col(BOTH_CUST("DOB", "date_of_birth"), "shared date of birth (blocking key)", ["ER-01"]),
    "confidence": col(
        BOTH_CUST("CUST_NAME,SSN_LAST4,PHONE,ZIP", "first_name,last_name,ssn_last_four,phone,address.postal_code"),
        "tier 2 score",
        ["ER-04", "ER-05"],
    ),
    "name_similarity": col(BOTH_CUST("CUST_NAME", "first_name,last_name"), "token-set ratio of name keys, 0-1", ["S-07", "S-08", "ER-04"]),
    "ssn_signal": col(BOTH_CUST("SSN_LAST4", "ssn_last_four"), "1 equal, 0.5 missing on a side", ["ER-04"]),
    "core_b_ssn_missing": col([src(B, "customers.jsonl", "ssn_last_four")], "true when Core B has no SSN last-4", []),
    "phone_match": col(BOTH_CUST("PHONE", "phone"), "10-digit phones equal", ["S-04", "ER-04"]),
    "postal_code_match": col(BOTH_CUST("ZIP", "address.postal_code"), "postal codes equal", ["ER-04"]),
    "core_a_balance": col([src(A, "ACCTMAST.psv", "CUR_BAL_CENTS")], "deposits + loans of the Core A side", ["S-11", "G-05", "G-06"]),
    "core_b_balance": col([src(B, "accounts.jsonl", "balance")], "deposits + loans of the Core B side", ["G-05", "G-06"]),
    "combined_balance": col(BOTH_ACCT("CUR_BAL_CENTS", "balance"), "sum of both sides", ["G-20"]),
    "core_a_open_accounts": col([src(A, "ACCTMAST.psv", "ACCT_STAT")], "open accounts on the Core A side", ["S-12"]),
    "core_b_open_accounts": col([src(B, "accounts.jsonl", "status")], "open accounts on the Core B side", ["S-12"]),
}

LINEAGE = {
    "as_of": AS_OF.isoformat(),
    "systems": {
        A: {
            "plain": "Harbor Bank's system",
            "label": "Core A: Harbor Bank (legacy in-house core)",
            "conventions": "CIF numbers, YYYYMMDD dates, product codes DDA/SAV/MTG/CDA, balances in integer cents, pipe-delimited extracts, upper-case names",
        },
        B: {
            "plain": "Riverside Bank's system",
            "label": "Core B: Riverside Bank (acquired bank's core)",
            "conventions": "UUID ids, ISO-8601 dates, product_type strings, dollar balances, JSON lines with nested address",
        },
    },
    "rules": RULES,
    "tables": {
        "customer_360": {"grain": "one row per resolved customer", "columns": CUSTOMER_360},
        "account_360": {"grain": "one row per account", "columns": ACCOUNT_360},
        "transactions": {"grain": "one row per transaction", "columns": TRANSACTIONS},
        "review_queue": {"grain": "one row per unmerged cross-core candidate pair awaiting human review", "columns": REVIEW_QUEUE},
    },
}


# One sentence per column for the non-technical view. Tests assert every exported column has one.
PLAIN: dict[str, dict[str, str]] = {
    "customer_360": {
        "customer_key": "Our own id for one real person, assigned after the two banks' records were matched.",
        "full_name": "The person's name. If they were in both banks, Riverside Bank's spelling is shown.",
        "first_name": "First name, Riverside Bank's version when both banks have one.",
        "last_name": "Last name, Riverside Bank's version when both banks have one.",
        "dob": "Date of birth, converted from each bank's own date format.",
        "email": "Email address. Only Riverside Bank's system stores one, so Harbor-only customers have none.",
        "phone": "Phone number reduced to ten digits so both banks' formats compare.",
        "city": "City from the customer's address, Riverside Bank's version when both have one.",
        "state": "State from the customer's address, Riverside Bank's version when both have one.",
        "postal_code": "Postal code from the customer's address.",
        "customer_since": "The earliest date either bank had a relationship with this person.",
        "is_active": "Marked active if either bank considers the customer active.",
        "source_systems": "Which bank's records this person came from: Harbor, Riverside, or both.",
        "in_core_a": "Whether Harbor Bank's system has a record for this person.",
        "in_core_b": "Whether Riverside Bank's system has a record for this person.",
        "core_a_cif": "Harbor Bank's customer number for this person, if any.",
        "core_b_customer_id": "Riverside Bank's customer id for this person, if any.",
        "match_tier": "How the two banks' records were linked: 1 means an exact match on name and SSN digits, 2 means a close match scored by similarity.",
        "match_confidence": "How sure the matching was, from 0 to 1. Exact matches score 1.",
        "open_accounts": "How many open accounts the person has across both banks.",
        "has_checking": "Has at least one open checking account.",
        "has_savings": "Has at least one open savings account.",
        "has_mortgage": "Has at least one open mortgage.",
        "has_cd": "Has at least one open certificate of deposit.",
        "deposit_balance": "Total money in open checking, savings and CD accounts, in dollars.",
        "loan_balance": "Total owed on open loans, in dollars.",
        "last_activity_ts": "The most recent transaction on any of the person's open accounts.",
        "txn_count_90d": "Number of transactions in the 90 days before the as-of date.",
        "checking_last_txn_ts": "The most recent transaction on any open checking account.",
        "checking_dormant_180d": "True if at least one open checking account has had no transactions for 180 days.",
    },
    "account_360": {
        "customer_key": "Our own id for the person who holds this account.",
        "source_system": "Which bank's system the account lives in.",
        "source_account_id": "The account number as that bank's system records it.",
        "source_customer_id": "The customer id as that bank's system records it.",
        "product_type": "What kind of account it is, using one shared vocabulary for both banks.",
        "product_category": "Whether the account holds the customer's money (deposit) or ours (loan).",
        "source_product_code": "The product code exactly as that bank's system wrote it.",
        "opened_on": "The date the account was opened, converted from the bank's date format.",
        "balance": "Current balance in dollars. Harbor Bank stores cents, so those were divided by 100.",
        "is_open": "Whether the account is open today.",
        "last_txn_ts": "The most recent transaction on this account.",
        "days_since_last_txn": "Days between the last transaction and the as-of date.",
        "txn_count_90d": "Transactions in the 90 days before the as-of date.",
        "txn_count_180d": "Transactions in the 180 days before the as-of date.",
        "txn_count_365d": "Transactions in the whole year of data.",
        "credits_365d": "Money that came into the account over the year.",
        "debits_365d": "Money that left the account over the year.",
        "is_dormant_180d": "True if the account is open but has had no transactions for 180 days.",
    },
    "transactions": {
        "customer_key": "Our own id for the person whose account this transaction belongs to.",
        "source_system": "Which bank's system recorded the transaction.",
        "source_txn_id": "The transaction id as that bank's system recorded it.",
        "source_account_id": "The account number as that bank's system records it.",
        "txn_ts": "When the transaction happened, converted from each bank's date format.",
        "amount": "The amount in dollars. Money in is positive, money out is negative.",
        "memo": "The description on the transaction.",
        "direction": "Whether money came in (credit) or went out (debit).",
    },
    "review_queue": {
        "priority": "Our suggested order to review these pairs: most money at stake first.",
        "core_a_customer_key": "Our id for the Harbor Bank side of this possible duplicate.",
        "core_b_customer_key": "Our id for the Riverside Bank side of this possible duplicate.",
        "core_a_cif": "Harbor Bank's customer number for this record.",
        "core_b_customer_id": "Riverside Bank's customer id for this record.",
        "core_a_name": "The name as Harbor Bank has it.",
        "core_b_name": "The name as Riverside Bank has it.",
        "dob": "The date of birth both records share.",
        "confidence": "How likely the two records are the same person, from 0 to 1. Below 0.80 we ask a person instead of merging.",
        "name_similarity": "How alike the two names are, from 0 to 1.",
        "ssn_signal": "Whether the last four SSN digits agree (1) or are missing on one side (0.5).",
        "core_b_ssn_missing": "True when Riverside Bank has no SSN digits on file for this record.",
        "phone_match": "Whether the phone numbers agree.",
        "postal_code_match": "Whether the postal codes agree.",
        "core_a_balance": "Deposits plus loans on the Harbor Bank side.",
        "core_b_balance": "Deposits plus loans on the Riverside Bank side.",
        "combined_balance": "Money across both records together.",
        "core_a_open_accounts": "Open accounts on the Harbor Bank side.",
        "core_b_open_accounts": "Open accounts on the Riverside Bank side.",
    },
}

for _table, _cols in PLAIN.items():
    for _name, _plain in _cols.items():
        LINEAGE["tables"][_table]["columns"][_name]["plain"] = _plain


def write() -> None:
    EXPORT.mkdir(parents=True, exist_ok=True)
    (EXPORT / "lineage.json").write_text(json.dumps(LINEAGE, indent=2) + "\n")
