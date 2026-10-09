"""Generate deterministic synthetic dial photos (clearly not real instrument evidence)."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np


CALIBRATION = {
    "start_deg": 135,
    "end_deg": 405,
    "min_value": 0,
    "max_value": 100,
    "units": "synthetic units",
    "center_px": [220, 220],
    "radius_px": 174,
    "min_dominance": 1.18,
}


def synthetic_dial(value: float, *, extra_needle: float | None = None) -> np.ndarray:
    """Render a schematic reference only, not a photograph or certified gauge."""
    image = np.full((440, 440, 3), 235, dtype=np.uint8)
    center = (220, 220)
    radius = 174
    cv2.circle(image, center, radius, (50, 50, 50), 4, cv2.LINE_AA)
    cv2.circle(image, center, int(radius * 0.92), (110, 110, 110), 2, cv2.LINE_AA)
    for offset in range(0, 101, 5):
        angle = math.radians(135 + 270 * offset / 100)
        start_r = radius * (0.80 if offset % 10 == 0 else 0.83)
        end_r = radius * 0.91
        p0 = tuple(round(z) for z in (220 + math.cos(angle) * start_r,
                                      220 + math.sin(angle) * start_r))
        p1 = tuple(round(z) for z in (220 + math.cos(angle) * end_r,
                                      220 + math.sin(angle) * end_r))
        cv2.line(image, p0, p1, (85, 85, 85), 2, cv2.LINE_AA)
    def needle(v: float):
        angle = math.radians(135 + 270 * v / 100)
        tip = (round(220 + math.cos(angle) * radius * 0.67),
               round(220 + math.sin(angle) * radius * 0.67))
        cv2.line(image, center, tip, (15, 15, 15), 5, cv2.LINE_AA)
    needle(value)
    if extra_needle is not None:
        needle(extra_needle)
    cv2.circle(image, center, 8, (55, 55, 55), -1, cv2.LINE_AA)
    return image


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("sample-data"))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    config = args.out / "calibration.json"
    config.write_text(json.dumps(CALIBRATION, indent=2) + "\n", encoding="utf-8")
    for suffix, image in (("normal", synthetic_dial(62)),
                          ("ambiguous", synthetic_dial(62, extra_needle=28))):
        target = args.out / ("gauge-" + suffix + ".png")
        if not cv2.imwrite(str(target), image):
            raise OSError("failed to write fixture")
        print("SYNTHETIC FIXTURE:", target)


if __name__ == "__main__":
    main()
