"""Replay cache: the canned questions with SQL, results, lineage and (when an API key is present)
the model's own transcript, so the demo works for visitors with no key and after the daily cap.

Without ANTHROPIC_API_KEY the cache still ships hand-authored SQL + real results, explanation
left null and flagged as pending. With a key, questions whose transcript is missing or whose
question/SQL changed are regenerated; unchanged ones are reused so CI commits stay quiet."""

from __future__ import annotations

import hashlib
import json
import os
from typing import Any

import duckdb

from pipeline import EXPORT
from pipeline.agent_prompt import TOOL_DESCRIPTION, TOOL_NAME, TOOL_SCHEMA, build_prompt

MODEL = "claude-opus-5-5"
MAX_ROWS = 25
MAX_TOOL_ROWS = 50
MAX_CALLS = 4

QUESTIONS: list[dict[str, str]] = [
    {
        "id": "mortgage-dormant-checking",
        "question": "Which customers have a mortgage with us and a checking account that has been dormant for six months?",
        "sql": """SELECT customer_key, full_name, source_systems, loan_balance, checking_last_txn_ts
FROM customer_360
WHERE has_mortgage AND checking_dormant_180d
ORDER BY loan_balance DESC
LIMIT 25""",
    },
    {
        "id": "cross-core-confidence",
        "question": "How many customers exist in both cores, and how confident are we in those matches?",
        "sql": """SELECT match_tier, count(*) AS customers,
       round(min(match_confidence), 2) AS min_confidence,
       round(avg(match_confidence), 3) AS avg_confidence
FROM customer_360
WHERE source_systems = 'core_a+core_b'
GROUP BY 1
ORDER BY 1""",
    },
    {
        "id": "deposits-by-state",
        "question": "What are the top five states by total deposit balance?",
        "sql": """SELECT state, count(*) AS customers, round(sum(deposit_balance), 2) AS deposits
FROM customer_360
GROUP BY 1
ORDER BY deposits DESC
LIMIT 5""",
    },
    {
        "id": "dormant-checking-by-core",
        "question": "How many checking accounts are dormant, split by which core they live in?",
        "sql": """SELECT source_system, count(*) AS open_checking,
       sum(CASE WHEN is_dormant_180d THEN 1 ELSE 0 END) AS dormant,
       round(100.0 * sum(CASE WHEN is_dormant_180d THEN 1 ELSE 0 END) / count(*), 1) AS dormant_pct
FROM account_360
WHERE product_type = 'checking' AND is_open
GROUP BY 1
ORDER BY 1""",
    },
    {
        "id": "acquired-bank-large-mortgages",
        "question": "Which customers came only from the acquired bank and hold a mortgage over $400,000?",
        "sql": """SELECT customer_key, full_name, state, loan_balance, open_accounts
FROM customer_360
WHERE source_systems = 'core_b' AND has_mortgage AND loan_balance > 400000
ORDER BY loan_balance DESC
LIMIT 25""",
    },
    {
        "id": "review-queue-priority",
        "question": "Which pairs in the review queue should someone look at first?",
        "sql": """SELECT priority, core_a_name, core_b_name, dob, confidence, core_b_ssn_missing,
       phone_match, postal_code_match, combined_balance
FROM review_queue
ORDER BY priority
LIMIT 25""",
    },
    {
        "id": "credit-debit-mix",
        "question": "What share of transactions in each core are credits versus debits?",
        "sql": """SELECT source_system, direction, count(*) AS transactions,
       round(100.0 * count(*) / sum(count(*)) OVER (PARTITION BY source_system), 1) AS pct,
       round(sum(amount), 2) AS total_amount
FROM transactions
GROUP BY 1, 2
ORDER BY 1, 2""",
    },
]


def _connect() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    for t in ("customer_360", "account_360", "transactions", "review_queue"):
        con.execute(f"CREATE VIEW {t} AS SELECT * FROM read_parquet('{EXPORT / (t + '.parquet')}')")
    return con


def _jsonable(v: Any) -> Any:
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


def run_query(con: duckdb.DuckDBPyConnection, sql: str, max_rows: int) -> dict:
    rel = con.execute(sql)
    cols = [d[0] for d in rel.description]
    rows = rel.fetchall()
    return {
        "columns": cols,
        "rows": [[_jsonable(v) for v in r] for r in rows[:max_rows]],
        "row_count": len(rows),
    }


def _fingerprint(q: dict[str, str]) -> str:
    return hashlib.sha256((q["question"] + "\n" + q["sql"] + "\n" + build_prompt()).encode()).hexdigest()[:16]


def _agent_transcript(con: duckdb.DuckDBPyConnection, question: str, api_key: str) -> dict:
    """Runs the same tool loop the browser runs, server-side, and records it."""
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    tools = [{"name": TOOL_NAME, "description": TOOL_DESCRIPTION, "input_schema": TOOL_SCHEMA, "strict": True}]
    messages: list[dict] = [{"role": "user", "content": question}]
    steps: list[dict] = []
    calls = 0
    usage = {"input_tokens": 0, "output_tokens": 0}
    final_text = ""
    while calls < MAX_CALLS:
        calls += 1
        res = client.messages.create(
            model=MODEL,
            max_tokens=2048,
            system=build_prompt(),
            tools=tools,
            messages=messages,
            output_config={"effort": "low"},
        )
        usage["input_tokens"] += res.usage.input_tokens
        usage["output_tokens"] += res.usage.output_tokens
        messages.append({"role": "assistant", "content": [b.model_dump() for b in res.content]})
        if res.stop_reason == "tool_use":
            results = []
            for b in res.content:
                if b.type != "tool_use":
                    continue
                sql = str(b.input.get("sql", ""))
                try:
                    out = run_query(con, sql, MAX_TOOL_ROWS)
                    steps.append({"sql": sql, "result": out, "error": None})
                    results.append({"type": "tool_result", "tool_use_id": b.id, "content": json.dumps(out, default=str)})
                except Exception as e:  # noqa: BLE001
                    steps.append({"sql": sql, "result": None, "error": str(e)})
                    results.append({"type": "tool_result", "tool_use_id": b.id, "content": str(e), "is_error": True})
            messages.append({"role": "user", "content": results})
            continue
        final_text = "".join(b.text for b in res.content if b.type == "text").strip()
        break
    return {"model": MODEL, "calls": calls, "usage": usage, "steps": steps, "explanation": final_text or None}


def write() -> dict:
    path = EXPORT / "replay.json"
    existing: dict[str, dict] = {}
    if path.exists():
        try:
            existing = {e["id"]: e for e in json.loads(path.read_text())["questions"]}
        except Exception:  # noqa: BLE001
            existing = {}
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    con = _connect()
    out = []
    regenerated = 0
    for q in QUESTIONS:
        fp = _fingerprint(q)
        entry = {
            "id": q["id"],
            "question": q["question"],
            "fingerprint": fp,
            "sql": q["sql"],
            "result": run_query(con, q["sql"], MAX_ROWS),
            "agent": None,
        }
        prev = existing.get(q["id"])
        if prev and prev.get("fingerprint") == fp and prev.get("agent"):
            entry["agent"] = prev["agent"]
        elif api_key:
            entry["agent"] = _agent_transcript(con, q["question"], api_key)
            regenerated += 1
        out.append(entry)
    payload = {"schema_version": 1, "questions": out}
    path.write_text(json.dumps(payload, indent=1, default=str) + "\n")
    return {"questions": len(out), "with_transcript": sum(1 for e in out if e["agent"]), "regenerated": regenerated}
