"""Entry point: `uv run python -m data.generators` writes lakehouse/raw/** and data/truth/**."""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from data.generators.common import (
    AS_OF,
    N_A,
    N_OVERLAP,
    N_TRAPS,
    N_TXNS,
    N_UNIQUE,
    PRODUCT_MIX,
    PRODUCTS,
    RAW,
    TRUTH,
    Person,
    build_people,
    make_rng,
    new_uuid,
    overlap_kind,
    vary_for_core_b,
)

PROD_CODE_A = {"checking": "DDA", "savings": "SAV", "mortgage": "MTG", "cd": "CDA"}
PROD_TYPE_B = {"checking": "checking", "savings": "savings", "mortgage": "mortgage", "cd": "certificate_of_deposit"}
MEMOS_DEBIT = ["GROCERY MART", "FUEL STOP", "ONLINE RETAIL", "UTILITY PMT", "RESTAURANT", "PHARMACY", "ATM WITHDRAWAL", "STREAMING SVC"]
MEMOS_CREDIT = ["PAYROLL DEPOSIT", "TRANSFER IN", "MOBILE DEPOSIT", "INTEREST PAID", "REFUND"]


@dataclass
class Account:
    core: str
    acct_id: str
    cust_id: str
    pid: int
    product: str
    opened: datetime
    balance: float
    closed: bool
    dormant: bool = False


def main() -> None:
    rng, fake = make_rng()
    people = build_people(rng, fake)

    overlap = people[:N_OVERLAP]
    a_people = people[:N_A]
    b_only = people[N_A:N_UNIQUE]

    # --- Core A customers -------------------------------------------------------------------
    cif_of: dict[int, str] = {}
    a_rows = []
    order = list(a_people)
    rng.shuffle(order)
    for i, p in enumerate(order):
        cif = f"{10000000 + i * 7 + rng.randint(0, 6):08d}"
        cif_of[p.pid] = cif
        a_rows.append(
            {
                "CIF_NO": cif,
                "CUST_NAME": f"{p.last.upper()}, {p.first.upper()} {p.middle}".rstrip(),
                "DOB": p.dob.strftime("%Y%m%d"),
                "SSN_LAST4": p.ssn4,
                "ADDR_LINE1": p.street.upper(),
                "CITY": p.city.upper(),
                "ST": p.state,
                "ZIP": p.zip,
                "PHONE": p.phone,
                "OPEN_DT": p.since.strftime("%Y%m%d"),
                "CUST_STAT": "C" if rng.random() < 0.02 else "A",
            }
        )
    a_rows.sort(key=lambda r: r["CIF_NO"])

    # --- Core B customers -------------------------------------------------------------------
    b_uuid_of: dict[int, str] = {}
    b_rows = []
    truth_rows = []

    def b_customer(p: Person, has_ssn: bool) -> dict:
        uid = new_uuid(rng)
        b_uuid_of[p.pid] = uid
        created = datetime.combine(p.since, datetime.min.time()) + timedelta(seconds=rng.randint(0, 86399))
        return {
            "customer_id": uid,
            "first_name": p.first,
            "middle_initial": p.middle or None,
            "last_name": p.last,
            "date_of_birth": p.dob.isoformat(),
            "ssn_last_four": p.ssn4 if has_ssn else None,
            "email": p.email,
            "phone": f"({p.phone[:3]}) {p.phone[3:6]}-{p.phone[6:]}",
            "address": {"street": p.street, "city": p.city, "state": p.state, "postal_code": p.zip},
            "created_at": created.isoformat() + "Z",
            "is_active": rng.random() > 0.02,
        }

    for i, p in enumerate(overlap):
        kind = overlap_kind(i)
        pb, has_ssn = vary_for_core_b(p, kind, rng, fake)
        row = b_customer(pb, has_ssn)
        b_rows.append(row)
        truth_rows.append({"a_cif": cif_of[p.pid], "b_customer_id": row["customer_id"], "kind": kind, "same_person": True})

    # Traps: B-only people who share name + DOB with an A-only person but are different people.
    a_only = people[N_OVERLAP:N_A]
    trap_targets = rng.sample(a_only, N_TRAPS)
    for j, p in enumerate(b_only):
        if j < N_TRAPS:
            t = trap_targets[j]
            p = Person(**{**p.__dict__, "first": t.first, "middle": t.middle, "last": t.last, "dob": t.dob})
            row = b_customer(p, True)
            truth_rows.append({"a_cif": cif_of[t.pid], "b_customer_id": row["customer_id"], "kind": "trap", "same_person": False})
        else:
            row = b_customer(p, rng.random() > 0.05)
        b_rows.append(row)
    b_rows.sort(key=lambda r: r["customer_id"])

    # --- Accounts ---------------------------------------------------------------------------
    accounts: list[Account] = []
    acct_seq = 0

    def add_accounts(core: str, p: Person, cust_id: str, force_products: list[str] | None = None) -> None:
        nonlocal acct_seq
        n = rng.choices([1, 2, 3, 4], weights=[0.3, 0.4, 0.2, 0.1])[0]
        chosen: list[str] = list(force_products or [])
        while len(chosen) < n:
            prod = rng.choices(PRODUCTS, weights=PRODUCT_MIX)[0]
            if prod in chosen and prod != "cd":
                continue
            chosen.append(prod)
        for prod in chosen:
            acct_seq += 1
            opened = datetime.combine(p.since, datetime.min.time()) + timedelta(days=rng.randint(0, max(1, (AS_OF - p.since).days)))
            balance = {
                "checking": round(rng.uniform(0, 25_000), 2),
                "savings": round(rng.uniform(0, 80_000), 2),
                "mortgage": round(rng.uniform(50_000, 600_000), 2),
                "cd": round(rng.uniform(1_000, 100_000), 2),
            }[prod]
            acct_id = f"{2000000000 + acct_seq * 13 + rng.randint(0, 12):010d}" if core == "A" else new_uuid(rng)
            accounts.append(Account(core, acct_id, cust_id, p.pid, prod, opened, balance, closed=rng.random() < 0.04))

    for p in a_people:
        add_accounts("A", p, cif_of[p.pid])
    # Overlapping people: first 120 get a mortgage in A and a checking in B (the cross-core story).
    for i, p in enumerate(overlap):
        force = ["checking"] if i < 120 else None
        add_accounts("B", p, b_uuid_of[p.pid], force)
    for p in b_only:
        add_accounts("B", p, b_uuid_of[p.pid])
    for i, p in enumerate(overlap[:120]):
        if not any(a.pid == p.pid and a.core == "A" and a.product == "mortgage" for a in accounts):
            acct_seq += 1
            opened = datetime.combine(p.since, datetime.min.time()) + timedelta(days=rng.randint(0, 3000))
            accounts.append(
                Account(
                    "A",
                    f"{2000000000 + acct_seq * 13:010d}",
                    cif_of[p.pid],
                    p.pid,
                    "mortgage",
                    opened,
                    round(rng.uniform(80_000, 500_000), 2),
                    False,
                )
            )

    # Dormancy: ~10% of open checking accounts have no activity in the 180 days before AS_OF.
    open_checking = [a for a in accounts if a.product == "checking" and not a.closed]
    cross_core_candidates = [a for a in open_checking if a.core == "B" and a.pid < 120]
    for a in rng.sample(cross_core_candidates, min(40, len(cross_core_candidates))):
        a.dormant = True
    remaining = [a for a in open_checking if not a.dormant]
    target = int(0.10 * len(open_checking)) - sum(1 for a in open_checking if a.dormant)
    for a in rng.sample(remaining, max(0, target)):
        a.dormant = True

    # --- Transactions -----------------------------------------------------------------------
    weight = {"checking": 20.0, "savings": 5.0, "mortgage": 12.0, "cd": 1.5}
    weights = [0.0 if a.closed else weight[a.product] for a in accounts]
    picks = rng.choices(range(len(accounts)), weights=weights, k=N_TXNS - len(accounts))
    picks += list(range(len(accounts)))  # every account gets at least one transaction
    txns_a, txns_b = [], []
    seq_a = 0
    for idx in picks:
        a = accounts[idx]
        window_end = AS_OF - timedelta(days=181) if a.dormant else AS_OF
        window_start = AS_OF - timedelta(days=365)
        ts = datetime.combine(window_start, datetime.min.time()) + timedelta(
            seconds=rng.randint(0, max(1, int((window_end - window_start).total_seconds())))
        )
        if a.product == "mortgage":
            amount, credit, memo = round(rng.uniform(800, 3500), 2), False, "MORTGAGE PAYMENT"
        elif a.product == "cd":
            amount, credit, memo = round(rng.uniform(10, 400), 2), True, "INTEREST PAID"
        elif rng.random() < 0.3:
            amount, credit, memo = round(rng.uniform(500, 4000), 2), True, rng.choice(MEMOS_CREDIT)
        else:
            amount, credit, memo = round(rng.uniform(5, 500), 2), False, rng.choice(MEMOS_DEBIT)
        if a.core == "A":
            seq_a += 1
            txns_a.append(
                {
                    "TXN_ID": f"A{seq_a:08d}",
                    "ACCT_NO": a.acct_id,
                    "TXN_DT": ts.strftime("%m/%d/%Y"),
                    "AMT": f"{amount:.2f}",
                    "DR_CR": "C" if credit else "D",
                    "DESC": memo,
                }
            )
        else:
            txns_b.append(
                {
                    "transaction_id": new_uuid(rng),
                    "account_id": a.acct_id,
                    "posted_at": ts.isoformat() + "Z",
                    "amount": amount if credit else -amount,
                    "description": memo.title(),
                    "category": "income" if credit else "spend",
                }
            )
    txns_a.sort(key=lambda r: r["TXN_ID"])
    txns_b.sort(key=lambda r: r["transaction_id"])

    # --- Write Core A (pipe-delimited) ------------------------------------------------------
    a_dir, b_dir = RAW / "core_a", RAW / "core_b"
    a_dir.mkdir(parents=True, exist_ok=True)
    b_dir.mkdir(parents=True, exist_ok=True)
    write_psv(a_dir / "CUSTMAST.psv", a_rows)
    write_psv(
        a_dir / "ACCTMAST.psv",
        sorted(
            (
                {
                    "ACCT_NO": a.acct_id,
                    "CIF_NO": a.cust_id,
                    "PROD_CD": PROD_CODE_A[a.product],
                    "OPEN_DT": a.opened.strftime("%Y%m%d"),
                    "CUR_BAL_CENTS": str(round(a.balance * 100)),
                    "ACCT_STAT": "C" if a.closed else "O",
                }
                for a in accounts
                if a.core == "A"
            ),
            key=lambda r: r["ACCT_NO"],
        ),
    )
    write_psv(a_dir / "TXNHIST.psv", txns_a)

    # --- Write Core B (JSON lines) ----------------------------------------------------------
    write_jsonl(b_dir / "customers.jsonl", b_rows)
    write_jsonl(
        b_dir / "accounts.jsonl",
        sorted(
            (
                {
                    "account_id": a.acct_id,
                    "customer_id": a.cust_id,
                    "product_type": PROD_TYPE_B[a.product],
                    "opened_on": a.opened.date().isoformat(),
                    "balance": a.balance,
                    "currency": "USD",
                    "status": "closed" if a.closed else "open",
                }
                for a in accounts
                if a.core == "B"
            ),
            key=lambda r: r["account_id"],
        ),
    )
    write_jsonl(b_dir / "transactions.jsonl", txns_b)

    # --- Ground truth (used only to score entity resolution, never by the pipeline) ---------
    TRUTH.mkdir(parents=True, exist_ok=True)
    truth_rows.sort(key=lambda r: (r["a_cif"], r["b_customer_id"]))
    with (TRUTH / "overlap.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["a_cif", "b_customer_id", "kind", "same_person"])
        w.writeheader()
        w.writerows(truth_rows)
    (TRUTH / "dormant_accounts.csv").write_text(
        "core,account_id\n" + "".join(f"{a.core},{a.acct_id}\n" for a in sorted(accounts, key=lambda x: (x.core, x.acct_id)) if a.dormant)
    )

    print(
        f"core_a: {len(a_rows)} customers, {sum(1 for a in accounts if a.core == 'A')} accounts, {len(txns_a)} txns | "
        f"core_b: {len(b_rows)} customers, {sum(1 for a in accounts if a.core == 'B')} accounts, {len(txns_b)} txns | "
        f"overlap {N_OVERLAP}, traps {N_TRAPS}, dormant {sum(1 for a in accounts if a.dormant)}"
    )


def write_psv(path: Path, rows: list[dict]) -> None:
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), delimiter="|", lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def write_jsonl(path: Path, rows: list[dict]) -> None:
    with path.open("w") as f:
        for r in rows:
            f.write(json.dumps(r, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
