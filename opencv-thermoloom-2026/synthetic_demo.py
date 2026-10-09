# SPDX-License-Identifier: MIT
"""Deterministic examples, not field data or a measured benchmark."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from thermoloom import inspect, overlay


def make_case(case: str) -> np.ndarray:
    if case not in {"clean", "spot", "flat"}:
        raise ValueError("unknown synthetic case")
    if case == "flat":
        return np.full((480, 720), 80, np.uint8)
    rng = np.random.default_rng(40)
    noise = rng.integers(-3, 4, (480, 720), dtype=np.int16)
    x_gradient = (np.arange(720, dtype=np.float64)[None, :] / 720 * 8).astype(np.int16)
    frame = np.clip(74 + noise + x_gradient, 0, 255).astype(np.uint8)
    for y in range(0, 480, 120):
        frame[y:y + 2, :] = 66
    for x in range(0, 720, 120):
        frame[:, x:x + 2] = 66
    if case == "spot":
        # Row 1, col 3, safely inside the 8% panel-margin crop.
        cv2.ellipse(frame, (430, 180), (12, 9), 0, 0, 360, 185, -1)
    return frame


def run(output: Path) -> list[dict]:
    output.mkdir(parents=True, exist_ok=True)
    receipts = []
    for case, expected in (("clean", "MONITOR"), ("spot", "HUMAN_REVIEW"), ("flat", "RETAKE")):
        frame = make_case(case)
        verdict = inspect(frame)
        if verdict["decision"] != expected:
            raise AssertionError(f"{case}: expected {expected}, received {verdict['decision']}")
        if case == "spot" and not any((e["row"], e["col"]) == (1, 3) for e in verdict["evidence"]):
            raise AssertionError("spot should be localized to the actual panel")
        cv2.imwrite(str(output / f"{case}.png"), frame)
        cv2.imwrite(str(output / f"{case}-overlay.png"), overlay(frame, verdict))
        (output / f"{case}.json").write_text(json.dumps(verdict, indent=2) + "\n", encoding="utf-8")
        receipts.append({"case": case, "decision": verdict["decision"], "regions": len(verdict["evidence"]),
                         "sha256": verdict["capture_sha256"]})
    return receipts


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=Path("synthetic-output"))
    args = parser.parse_args()
    print(json.dumps({"synthetic_only": True, "cases": run(args.out)}, indent=2))
