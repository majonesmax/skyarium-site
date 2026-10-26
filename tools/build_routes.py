"""Build Skyarium's own route files from the VRS standing data (CC0; D140), for skyarium.app/routes/v1/.

    git clone --depth 1 --filter=blob:none --sparse https://github.com/vradarserver/standing-data.git sd
    git -C sd sparse-checkout set routes airports
    tools/.venv/bin/python -I tools/build_routes.py sd out

Writes, under out/routes/v1/:
- index.json: {"built": ISO time, "source": …, "codes": [every airline code with routes]}
- <CODE>.json, one per airline code ("UAL", "BM"): {flight number: "KSFO-KIAD", …}; the callsign
  is the code plus the number ("UAL10").
- airports.json: {code: [IATA or "", name, city, lat, lon]} for every airport a route uses.
The app fetches the index and airports once a day, and an airline's file the first time it sees
one of its callsigns.
"""
import csv, datetime, glob, json, os, sys

src, out = sys.argv[1], os.path.join(sys.argv[2], "routes", "v1")
os.makedirs(out, exist_ok=True)
for old in glob.glob(os.path.join(out, "*.json")):
    os.remove(old)  # a code that's gone from the source goes from ours too

airports = {}
for f in glob.glob(f"{src}/airports/schema-01/*/*.csv"):
    for r in csv.DictReader(open(f, encoding="utf-8-sig")):
        try:
            airports[r["Code"]] = [r["IATA"], r["Name"], r["Location"], round(float(r["Latitude"]), 4), round(float(r["Longitude"]), 4)]
        except ValueError:
            pass  # no position: no use to us

routes, used, skipped = {}, set(), 0
for f in glob.glob(f"{src}/routes/schema-01/*/*.csv"):
    for r in csv.DictReader(open(f, encoding="utf-8-sig")):
        stops = r["AirportCodes"].split("-")
        if len(stops) < 2 or any(s not in airports for s in stops):
            skipped += 1
            continue
        routes.setdefault(r["Code"], {})[r["Number"]] = r["AirportCodes"]
        used.update(stops)

for code, table in routes.items():
    json.dump(table, open(os.path.join(out, f"{code}.json"), "w"), separators=(",", ":"), sort_keys=True)
json.dump({c: airports[c] for c in sorted(used)}, open(os.path.join(out, "airports.json"), "w", encoding="utf-8"),
          separators=(",", ":"), ensure_ascii=False)
json.dump({"built": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
           "source": "VRS standing data (CC0), github.com/vradarserver/standing-data",
           "codes": sorted(routes)}, open(os.path.join(out, "index.json"), "w"), separators=(",", ":"))
print(f"{sum(len(t) for t in routes.values())} routes for {len(routes)} codes, {len(used)} airports; "
      f"skipped {skipped} (an airport without a position)")
