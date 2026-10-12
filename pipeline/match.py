"""Entity resolution across cores (rule ids ER-xx, referenced by lineage.json).

Blocking:   candidate pairs share an exact date of birth (ER-01).
Hard reject: both sides have SSN last-4 and they differ (ER-02).
Tier 1:     name_key equal after standardization (nicknames, hyphens, case) and SSN last-4 equal
            -> confidence 1.00, auto-merge (ER-03).
Tier 2:     confidence = 0.40*name_similarity + 0.30*ssn + 0.15*phone + 0.15*postal_code,
            where ssn = 1 if equal, 0.5 if missing on either side; auto-merge at >= 0.80 (ER-04).
Review:     0.55 <= confidence < 0.80 -> not merged, listed in the review queue (ER-05).
One-to-one: greedy assignment by confidence, each source record merges at most once (ER-06).
Keys:       customer_key = stable surrogate hashed from the source id; a merged pair takes the Core A key (ER-07).
            Two different source records can never share a key: a hash collision stops the pipeline
            (KeyCollisionError) instead of silently folding two people into one row.
Decisions:  data/decisions/review_decisions.csv holds human decisions on queued pairs; a confirmed
            pair merges as tier 3 (confidence 1.0) and a rejected pair can never merge (ER-08).
            Only decisions dated on or before the batch's as-of date apply; later ones are reported
            as pending. A decision is honoured whether or not the matcher scored the pair itself
            (a reviewer can confirm a pair the rules could not see); a decision naming an id that
            is not in the batch is reported as ignored. Every decision's status is in the match
            report, so nothing is dropped silently; a malformed row stops the pipeline.
"""

from __future__ import annotations

import csv
import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import date

import polars as pl
from rapidfuzz import fuzz

from pipeline import DECISIONS, SILVER, TRUTH, get_as_of, version_dir
from pipeline.delta import read_table, write_table
from pipeline.quality import KeyCollisionError

AUTO_MERGE = 0.80
REVIEW_FLOOR = 0.55
W_NAME, W_SSN, W_PHONE, W_ZIP = 0.40, 0.30, 0.15, 0.15


@dataclass
class Candidate:
    a_id: str
    b_id: str
    name_similarity: float
    ssn_signal: float
    phone_match: bool
    zip_match: bool
    confidence: float
    tier: int | None  # 1, 2, or None (review)


def score_pairs(cust: pl.DataFrame) -> list[Candidate]:
    a = cust.filter(pl.col("source_system") == "core_a")
    b = cust.filter(pl.col("source_system") == "core_b")
    cols = ["source_customer_id", "name_key", "ssn_last4", "phone_digits", "postal_code", "dob"]
    pairs = a.select(cols).join(b.select(cols), on="dob", suffix="_b")  # ER-01 blocking on DOB
    out: list[Candidate] = []
    for r in pairs.iter_rows(named=True):
        ssn_a, ssn_b = r["ssn_last4"], r["ssn_last4_b"]
        if ssn_a and ssn_b and ssn_a != ssn_b:
            continue  # ER-02
        name_sim = fuzz.token_set_ratio(r["name_key"], r["name_key_b"]) / 100.0
        ssn_signal = 1.0 if (ssn_a and ssn_b) else 0.5
        phone = r["phone_digits"] == r["phone_digits_b"]
        zipm = r["postal_code"] == r["postal_code_b"]
        if r["name_key"] == r["name_key_b"] and ssn_signal == 1.0:
            conf, tier = 1.0, 1  # ER-03
        else:
            conf = round(W_NAME * name_sim + W_SSN * ssn_signal + W_PHONE * phone + W_ZIP * zipm, 4)
            tier = 2 if conf >= AUTO_MERGE else None  # ER-04 / ER-05
        if conf >= REVIEW_FLOOR:
            out.append(Candidate(r["source_customer_id"], r["source_customer_id_b"], name_sim, ssn_signal, phone, zipm, conf, tier))
    return out


@dataclass
class Decision:
    core_a_cif: str
    core_b_customer_id: str
    decision: str  # confirm | reject
    decided_on: date
    reviewer: str
    status: str = "pending"  # applied | pending (dated after this batch) | ignored_unknown_id
    was_candidate: bool | None = None  # did the matcher score this pair itself?


def load_decisions() -> list[Decision]:
    """ER-08: every row of review_decisions.csv, validated. Dates are parsed (not compared as text)
    and an unknown decision value or a malformed date stops the pipeline instead of being skipped."""
    path = DECISIONS / "review_decisions.csv"
    if not path.exists():
        return []
    out: list[Decision] = []
    with path.open() as f:
        for n, r in enumerate(csv.DictReader(f), start=2):
            if r["decision"] not in ("confirm", "reject"):
                raise ValueError(f"{path.name} line {n}: decision must be confirm or reject, got {r['decision']!r}")
            try:
                decided_on = date.fromisoformat(r["decided_on"])
            except ValueError as e:
                raise ValueError(f"{path.name} line {n}: decided_on must be an ISO date, got {r['decided_on']!r}") from e
            out.append(Decision(r["core_a_cif"].strip(), r["core_b_customer_id"].strip(), r["decision"], decided_on, r.get("reviewer", "")))
    return out


def _pair_features(cust: pl.DataFrame, a_id: str, b_id: str) -> Candidate:
    """Score one named pair the way score_pairs would, for a reviewer-confirmed pair the blocking
    rule never put in front of the scorer (different DOB on file, for instance)."""
    a = cust.filter((pl.col("source_system") == "core_a") & (pl.col("source_customer_id") == a_id)).row(0, named=True)
    b = cust.filter((pl.col("source_system") == "core_b") & (pl.col("source_customer_id") == b_id)).row(0, named=True)
    name_sim = fuzz.token_set_ratio(a["name_key"], b["name_key"]) / 100.0
    ssn_signal = 1.0 if (a["ssn_last4"] and b["ssn_last4"]) else 0.5
    return Candidate(a_id, b_id, name_sim, ssn_signal, a["phone_digits"] == b["phone_digits"], a["postal_code"] == b["postal_code"], 1.0, 3)


def apply_decisions(cust: pl.DataFrame, candidates: list[Candidate], decisions: list[Decision]) -> list[Candidate]:
    """ER-08. Sets each decision's status in place and returns the candidate list with confirmed
    pairs promoted to tier 3 (added if the scorer never saw them) and rejected pairs removed."""
    as_of = get_as_of()
    a_ids = set(cust.filter(pl.col("source_system") == "core_a")["source_customer_id"].to_list())
    b_ids = set(cust.filter(pl.col("source_system") == "core_b")["source_customer_id"].to_list())
    by_pair = {(c.a_id, c.b_id): c for c in candidates}
    rejected: set[tuple[str, str]] = set()
    for d in decisions:
        pair = (d.core_a_cif, d.core_b_customer_id)
        if d.decided_on > as_of:
            d.status = "pending"
            continue
        if d.core_a_cif not in a_ids or d.core_b_customer_id not in b_ids:
            d.status = "ignored_unknown_id"
            continue
        d.status = "applied"
        d.was_candidate = pair in by_pair
        if d.decision == "confirm":
            c = by_pair.get(pair)
            if c is None:
                c = _pair_features(cust, *pair)
                candidates.append(c)
                by_pair[pair] = c
            c.tier, c.confidence = 3, 1.0
        else:
            rejected.add(pair)
    return [c for c in candidates if (c.a_id, c.b_id) not in rejected]


def decisions_summary(decisions: list[Decision]) -> dict:
    counts = {s: sum(1 for d in decisions if d.status == s) for s in ("applied", "pending", "ignored_unknown_id")}
    return {
        "total": len(decisions),
        **counts,
        "confirm_applied": sum(1 for d in decisions if d.status == "applied" and d.decision == "confirm"),
        "reject_applied": sum(1 for d in decisions if d.status == "applied" and d.decision == "reject"),
        "rows": [{**asdict(d), "decided_on": d.decided_on.isoformat()} for d in decisions],
    }


KEY_DIGITS = 7


def stable_key(system: str, source_id: str) -> str:
    """C + KEY_DIGITS digits from a hash of the source id (ER-07). The key space is small on purpose
    (readable keys); `assert_keys_unique` refuses a collision rather than hoping for none."""
    digest = hashlib.sha1(f"{system}:{source_id}".encode()).hexdigest()
    return f"C{int(digest[:10], 16) % 10**KEY_DIGITS:0{KEY_DIGITS}d}"


def assert_keys_unique(rows: list[dict]) -> int:
    """Every key is owned by exactly one source record, except that a merged pair shares the Core A
    key by design. Returns the number of keys issued; raises KeyCollisionError on any collision."""
    owner: dict[str, tuple[str, str]] = {}
    for r in rows:
        if r["source_system"] == "core_b" and r["matched_with"] is not None:
            continue  # takes its Core A partner's key (ER-07)
        me = (r["source_system"], r["source_customer_id"])
        other = owner.setdefault(r["customer_key"], me)
        if other != me:
            raise KeyCollisionError(f"customer_key {r['customer_key']} hashed from both {other} and {me}; widen KEY_DIGITS")
    return len(owner)


def resolve(cust: pl.DataFrame) -> tuple[pl.DataFrame, pl.DataFrame, dict]:
    decisions = load_decisions()
    candidates = apply_decisions(cust, score_pairs(cust), decisions)  # ER-08, before the greedy pass
    candidates.sort(key=lambda c: (-c.confidence, c.a_id, c.b_id))
    used_a: set[str] = set()
    used_b: set[str] = set()
    merged: dict[str, Candidate] = {}  # b_id -> candidate
    review: list[Candidate] = []
    for c in candidates:  # ER-06 greedy one-to-one
        if c.a_id in used_a or c.b_id in used_b:
            continue
        if c.tier is None:
            review.append(c)
            continue
        used_a.add(c.a_id)
        used_b.add(c.b_id)
        merged[c.b_id] = c

    # ER-07 stable surrogate keys: derived from the source id, so a customer keeps the same key
    # across batches whatever else is added, merged or removed. Merged pairs take the Core A key.
    a_ids = sorted(cust.filter(pl.col("source_system") == "core_a")["source_customer_id"].to_list())
    b_ids = sorted(cust.filter(pl.col("source_system") == "core_b")["source_customer_id"].to_list())
    key_of_a = {a_id: stable_key("core_a", a_id) for a_id in a_ids}
    rows = [
        {
            "source_system": "core_a",
            "source_customer_id": a_id,
            "customer_key": key_of_a[a_id],
            "match_tier": None,
            "match_confidence": None,
            "matched_with": None,
        }
        for a_id in a_ids
    ]
    for b_id in b_ids:
        if b_id in merged:
            c = merged[b_id]
            rows.append(
                {
                    "source_system": "core_b",
                    "source_customer_id": b_id,
                    "customer_key": key_of_a[c.a_id],
                    "match_tier": c.tier,
                    "match_confidence": c.confidence,
                    "matched_with": c.a_id,
                }
            )
        else:
            rows.append(
                {
                    "source_system": "core_b",
                    "source_customer_id": b_id,
                    "customer_key": stable_key("core_b", b_id),
                    "match_tier": None,
                    "match_confidence": None,
                    "matched_with": None,
                }
            )
    # mirror tier/confidence onto the A side of merged pairs
    a_side = {c.a_id: c for c in merged.values()}
    for r in rows:
        if r["source_system"] == "core_a" and r["source_customer_id"] in a_side:
            c = a_side[r["source_customer_id"]]
            r.update(match_tier=c.tier, match_confidence=c.confidence, matched_with=c.b_id)
    keys_issued = assert_keys_unique(rows)
    xref = pl.DataFrame(
        rows,
        schema={
            "source_system": pl.String,
            "source_customer_id": pl.String,
            "customer_key": pl.String,
            "match_tier": pl.Int32,
            "match_confidence": pl.Float64,
            "matched_with": pl.String,
        },
    )
    review_df = pl.DataFrame(
        [
            {
                "core_a_cif": c.a_id,
                "core_b_customer_id": c.b_id,
                "confidence": c.confidence,
                "name_similarity": round(c.name_similarity, 3),
                "ssn_signal": c.ssn_signal,
                "phone_match": c.phone_match,
                "postal_code_match": c.zip_match,
            }
            for c in review
        ],
        schema={
            "core_a_cif": pl.String,
            "core_b_customer_id": pl.String,
            "confidence": pl.Float64,
            "name_similarity": pl.Float64,
            "ssn_signal": pl.Float64,
            "phone_match": pl.Boolean,
            "postal_code_match": pl.Boolean,
        },
    )
    report = score_against_truth(merged, review)
    report["candidates_scored"] = len(candidates)
    report["decisions"] = decisions_summary(decisions)
    report["confirmed_by_reviewer"] = sum(1 for c in merged.values() if c.tier == 3)
    report["rejected_by_reviewer"] = report["decisions"]["reject_applied"]
    report["keys"] = {"format": f"C + {KEY_DIGITS} digits (sha1 of system:id)", "issued": keys_issued, "collisions": 0}
    report["as_of"] = get_as_of().isoformat()
    return xref, review_df, report


def score_against_truth(merged: dict[str, Candidate], review: list[Candidate]) -> dict:
    """Scores resolution against the generator's ground truth (only possible because the data is
    synthetic; in production this is a sampled manual audit)."""
    truth_path = TRUTH / "overlap.csv"
    merged_pairs = {(c.a_id, c.b_id) for c in merged.values()}
    tiers = {1: 0, 2: 0, 3: 0}
    for c in merged.values():
        tiers[c.tier or 0] += 1
    report: dict = {
        "auto_merged": len(merged_pairs),
        "tier_1_deterministic": tiers[1],
        "tier_2_fuzzy": tiers[2],
        "tier_3_confirmed": tiers[3],
        "review_queue": len(review),
        "thresholds": {"auto_merge": AUTO_MERGE, "review_floor": REVIEW_FLOOR},
        "weights": {"name": W_NAME, "ssn": W_SSN, "phone": W_PHONE, "postal_code": W_ZIP},
    }
    if not truth_path.exists():
        return report
    with truth_path.open() as f:
        truth = list(csv.DictReader(f))
    same = {(t["a_cif"], t["b_customer_id"]) for t in truth if t["same_person"] == "True"}
    traps = {(t["a_cif"], t["b_customer_id"]) for t in truth if t["same_person"] == "False"}
    tp = len(merged_pairs & same)
    fp = len(merged_pairs - same)
    fn = len(same - merged_pairs)
    by_kind: dict[str, dict[str, int]] = {}
    review_pairs = {(c.a_id, c.b_id) for c in review}
    for t in truth:
        pair = (t["a_cif"], t["b_customer_id"])
        outcome = "merged" if pair in merged_pairs else "review" if pair in review_pairs else "unmatched"
        by_kind.setdefault(t["kind"], {"merged": 0, "review": 0, "unmatched": 0})[outcome] += 1
    report.update(
        {
            "truth_pairs": len(same),
            "true_positives": tp,
            "false_positives": fp,
            "false_negatives": fn,
            "precision": round(tp / (tp + fp), 4) if tp + fp else None,
            "recall": round(tp / (tp + fn), 4) if tp + fn else None,
            "traps_merged": len(merged_pairs & traps),
            "by_kind": by_kind,
        }
    )
    return report


def run(fresh: bool = True) -> dict:
    cust = read_table(SILVER, "customers")
    xref, review_df, report = resolve(cust)
    write_table(xref, SILVER, "customer_xref", "Source customer -> resolved customer_key with match tier and confidence", fresh=fresh)
    write_table(
        review_df, SILVER, "match_review_queue", "Cross-core candidate pairs below auto-merge threshold, for human review", fresh=fresh
    )
    out = version_dir()
    out.mkdir(parents=True, exist_ok=True)
    (out / "match_report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    return report
