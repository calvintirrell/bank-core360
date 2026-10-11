"""System prompt for the question-answering agent, generated from lineage.json so the schema the
model sees is exactly the schema that ships. Used by the browser (live) and by replay.py (CI)."""

from __future__ import annotations

from pipeline import DORMANT_DAYS, get_as_of, version_dir
from pipeline.lineage import LINEAGE

TOOL_NAME = "run_sql"
TOOL_DESCRIPTION = (
    "Run one read-only DuckDB SQL query against the customer-360 lakehouse and get the result. "
    "Tables: customer_360, account_360, transactions. Use LIMIT (max 200). Returns columns, the first rows and the total row count."
)
TOOL_SCHEMA = {
    "type": "object",
    "properties": {"sql": {"type": "string", "description": "A single SELECT or WITH query in DuckDB SQL."}},
    "required": ["sql"],
    "additionalProperties": False,
}

COLUMN_TYPES = {
    "customer_360": {
        "customer_key": "text",
        "full_name": "text",
        "first_name": "text",
        "last_name": "text",
        "dob": "date",
        "email": "text",
        "phone": "text",
        "city": "text",
        "state": "text",
        "postal_code": "text",
        "customer_since": "date",
        "is_active": "boolean",
        "source_systems": "text ('core_a' | 'core_b' | 'core_a+core_b')",
        "in_core_a": "boolean",
        "in_core_b": "boolean",
        "core_a_cif": "text",
        "core_b_customer_id": "text",
        "match_tier": "integer (1 deterministic, 2 fuzzy, 3 confirmed by a reviewer, null single-core)",
        "match_confidence": "double 0-1",
        "open_accounts": "integer",
        "has_checking": "boolean",
        "has_savings": "boolean",
        "has_mortgage": "boolean",
        "has_cd": "boolean",
        "deposit_balance": "double",
        "loan_balance": "double",
        "last_activity_ts": "timestamp",
        "txn_count_90d": "integer",
        "checking_last_txn_ts": "timestamp",
        "checking_dormant_180d": "boolean",
    },
    "account_360": {
        "customer_key": "text",
        "source_system": "text ('core_a' | 'core_b')",
        "source_account_id": "text",
        "source_customer_id": "text",
        "product_type": "text ('checking' | 'savings' | 'mortgage' | 'cd')",
        "product_category": "text ('deposit' | 'loan')",
        "source_product_code": "text",
        "opened_on": "date",
        "balance": "double",
        "is_open": "boolean",
        "last_txn_ts": "timestamp",
        "days_since_last_txn": "integer",
        "txn_count_90d": "integer",
        "txn_count_180d": "integer",
        "txn_count_365d": "integer",
        "credits_365d": "double",
        "debits_365d": "double",
        "is_dormant_180d": "boolean",
    },
    "transactions": {
        "customer_key": "text",
        "source_system": "text",
        "source_txn_id": "text",
        "source_account_id": "text",
        "txn_ts": "timestamp",
        "amount": "double (credits positive, debits negative)",
        "memo": "text",
        "direction": "text ('credit' | 'debit')",
    },
    "review_queue": {
        "priority": "integer (1 = most money at stake)",
        "core_a_customer_key": "text",
        "core_b_customer_key": "text",
        "core_a_cif": "text",
        "core_b_customer_id": "text",
        "core_a_name": "text",
        "core_b_name": "text",
        "dob": "date",
        "confidence": "double 0.55-0.80",
        "name_similarity": "double 0-1",
        "ssn_signal": "double (1 equal, 0.5 missing)",
        "core_b_ssn_missing": "boolean",
        "phone_match": "boolean",
        "postal_code_match": "boolean",
        "core_a_balance": "double",
        "core_b_balance": "double",
        "combined_balance": "double",
        "core_a_open_accounts": "integer",
        "core_b_open_accounts": "integer",
    },
}


def build_prompt() -> str:
    lines = [
        (
            "You are the analyst for a bank's customer-360 lakehouse that merges two core banking systems: "
            f"{LINEAGE['systems']['core_a']['label']} and {LINEAGE['systems']['core_b']['label']}. "
            "A banker or operations lead asks a question in plain English. You answer it with data."
        ),
        "",
        "How to work:",
        f"1. Write one DuckDB SQL query and run it with the {TOOL_NAME} tool. Prefer a single query; run a second only if the first result needs refining. Never more than 3.",
        "2. Read-only SELECT/WITH only. Always include LIMIT (at most 200) unless the query is a pure aggregate.",
        "3. Then answer in 1-3 short sentences with the key numbers, followed by at most two bullet caveats that cite rule ids (for example G-10 for dormancy).",
        "   The user already sees the full result table next to your answer, so never repeat rows as a markdown table or a long list; name at most three examples inline.",
        "4. If the question cannot be answered from these tables, say so and suggest the closest question you can answer.",
        "5. Be concrete and brief. No preamble.",
        "6. End with one final line exactly in the form `Follow-ups: <question> | <question> | <question>` with two or three short, natural next questions the same person might ask. Nothing after that line.",
        "",
        (
            "Names: in the story shown to users, Core A is Harbor Bank (the legacy, acquiring bank) and Core B is Riverside Bank "
            "(the acquired bank). Users may say Harbor, Riverside, 'the acquired bank' or 'the legacy system'. In answers, say "
            "Harbor Bank or Riverside Bank and give the core id once in parentheses, for example 'Riverside Bank (Core B)'."
        ),
        "",
        f"As-of date for all recency and dormancy rules: {get_as_of().isoformat()}. 'Dormant' means an open account with no transactions in the {DORMANT_DAYS} days before as-of (rule G-10).",
        "'6 months' or 'half a year' of inactivity maps to checking_dormant_180d / is_dormant_180d. The transactions feed covers the 365 days before as-of; nothing older exists.",
        "",
        "Tables (DuckDB SQL). customer_360 / account_360 / transactions are the resolved data; review_queue lists cross-core candidate pairs that were NOT merged (ER-05) and still appear as two separate customer_360 rows.",
    ]
    for table, cols in COLUMN_TYPES.items():
        grain = LINEAGE["tables"][table]["grain"]
        lines.append(f"\n{table}  -- {grain}")
        for col, typ in cols.items():
            meta = LINEAGE["tables"][table]["columns"][col]
            lines.append(f"  {col}: {typ}  -- {meta['transform']}")
    lines += [
        "",
        "Rules referenced by lineage (cite by id when relevant):",
    ]
    for rid in ("ER-03", "ER-04", "ER-05", "ER-08", "G-01", "G-02", "G-05", "G-06", "G-10", "G-11", "G-20", "S-10", "S-11"):
        lines.append(f"  {rid}: {LINEAGE['rules'][rid]}")
    lines += [
        "",
        (
            "Notes: source_systems = 'core_a+core_b' means the person was found in both cores by entity resolution. "
            "customer_360.checking_dormant_180d is true if ANY open checking account is dormant (rule G-11), so a customer can also "
            "show recent activity on another checking account; use account_360 for per-account detail. "
            "Core A stores no email, so email is null for Core A-only customers. Balances are dollars. All data is synthetic."
        ),
    ]
    return "\n".join(lines) + "\n"


def write() -> None:
    import json

    out = version_dir()
    out.mkdir(parents=True, exist_ok=True)
    (out / "agent_prompt.md").write_text(build_prompt())
    tool = {"name": TOOL_NAME, "description": TOOL_DESCRIPTION, "input_schema": TOOL_SCHEMA, "strict": True}
    (out / "agent_tool.json").write_text(json.dumps(tool, indent=1) + "\n")
