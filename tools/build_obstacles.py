"""The Horizon's local icons (D240): water towers, radio and TV masts, smokestacks, grain elevators and wind
turbines, from the FAA's Digital Obstacle File (US, public domain, updated every 56 days), into small tiles
on skyarium.app the app fetches for where you are (never the FAA from phones).

  python -I tools/build_obstacles.py DOF.DAT OUT_DIR

OUT_DIR/v1/<lat>_<lon>.json per 1° tile, by its south-west corner ("44_-94.json"):
  {"v": 1, "o": [[lat, lon, kind, aglM, groundM, lit], ...]}
kind: w water tower, m mast, s stack, e grain elevator, t wind turbine. groundM: the ground under it above sea
level (AMSL − AGL). lit: 1 when it carries obstruction lights. Run by the site's monthly job
(scripts/site/obstacles.yml); the file is fixed-width (FAA's DOF format, columns below).
"""

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

# FAA type → our kind, and the least height (ft above ground) worth drawing: the short ones are lost in the
# trees and roofs anyway.
KINDS = {
    "TANK": ("w", 60),
    "TOWER": ("m", 200),
    "ANTENNA": ("m", 200),
    "STACK": ("s", 120),
    "ELEVATOR": ("e", 90),
    "GRAIN ELEVATOR": ("e", 90),
    "SILO": ("e", 90),
    "WINDMILL": ("t", 0),
}
FT = 0.3048


def dms(d, m, s, hemisphere):
    v = int(d) + int(m) / 60 + float(s) / 3600
    return -v if hemisphere in "SW" else v


def rows(path):
    with open(path, encoding="latin-1") as f:
        for line in f:
            if len(line) < 100 or not line[0:2].isdigit():
                continue
            kind = KINDS.get(line[62:80].strip())
            if not kind:
                continue
            agl, amsl = int(line[83:88]), int(line[89:94])
            if agl < kind[1]:
                continue
            lat = dms(line[35:37], line[38:40], line[41:46], line[46])
            lon = dms(line[48:51], line[52:54], line[55:60], line[60])
            lit = 0 if line[95] in "NU" else 1  # N none, U unknown
            yield lat, lon, kind[0], round(agl * FT), round((amsl - agl) * FT), lit


def main():
    src, out = sys.argv[1], Path(sys.argv[2]) / "v1"
    tiles = defaultdict(list)
    for lat, lon, kind, agl, ground, lit in rows(src):
        tiles[(math.floor(lat), math.floor(lon))].append([round(lat, 5), round(lon, 5), kind, agl, ground, lit])
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.json"):
        old.unlink()
    for (la, lo), items in tiles.items():
        (out / f"{la}_{lo}.json").write_text(json.dumps({"v": 1, "o": sorted(items)}, separators=(",", ":")))
    print(f"{sum(map(len, tiles.values()))} obstacles in {len(tiles)} tiles")


if __name__ == "__main__":
    main()
