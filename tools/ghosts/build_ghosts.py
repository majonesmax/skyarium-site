"""Build the ghost flights' nightly schedules (docs/GHOSTS.md, D297), for skyarium.app/ghosts/v1/.

    tools/.venv/bin/python -I tools/ghosts/build_ghosts.py OUT [--from 2026-11-23] [--nights 3]

Writes OUT/ghosts/v1/<night>.json for each night (the evening's date in Minneapolis, where both of the first
airlines lived), and OUT/ghosts/v1/index.json listing them. A night is built from its date alone, so building it
twice gives the same file and everyone gets the same ghosts: ten flights per airline from its route bank
(tools/ghosts/routes.json), real routes and real tails, in the quiet hours at both ends: leaving after midnight
where it leaves, landing by 5 a.m. where it lands.

A tail flies its route and, when there's time, flies back. Flight numbers aren't given: the banks have routes,
not which flight number flew them, and a made-up one would pass for a fact.

Each flight: airline, name, year, scheme (an Open Liveries ref), type, registration, from and to (IATA, with
[lat, lon]), depart and arrive (UTC), cruise height (ft) and speed (kt). The app flies a great circle between them
with a climb and a descent at each end.
"""

import argparse
import datetime as dt
import hashlib
import json
import math
import random
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

BANK = Path(__file__).resolve().parent / "routes.json"
LOCAL = ZoneInfo("America/Chicago")  # whose evening names a night
QUIET_FROM, QUIET_TO = 0, 5 * 60  # minutes after local midnight: departures from, arrivals by
PER_AIRLINE = 10
TURN_MIN = 35  # on the ground between a leg and the way back
SPEED_KT = {"MD82": 430, "B722": 455, "B733": 430, "B752": 460, "DC10": 475}


def nm_between(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 3440.065 * math.asin(math.sqrt(h))


def block_minutes(nm: float, kt: int) -> int:
    """Gate to gate: cruise time plus about 25 minutes for taxi, climb and descent."""
    return round(nm / kt * 60 + 25)


def cruise_ft(nm: float) -> int:
    if nm < 150:
        return 17_000
    if nm < 300:
        return 25_000
    if nm < 700:
        return 31_000
    return 35_000


def rng_for(night: dt.date) -> random.Random:
    seed = int.from_bytes(hashlib.sha256(f"ghosts/v1/{night.isoformat()}".encode()).digest()[:8], "big")
    return random.Random(seed)


def types_for(airline: dict, route: list[str]) -> list[str]:
    """The types the airline flew on a route: its fleet types whose `routes` include it, else those without a list."""
    pair = set(route)
    listed = [t for t, f in airline["fleet"].items() if f.get("routes") and any(pair == set(r) for r in f["routes"])]
    if listed:
        return listed
    return [t for t, f in airline["fleet"].items() if f["registrations"] and not f.get("routes")]


def build_night(night: dt.date, bank: dict, airports: dict) -> dict:
    rng = rng_for(night)
    zones = {code: ZoneInfo(name) for code, name in bank["timeZones"].items()}
    day = night + dt.timedelta(days=1)

    def window(a: str, b: str, block: int) -> tuple[dt.datetime, dt.datetime] | None:
        """The departures (UTC) that leave after midnight at a and land by 5 a.m. at b."""
        earliest = dt.datetime.combine(day, dt.time(0), zones[a]) + dt.timedelta(minutes=QUIET_FROM)
        latest = dt.datetime.combine(day, dt.time(0), zones[b]) + dt.timedelta(minutes=QUIET_TO - block)
        return (earliest, latest) if latest >= earliest else None

    def pick(lo: dt.datetime, hi: dt.datetime) -> dt.datetime:
        return lo + dt.timedelta(minutes=5 * rng.randrange(int((hi - lo).total_seconds() // 300) + 1))

    flights = []
    for code, airline in bank["airlines"].items():
        routes = [r for r in airline["routes"] if all(x in airports and x in zones for x in r) and types_for(airline, r)]
        rng.shuffle(routes)
        # A route flown every night, the way it's written (`nightly`: the user's own Western DC-10, Minneapolis to Palm
        # Springs), comes first.
        nightly = list(airline.get("nightly", []))
        routes = nightly + [r for r in routes if r not in airline.get("nightly", [])]
        used_tails: set[str] = set()
        legs = []
        for route in routes:
            if len(legs) >= PER_AIRLINE:
                break
            kind = rng.choice(types_for(airline, route))
            tails = [t for t in airline["fleet"][kind]["registrations"] if t not in used_tails]
            if not tails:
                continue
            a, b = route if route in nightly or rng.random() < 0.5 else route[::-1]
            nm = nm_between(airports[a], airports[b])
            block = block_minutes(nm, SPEED_KT[kind])
            out = window(a, b, block)
            if out is None:
                continue
            tail = rng.choice(tails)
            used_tails.add(tail)
            # Out and back when both fit: the way out leaves early enough for the way back to land in time.
            back = window(b, a, block)
            turn = dt.timedelta(minutes=block + TURN_MIN)
            if back and len(legs) + 2 <= PER_AIRLINE and max(out[0], back[0] - turn) <= min(out[1], back[1] - turn):
                depart = pick(max(out[0], back[0] - turn), min(out[1], back[1] - turn))
                legs += [(tail, kind, a, b, depart, block, nm), (tail, kind, b, a, depart + turn, block, nm)]
            else:
                legs.append((tail, kind, a, b, pick(*out), block, nm))
        for tail, kind, a, b, depart, block, nm in legs:
            flights.append({
                "airline": code,
                "name": airline["name"],
                "year": int(airline["era"]),
                # A type's own scheme where it wore another (Western's DC-10s, white), else the airline's.
                "scheme": airline["fleet"][kind].get("scheme", airline["scheme"]),
                "type": kind,
                # Drawn on another type's shape until its own exists (the DC-10 on the MD-11's).
                **({"drawAs": airline["fleet"][kind]["drawAs"]} if "drawAs" in airline["fleet"][kind] else {}),
                "registration": tail,
                "from": a,
                "to": b,
                "fromPos": list(airports[a]),
                "toPos": list(airports[b]),
                "depart": utc(depart),
                "arrive": utc(depart + dt.timedelta(minutes=block)),
                "cruiseFt": cruise_ft(nm),
                "cruiseKt": SPEED_KT[kind],
            })
    flights.sort(key=lambda f: f["depart"])
    return {"night": night.isoformat(), "version": 1, "flights": flights}


def utc(t: dt.datetime) -> str:
    return t.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def load_airports(bank: dict) -> dict[str, tuple[float, float]]:
    return {code: (lat, lon) for code, (lat, lon) in bank["airports"].items()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("out")
    parser.add_argument("--from", dest="first", help="the first night (default: tonight in Minneapolis)")
    parser.add_argument("--nights", type=int, default=3)
    args = parser.parse_args()
    bank = json.loads(BANK.read_text())
    airports = load_airports(bank)
    first = dt.date.fromisoformat(args.first) if args.first else dt.datetime.now(LOCAL).date()
    out = Path(args.out) / "ghosts" / "v1"
    out.mkdir(parents=True, exist_ok=True)
    nights = [first + dt.timedelta(days=k) for k in range(args.nights)]
    for night in nights:
        schedule = build_night(night, bank, airports)
        (out / f"{night.isoformat()}.json").write_text(json.dumps(schedule, separators=(",", ":")) + "\n")
        print(f"{night}: {len(schedule['flights'])} flights")
    for old in out.glob("????-??-??.json"):
        if dt.date.fromisoformat(old.stem) < first - dt.timedelta(days=1):
            old.unlink()  # keep last night's for a phone still in it
    kept = sorted(p.stem for p in out.glob("????-??-??.json"))
    (out / "index.json").write_text(json.dumps({"nights": kept, "timeZone": "America/Chicago"}) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
