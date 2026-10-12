"""Entry point: `uv run python -m data.generators` writes two batches of raw feeds under
lakehouse/raw/<as-of>/, the ground truth under data/truth/, and reviewer decisions under
data/decisions/. Batch 1 is the initial load; batch 2 is one month later with new customers,
address changes, October activity, accounts that went quiet or woke up, and human decisions on
the review queue."""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from pathlib import Path

from data.generators.common import (
    AS_OF,
    AS_OF_2,
    N_A,
    N_NEW_B2,
    N_OVERLAP,
    N_TRAP_REVIEW,
    N_TRAPS,
    N_TXNS,
    N_UNIQUE,
    PRODUCT_MIX,
    PRODUCTS,
    RAW,
    TRUTH,
    Person,
    build_people,
    make_person,
    make_rng,
    new_uuid,
    overlap_kind,
    vary_for_core_b,
)

DECISIONS = RAW.parent.parent / "data" / "decisions"
PROD_CODE_A = {"checking": "DDA", "savings": "SAV", "mortgage": "MTG", "cd": "CDA"}
PROD_TYPE_B = {"checking": "checking", "savings": "savings", "mortgage": "mortgage", "cd": "certificate_of_deposit"}
MEMOS_DEBIT = ["GROCERY MART", "FUEL STOP", "ONLINE RETAIL", "UTILITY PMT", "RESTAURANT", "PHARMACY", "ATM WITHDRAWAL", "STREAMING SVC"]
MEMOS_CREDIT = ["PAYROLL DEPOSIT", "TRANSFER IN", "MOBILE DEPOSIT", "INTEREST PAID", "REFUND"]
WEIGHT = {"checking": 20.0, "savings": 5.0, "mortgage": 12.0, "cd": 1.5}


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
    woke: bool = False  # batch 2: a designed-dormant account that becomes active again
    went_quiet: bool = False  # batch 2: an active checking account whose recent activity is dropped


@dataclass
class Txn:
    core: str
    acct_id: str
    ts: datetime
    amount: float
    credit: bool
    memo: str
    seq: int = 0
    uid: str = ""


@dataclass
class State:
    people: list[Person]
    cif_of: dict[int, str] = field(default_factory=dict)
    b_uuid_of: dict[int, str] = field(default_factory=dict)
    a_people: list[Person] = field(default_factory=list)
    b_people: list[tuple[Person, bool]] = field(default_factory=list)  # (rendering, has_ssn)
    accounts: list[Account] = field(default_factory=list)
    txns: list[Txn] = field(default_factory=list)
    truth: list[dict] = field(default_factory=list)
    acct_seq: int = 0
    txn_seq: int = 0


def main() -> dict:
    rng, fake = make_rng()
    people, first_names, seen_ssn = build_people(rng, fake)
    st = State(people=people)
    overlap = people[:N_OVERLAP]
    a_people = people[:N_A]
    b_only = people[N_A:N_UNIQUE]
    a_only = people[N_OVERLAP:N_A]

    # --- Core A customers -------------------------------------------------------------------
    order = list(a_people)
    rng.shuffle(order)
    for i, p in enumerate(order):
        st.cif_of[p.pid] = f"{10000000 + i * 7 + rng.randint(0, 6):08d}"
    st.a_people = list(a_people)

    # --- Core B customers: overlap renderings, traps, review traps, the rest ----------------
    for i, p in enumerate(overlap):
        pb, has_ssn, kind = vary_for_core_b(p, overlap_kind(i), rng, fake)  # kind = the variation actually applied
        st.b_uuid_of[p.pid] = new_uuid(rng)
        st.b_people.append((pb, has_ssn))
        st.truth.append({"a_cif": st.cif_of[p.pid], "b_customer_id": st.b_uuid_of[p.pid], "kind": kind, "same_person": True})
    trap_targets = rng.sample(a_only, N_TRAPS + N_TRAP_REVIEW)
    for j, p in enumerate(b_only):
        if j < N_TRAPS:  # same name + DOB as an A-only person, own SSN -> hard reject (ER-02)
            t = trap_targets[j]
            p = replace(p, first=t.first, middle=t.middle, last=t.last, dob=t.dob)
            st.b_uuid_of[p.pid] = new_uuid(rng)
            st.b_people.append((p, True))
            st.truth.append({"a_cif": st.cif_of[t.pid], "b_customer_id": st.b_uuid_of[p.pid], "kind": "trap", "same_person": False})
        elif j < N_TRAPS + N_TRAP_REVIEW:  # same name + DOB, SSN missing, different contact -> review queue
            t = trap_targets[j]
            p = replace(p, first=t.first, middle=t.middle, last=t.last, dob=t.dob)
            st.b_uuid_of[p.pid] = new_uuid(rng)
            st.b_people.append((p, False))
            st.truth.append({"a_cif": st.cif_of[t.pid], "b_customer_id": st.b_uuid_of[p.pid], "kind": "trap_review", "same_person": False})
        else:
            st.b_uuid_of[p.pid] = new_uuid(rng)
            st.b_people.append((p, rng.random() > 0.05))

    # --- Accounts ---------------------------------------------------------------------------
    for p in a_people:
        add_accounts(st, rng, "A", p, st.cif_of[p.pid])
    for i, p in enumerate(overlap):
        add_accounts(st, rng, "B", p, st.b_uuid_of[p.pid], ["checking"] if i < 120 else None)
    for p in b_only:
        add_accounts(st, rng, "B", p, st.b_uuid_of[p.pid])
    for p in overlap[:120]:
        if not any(a.pid == p.pid and a.core == "A" and a.product == "mortgage" for a in st.accounts):
            st.acct_seq += 1
            opened = datetime.combine(p.since, datetime.min.time()) + timedelta(
                days=rng.randint(0, min(3000, max(0, (AS_OF - p.since).days)))
            )
            st.accounts.append(
                Account(
                    "A",
                    f"{2000000000 + st.acct_seq * 13:010d}",
                    st.cif_of[p.pid],
                    p.pid,
                    "mortgage",
                    opened,
                    round(rng.uniform(80_000, 500_000), 2),
                    False,
                )
            )

    # Dormancy at batch 1: ~10% of open checking accounts, cross-core ones first.
    open_checking = [a for a in st.accounts if a.product == "checking" and not a.closed]
    cross = [a for a in open_checking if a.core == "B" and a.pid < 120]
    for a in rng.sample(cross, min(40, len(cross))):
        a.dormant = True
    remaining = [a for a in open_checking if not a.dormant]
    target = int(0.10 * len(open_checking)) - sum(1 for a in open_checking if a.dormant)
    for a in rng.sample(remaining, max(0, target)):
        a.dormant = True

    # --- Transactions for the year before batch 1 ---------------------------------------------
    gen_transactions(st, rng, window_start=AS_OF - timedelta(days=365), window_end=AS_OF, n=N_TXNS)

    write_batch(st, AS_OF)
    write_truth(st)
    summary = {AS_OF.isoformat(): batch_summary(st, AS_OF)}

    # ====================== Batch 2: one month later ==========================================
    # New customers, half per core.
    new_people = [make_person(N_UNIQUE + k, rng, fake, first_names, seen_ssn) for k in range(N_NEW_B2)]
    for k, p in enumerate(new_people):
        p = replace(p, since=AS_OF + timedelta(days=rng.randint(1, 30)))
        st.people.append(p)
        if k % 2 == 0:
            st.cif_of[p.pid] = f"{10090000 + k * 7:08d}"
            st.a_people.append(p)
            add_accounts(st, rng, "A", p, st.cif_of[p.pid], opened_after=p.since)
        else:
            st.b_uuid_of[p.pid] = new_uuid(rng)
            st.b_people.append((p, True))
            add_accounts(st, rng, "B", p, st.b_uuid_of[p.pid], opened_after=p.since)
    # Address changes for 15 Core B-only customers.
    moved = 0
    for idx, (p, has_ssn) in enumerate(st.b_people):
        if p.pid >= N_A and p.pid < N_UNIQUE and moved < 15 and rng.random() < 0.05:
            st.b_people[idx] = (replace(p, street=fake.street_address(), city=fake.city(), zip=f"{rng.randint(10000, 99999)}"), has_ssn)
            moved += 1
    # Some quiet accounts wake up; some active checking accounts go quiet.
    designed_dormant = [a for a in st.accounts if a.dormant]
    for a in rng.sample(designed_dormant, 8):
        a.woke = True
    active_checking = [a for a in st.accounts if a.product == "checking" and not a.closed and not a.dormant and a.pid < N_UNIQUE]
    for a in rng.sample(active_checking, 12):
        a.went_quiet = True
    quiet_ids = {(a.core, a.acct_id) for a in st.accounts if a.went_quiet}
    cutoff = datetime.combine(AS_OF_2 - timedelta(days=190), datetime.min.time())
    st.txns = [t for t in st.txns if (t.core, t.acct_id) not in quiet_ids or t.ts < cutoff]
    # October activity: about one month's worth; dormant accounts stay quiet unless they woke.
    gen_transactions(st, rng, window_start=AS_OF + timedelta(days=1), window_end=AS_OF_2, n=round(N_TXNS / 12), october=True)
    # The batch-2 feed window is the 365 days before its as-of: drop anything older.
    oldest = datetime.combine(AS_OF_2 - timedelta(days=365), datetime.min.time())
    st.txns = [t for t in st.txns if t.ts >= oldest]

    # Reviewer decisions: confirm five true pairs from the queue, reject the two review traps.
    DECISIONS.mkdir(parents=True, exist_ok=True)
    confirm = [t for t in st.truth if t["kind"] in ("lastname_changed_ssn_missing", "ssn_missing_moved")][:5]
    reject = [t for t in st.truth if t["kind"] == "trap_review"]
    with (DECISIONS / "review_decisions.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["core_a_cif", "core_b_customer_id", "decision", "decided_on", "reviewer", "note"])
        w.writeheader()
        for t in confirm:
            w.writerow(
                {
                    "core_a_cif": t["a_cif"],
                    "core_b_customer_id": t["b_customer_id"],
                    "decision": "confirm",
                    "decided_on": "2026-10-10",
                    "reviewer": "ops-reviewer-1",
                    "note": "Same person: confirmed by call and ID on file",
                }
            )
        for t in reject:
            w.writerow(
                {
                    "core_a_cif": t["a_cif"],
                    "core_b_customer_id": t["b_customer_id"],
                    "decision": "reject",
                    "decided_on": "2026-10-12",
                    "reviewer": "ops-reviewer-1",
                    "note": "Different people: addresses and phones never matched",
                }
            )

    write_batch(st, AS_OF_2)
    summary[AS_OF_2.isoformat()] = batch_summary(st, AS_OF_2)
    summary[AS_OF_2.isoformat()].update(
        {
            "new_customers": N_NEW_B2,
            "address_changes": moved,
            "accounts_woke": 8,
            "accounts_went_quiet": 12,
            "decisions_confirm": len(confirm),
            "decisions_reject": len(reject),
        }
    )
    print(json.dumps(summary))
    return summary


def add_accounts(st: State, rng, core: str, p: Person, cust_id: str, force_products: list[str] | None = None, opened_after=None) -> None:
    n = rng.choices([1, 2, 3, 4], weights=[0.3, 0.4, 0.2, 0.1])[0]
    chosen: list[str] = list(force_products or [])
    while len(chosen) < n:
        prod = rng.choices(PRODUCTS, weights=PRODUCT_MIX)[0]
        if prod in chosen and prod != "cd":
            continue
        chosen.append(prod)
    for prod in chosen:
        st.acct_seq += 1
        start = opened_after or p.since
        span = max(1, ((AS_OF_2 if opened_after else AS_OF) - start).days)
        opened = datetime.combine(start, datetime.min.time()) + timedelta(days=rng.randint(0, span))
        balance = {
            "checking": round(rng.uniform(0, 25_000), 2),
            "savings": round(rng.uniform(0, 80_000), 2),
            "mortgage": round(rng.uniform(50_000, 600_000), 2),
            "cd": round(rng.uniform(1_000, 100_000), 2),
        }[prod]
        acct_id = f"{2000000000 + st.acct_seq * 13 + rng.randint(0, 12):010d}" if core == "A" else new_uuid(rng)
        st.accounts.append(Account(core, acct_id, cust_id, p.pid, prod, opened, balance, closed=(rng.random() < 0.04 and not opened_after)))


def gen_transactions(st: State, rng, window_start, window_end, n: int, october: bool = False) -> None:
    def eligible(a: Account) -> bool:
        if a.closed:
            return False
        if october:
            if a.went_quiet:
                return False
            if a.dormant and not a.woke:
                return False
        return True

    accts = [a for a in st.accounts if eligible(a)]
    weights = [WEIGHT[a.product] for a in accts]
    picks = rng.choices(range(len(accts)), weights=weights, k=max(0, n - (0 if october else len(accts))))
    if not october:
        picks += list(range(len(accts)))  # every account gets at least one transaction in batch 1
    else:
        picks += [i for i, a in enumerate(accts) if a.woke]  # a designed wake-up is not left to chance

    def window(a: Account) -> tuple[datetime, datetime] | None:
        """When this account may transact in this run: never before it opened; a designed-dormant
        account only before the quiet window. None if that leaves no time at all."""
        end = AS_OF - timedelta(days=181) if (not october and a.dormant) else window_end
        start_dt = max(datetime.combine(window_start, datetime.min.time()), a.opened)
        end_dt = datetime.combine(end, datetime.min.time())
        if start_dt >= end_dt:
            if not october and a.dormant:
                return None  # opened inside the quiet window: no batch-1 activity at all, still dormant
            end_dt = start_dt + timedelta(seconds=1)
        return start_dt, end_dt

    active = [i for i, a in enumerate(accts) if window(a) is not None]
    for idx in picks:
        a = accts[idx]
        w = window(a)
        while w is None:  # keep the designed transaction count: hand the pick to an account that can transact
            a = accts[rng.choice(active)]
            w = window(a)
        start_dt, end_dt = w
        ts = start_dt + timedelta(seconds=rng.randint(0, int((end_dt - start_dt).total_seconds())))
        if a.product == "mortgage":
            amount, credit, memo = round(rng.uniform(800, 3500), 2), False, "MORTGAGE PAYMENT"
        elif a.product == "cd":
            amount, credit, memo = round(rng.uniform(10, 400), 2), True, "INTEREST PAID"
        elif rng.random() < 0.3:
            amount, credit, memo = round(rng.uniform(500, 4000), 2), True, rng.choice(MEMOS_CREDIT)
        else:
            amount, credit, memo = round(rng.uniform(5, 500), 2), False, rng.choice(MEMOS_DEBIT)
        st.txn_seq += 1
        st.txns.append(Txn(a.core, a.acct_id, ts, amount, credit, memo, seq=st.txn_seq, uid=new_uuid(rng) if a.core == "B" else ""))


def write_batch(st: State, as_of) -> None:
    out = RAW / as_of.isoformat()
    a_dir, b_dir = out / "core_a", out / "core_b"
    a_dir.mkdir(parents=True, exist_ok=True)
    b_dir.mkdir(parents=True, exist_ok=True)
    a_rows = []
    for p in st.a_people:
        a_rows.append(
            {
                "CIF_NO": st.cif_of[p.pid],
                "CUST_NAME": f"{p.last.upper()}, {p.first.upper()} {p.middle}".rstrip(),
                "DOB": p.dob.strftime("%Y%m%d"),
                "SSN_LAST4": p.ssn4,
                "ADDR_LINE1": p.street.upper(),
                "CITY": p.city.upper(),
                "ST": p.state,
                "ZIP": p.zip,
                "PHONE": p.phone,
                "OPEN_DT": p.since.strftime("%Y%m%d"),
                "CUST_STAT": "C" if (p.pid * 7919) % 50 == 0 else "A",
            }
        )
    a_rows.sort(key=lambda r: r["CIF_NO"])
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
                for a in st.accounts
                if a.core == "A"
            ),
            key=lambda r: r["ACCT_NO"],
        ),
    )
    txns_a = sorted((t for t in st.txns if t.core == "A"), key=lambda t: t.seq)
    write_psv(
        a_dir / "TXNHIST.psv",
        [
            {
                "TXN_ID": f"A{t.seq:08d}",
                "ACCT_NO": t.acct_id,
                "TXN_DT": t.ts.strftime("%m/%d/%Y"),
                "AMT": f"{t.amount:.2f}",
                "DR_CR": "C" if t.credit else "D",
                "DESC": t.memo,
            }
            for t in txns_a
        ],
    )
    b_rows = []
    for p, has_ssn in st.b_people:
        created = datetime.combine(p.since, datetime.min.time()) + timedelta(seconds=(p.pid * 7331) % 86400)
        b_rows.append(
            {
                "customer_id": st.b_uuid_of[p.pid],
                "first_name": p.first,
                "middle_initial": p.middle or None,
                "last_name": p.last,
                "date_of_birth": p.dob.isoformat(),
                "ssn_last_four": p.ssn4 if has_ssn else None,
                "email": p.email,
                "phone": f"({p.phone[:3]}) {p.phone[3:6]}-{p.phone[6:]}",
                "address": {"street": p.street, "city": p.city, "state": p.state, "postal_code": p.zip},
                "created_at": created.isoformat() + "Z",
                "is_active": (p.pid * 104729) % 50 != 0,
            }
        )
    b_rows.sort(key=lambda r: r["customer_id"])
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
                for a in st.accounts
                if a.core == "B"
            ),
            key=lambda r: r["account_id"],
        ),
    )
    txns_b = sorted((t for t in st.txns if t.core == "B"), key=lambda t: t.uid)
    write_jsonl(
        b_dir / "transactions.jsonl",
        [
            {
                "transaction_id": t.uid,
                "account_id": t.acct_id,
                "posted_at": t.ts.isoformat() + "Z",
                "amount": t.amount if t.credit else -t.amount,
                "description": t.memo.title(),
                "category": "income" if t.credit else "spend",
            }
            for t in txns_b
        ],
    )


def write_truth(st: State) -> None:
    TRUTH.mkdir(parents=True, exist_ok=True)
    rows = sorted(st.truth, key=lambda r: (r["a_cif"], r["b_customer_id"]))
    with (TRUTH / "overlap.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["a_cif", "b_customer_id", "kind", "same_person"])
        w.writeheader()
        w.writerows(rows)
    (TRUTH / "dormant_accounts.csv").write_text(
        "core,account_id\n"
        + "".join(f"{a.core},{a.acct_id}\n" for a in sorted(st.accounts, key=lambda x: (x.core, x.acct_id)) if a.dormant)
    )


def batch_summary(st: State, as_of) -> dict:
    return {
        "as_of": as_of.isoformat(),
        "unique_people": len(st.people),
        "core_a_customers": len(st.a_people),
        "core_b_customers": len(st.b_people),
        "overlap": N_OVERLAP,
        "traps": N_TRAPS,
        "trap_review": N_TRAP_REVIEW,
        "accounts": len(st.accounts),
        "transactions": len(st.txns),
    }


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
