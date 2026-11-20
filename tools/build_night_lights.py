"""City lights (NOTES › Idea: city lights): NASA's Black Marble 2016 night lights (VIIRS day/night band, public
domain, 500 m cells) into small tiles on skyarium.app the app fetches for where you are (never NASA from phones).

  python -I tools/build_night_lights.py SRC_DIR OUT_DIR

SRC_DIR holds the eight 500 m grayscale GeoTIFFs, BlackMarble_2016_{A1..D2}_geo_gray.tif (or {A1..D2}_gray.tif),
from https://visibleearth.nasa.gov/images/144897 : columns A–D are 90° of longitude from 180°W, rows 1 north of the
equator and 2 south, each 21600 pixels square (240 to the degree).

OUT_DIR/v1/<lat>_<lon>.png per 1° tile, by its south-west corner ("44_-94.png"): 240×240 8-bit grayscale, north
row first, the map's brightness with its dark floor (airglow, the ground's own) set to 0 so empty country packs
small. A tile with nothing lit isn't written; the app takes a missing tile as dark. The data doesn't change, so
this runs once (or when NASA publishes a newer map), not on a schedule.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

PER_DEG = 240
# The map's floor: at or under this is dark ground (the app's own threshold, `NightLights.darkBelow`, is higher).
FLOOR = 30
COLUMNS = "ABCD"


def source(src: Path, name: str) -> Path:
    for candidate in (f"BlackMarble_2016_{name}_geo_gray.tif", f"{name}_gray.tif"):
        if (src / candidate).exists():
            return src / candidate
    sys.exit(f"missing {name} in {src}")


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2]) / "v1"
    out.mkdir(parents=True, exist_ok=True)
    Image.MAX_IMAGE_PIXELS = None
    written = total = 0
    for c, column in enumerate(COLUMNS):
        for row in (1, 2):
            name = f"{column}{row}"
            pixels = np.asarray(Image.open(source(src, name)).convert("L"))
            pixels = np.where(pixels <= FLOOR, 0, pixels).astype(np.uint8)
            west, north = -180 + 90 * c, 90 if row == 1 else 0
            for i in range(90):
                for j in range(90):
                    tile = pixels[i * PER_DEG : (i + 1) * PER_DEG, j * PER_DEG : (j + 1) * PER_DEG]
                    if not tile.any():
                        continue
                    path = out / f"{north - i - 1}_{west + j}.png"
                    Image.fromarray(tile, "L").save(path, optimize=True)
                    written += 1
                    total += path.stat().st_size
            print(f"{name}: {written} tiles so far, {total / 1e6:.1f} MB", flush=True)
            del pixels


if __name__ == "__main__":
    main()
