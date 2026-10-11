from __future__ import annotations

import random
import uuid
from dataclasses import dataclass, replace
from datetime import date, timedelta
from pathlib import Path

from faker import Faker

SEED = 360
AS_OF = date(2026, 9, 30)
ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "lakehouse" / "raw"
TRUTH = ROOT / "data" / "truth"

N_UNIQUE = 2000
N_OVERLAP = 300  # 15% of unique people exist in both cores
N_A = 1100
N_B = N_UNIQUE - N_A + N_OVERLAP  # 1200
N_TRAPS = 5  # same name + DOB, different person (must NOT merge)
N_TXNS = 50_000

PRODUCTS = ["checking", "savings", "mortgage", "cd"]
PRODUCT_MIX = [0.45, 0.30, 0.15, 0.10]

NICKNAMES = {
    "William": "Bill",
    "Robert": "Bob",
    "Richard": "Rick",
    "Elizabeth": "Liz",
    "Katherine": "Kate",
    "Michael": "Mike",
    "Christopher": "Chris",
    "Jennifer": "Jen",
    "Margaret": "Peggy",
    "James": "Jim",
    "Thomas": "Tom",
    "Patricia": "Pat",
    "Joseph": "Joe",
    "Daniel": "Dan",
    "Matthew": "Matt",
    "Anthony": "Tony",
    "Steven": "Steve",
    "Andrew": "Andy",
    "Rebecca": "Becky",
    "Samuel": "Sam",
}

# Overlap difficulty bands by index within the 300 overlapping people.
OVERLAP_KINDS = (
    [("clean", 180)]
    + [("nickname", 30)]
    + [("typo", 15)]
    + [("middle_hyphen", 15)]
    + [("ssn_missing", 10)]
    + [("lastname_changed", 15)]
    + [("lastname_changed_ssn_missing", 15)]
    # the next two exist so the phone / postal-code boosts are decisive, not decorative:
    + [("ssn_missing_moved", 10)]  # same name, no SSN in B, new address -> boost gone -> review
    + [("lastname_changed_ssn_missing_moved_newphone", 10)]  # nothing left to match on -> unmatched
)


@dataclass(frozen=True)
class Person:
    pid: int
    first: str
    middle: str
    last: str
    dob: date
    ssn4: str
    street: str
    city: str
    state: str
    zip: str
    phone: str  # 10 digits
    email: str
    since: date


def make_rng() -> tuple[random.Random, Faker]:
    rng = random.Random(SEED)
    Faker.seed(SEED)
    fake = Faker("en_US")
    return rng, fake


def build_people(rng: random.Random, fake: Faker) -> list[Person]:
    first_names = [fake.first_name() for _ in range(400)] + list(NICKNAMES.keys()) * 10
    people: list[Person] = []
    seen_ssn: set[str] = set()
    for pid in range(N_UNIQUE):
        first = rng.choice(first_names)
        last = fake.last_name()
        ssn4 = f"{rng.randint(0, 9999):04d}"
        while ssn4 in seen_ssn:
            ssn4 = f"{rng.randint(0, 9999):04d}"
        seen_ssn.add(ssn4)
        dob = date(1940, 1, 1) + timedelta(days=rng.randint(0, 365 * 66))
        since = date(2005, 1, 1) + timedelta(days=rng.randint(0, 365 * 21))
        people.append(
            Person(
                pid=pid,
                first=first,
                middle=rng.choice("ABCDEFGHJKLMNPRSTW"),
                last=last,
                dob=dob,
                ssn4=ssn4,
                street=fake.street_address(),
                city=fake.city(),
                state=fake.state_abbr(),
                zip=f"{rng.randint(10000, 99999)}",
                phone=f"{rng.randint(200, 989)}{rng.randint(200, 999)}{rng.randint(0, 9999):04d}",
                email=f"{first.lower()}.{last.lower()}{rng.randint(1, 99)}@example.com",
                since=since,
            )
        )
    return people


def overlap_kind(i: int) -> str:
    n = 0
    for kind, count in OVERLAP_KINDS:
        n += count
        if i < n:
            return kind
    raise IndexError(i)


def vary_for_core_b(p: Person, kind: str, rng: random.Random, fake: Faker) -> tuple[Person, bool]:
    """Returns the Core B rendering of an overlapping person and whether B has the SSN last 4."""
    if kind == "clean":
        return p, True
    if kind == "nickname":
        nick = NICKNAMES.get(p.first)
        if nick:
            return replace(p, first=nick), True
        kind = "typo"
    if kind == "typo":
        last = list(p.last)
        if len(last) > 3:
            i = rng.randint(1, len(last) - 2)
            last[i] = rng.choice("aeiou")
        return replace(p, last="".join(last)), True
    if kind == "middle_hyphen":
        return replace(p, middle="", last=f"{p.last}-{fake.last_name()}"), True
    if kind == "ssn_missing":
        return p, False
    if kind == "lastname_changed":
        return replace(p, last=fake.last_name()), True
    if kind == "lastname_changed_ssn_missing":
        return replace(p, last=fake.last_name()), False
    if kind == "ssn_missing_moved":
        return replace(p, street=fake.street_address(), city=fake.city(), zip=f"{rng.randint(10000, 99999)}"), False
    if kind == "lastname_changed_ssn_missing_moved_newphone":
        return (
            replace(
                p,
                last=fake.last_name(),
                street=fake.street_address(),
                city=fake.city(),
                zip=f"{rng.randint(10000, 99999)}",
                phone=f"{rng.randint(200, 989)}{rng.randint(200, 999)}{rng.randint(0, 9999):04d}",
            ),
            False,
        )
    raise ValueError(kind)


def new_uuid(rng: random.Random) -> str:
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))
