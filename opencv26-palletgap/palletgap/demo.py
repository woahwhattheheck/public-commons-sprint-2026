"""Deterministic synthetic baseline with registration texture and aisle interference."""
from __future__ import annotations
import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def generate(out: Path) -> dict[str, object]:
    out.mkdir(parents=True, exist_ok=True)
    h, w = 480, 720
    image = np.full((h, w, 3), (115, 129, 141), np.uint8)
    rng = np.random.default_rng(20261009)
    noise = rng.integers(-12, 13, (h, w, 1), dtype=np.int16)
    image = np.clip(image.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    # Floor lines, fixed fixtures and text allow ORB registration.
    for x in range(10, w, 38):
        cv2.line(image, (x, 0), (x, h - 1), (77, 83, 88), 1)
    for y in range(10, h, 35):
        cv2.line(image, (0, y), (w - 1, y), (80, 86, 92), 1)
    for i in range(18):
        x = 14 + i * 39
        cv2.putText(image, str(i % 10), (x, 50 + (i % 4) * 105), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (40, 40, 40), 2)
    # Left and right shelves are outside geofenced aisle.
    for x in (30, 585):
        cv2.rectangle(image, (x, 135), (x + 100, 390), (64, 66, 180), 4)
    aisle = [[175, 120], [545, 120], [525, 429], [185, 429]]
    cv2.polylines(image, [np.array(aisle, np.int32)], True, (30, 205, 225), 3)
    clear = cv2.convertScaleAbs(image, alpha=1.0, beta=6)
    blocked = clear.copy()
    cv2.rectangle(blocked, (320, 228), (413, 328), (58, 43, 32), -1)
    cv2.rectangle(blocked, (327, 236), (404, 320), (142, 102, 75), 4)
    cv2.line(blocked, (330, 240), (395, 310), (203, 153, 116), 3)
    confirm = blocked.copy()
    cv2.rectangle(confirm, (332, 238), (397, 314), (149, 103, 66), 1)
    bright = cv2.convertScaleAbs(clear, alpha=1.0, beta=15)
    for name, frame in (("reference.png", image), ("clear.png", bright), ("blocked.png", blocked), ("confirmation.png", confirm)):
        if not cv2.imwrite(str(out / name), frame):
            raise RuntimeError("Could not save fixture")
    settings = {"aisle_polygon": aisle, "baseline_key": "reference.png", "notes": "Synthetic-only; empty aisle reference is not an operational safety baseline"}
    (out / "camera.json").write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")
    return {"images": 4, "camera": settings, "location": str(out)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=Path("demo-artifacts"))
    print(json.dumps(generate(parser.parse_args().out)))
