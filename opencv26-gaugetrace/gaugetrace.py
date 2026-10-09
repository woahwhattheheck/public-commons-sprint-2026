"""GaugeTrace: inspect a photographed analog dial; never actuate equipment.

OpenCV is the core visual inference engine. Every output requires operator review.
The camera calibration is supplied by the operator; no instrument accuracy is claimed.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import cv2
import numpy as np


def _fail(reason: str, *, diagnostics: dict | None = None) -> dict:
    return {"schema": "gaugetrace/observation/v1", "decision": "RETAKE_OR_REVIEW",
            "reason": reason, "reading": None,
            "calibration_verified": False, "diagnostics": diagnostics or {}}


def _calibration(config: dict[str, Any]) -> tuple[float, float, float, float]:
    try:
        start = float(config["start_deg"])
        end = float(config["end_deg"])
        low = float(config["min_value"])
        high = float(config["max_value"])
    except (ValueError, TypeError, KeyError) as exc:
        raise ValueError("calibration requires numeric start_deg, end_deg, min_value, max_value") from exc
    if not all(map(math.isfinite, (start, end, low, high))) or high <= low:
        raise ValueError("invalid calibration range")
    sweep = (end - start) % 360.0
    if not 30.0 <= sweep <= 350.0:
        raise ValueError("dial sweep must be between 30 and 350 degrees clockwise")
    return start % 360.0, sweep, low, high


def _quality_thresholds(config: dict) -> tuple[float, float, float]:
    """Validate operator-set gates before any image yields a reading.

    NaN comparisons are always false; without finite positive gates a bad
    configuration can silently bypass focus, glare or ambiguity abstention.
    """
    limits = (
        ("min_blur_variance", 25.0, lambda n: n > 0.0, "positive"),
        ("max_near_white_fraction", 0.25, lambda n: 0.0 <= n < 1.0, "within [0, 1)"),
        ("min_dominance", 1.18, lambda n: n > 1.0, "greater than 1"),
    )
    valid = []
    for name, default, allowed, description in limits:
        raw = config.get(name, default)
        if isinstance(raw, bool):
            raise ValueError(f"{name} must be finite and {description}")
        try:
            number = float(raw)
        except (TypeError, ValueError, OverflowError) as exc:
            raise ValueError(f"{name} must be finite and {description}") from exc
        if not math.isfinite(number) or not allowed(number):
            raise ValueError(f"{name} must be finite and {description}")
        valid.append(number)
    return tuple(valid)


def _circle(gray: np.ndarray, config: dict) -> tuple[int, int, int] | None:
    height, width = gray.shape
    if "center_px" in config and "radius_px" in config:
        center = config["center_px"]
        if not isinstance(center, list) or len(center) != 2:
            raise ValueError("center_px must be an [x, y] list")
        x, y, r = int(center[0]), int(center[1]), int(config["radius_px"])
        if r < 25 or x - r < 0 or y - r < 0 or x + r >= width or y + r >= height:
            raise ValueError("fixed circle is outside photograph bounds")
        return x, y, r
    candidates = cv2.HoughCircles(
        cv2.medianBlur(gray, 5), cv2.HOUGH_GRADIENT, dp=1.25,
        minDist=max(40, height // 2), param1=115, param2=36,
        minRadius=max(25, int(min(width, height) * 0.16)),
        maxRadius=max(26, int(min(width, height) * 0.47))
    )
    if candidates is None:
        return None
    circles = np.round(candidates[0]).astype(int)
    valid = [(int(x), int(y), int(r)) for x, y, r in circles
             if x - r >= 0 and y - r >= 0 and x + r < width and y + r < height]
    return max(valid, key=lambda c: c[2]) if valid else None


def analyze_image(image: np.ndarray, calibration: dict[str, Any]) -> tuple[dict, np.ndarray]:
    """Calibrated observation with explicit uncertainty gates, never autonomous approval."""
    start, sweep, low, high = _calibration(calibration)
    min_blur_variance, max_near_white_fraction, min_dominance = _quality_thresholds(calibration)
    if image is None or image.ndim not in (2, 3):
        raise ValueError("input must be a decoded grayscale/BGR image")
    if image.ndim == 3 and image.shape[2] != 3:
        raise ValueError("BGR must contain 3 channels")
    if min(image.shape[:2]) < 120:
        return _fail("resolution_too_low"), image.copy()
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image.copy()
    overlay = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR) if image.ndim == 2 else image.copy()
    circle = _circle(gray, calibration)
    if circle is None:
        return _fail("dial_not_localized"), overlay
    cx, cy, radius = circle
    cv2.circle(overlay, (cx, cy), radius, (210, 170, 60), 2)
    yy, xx = np.ogrid[:gray.shape[0], :gray.shape[1]]
    dial = (xx - cx) ** 2 + (yy - cy) ** 2 < (0.9 * radius) ** 2
    pixels = gray[dial]
    # Sharp scenery outside the instrument must not rescue a blurry dial.
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    blur_variance = float(laplacian.var())
    dial_blur_variance = float(laplacian[dial].var())
    saturated_fraction = float(np.mean(pixels >= 253))
    diagnostics = {
        "circle_px": [cx, cy, radius],
        "blur_laplacian_variance": round(blur_variance, 2),
        "dial_blur_laplacian_variance": round(dial_blur_variance, 2),
        "near_white_fraction": round(saturated_fraction, 4)
    }
    if dial_blur_variance < min_blur_variance:
        return _fail("blur_or_low_detail", diagnostics=diagnostics), overlay
    if saturated_fraction > max_near_white_fraction:
        return _fail("glare_or_clipping", diagnostics=diagnostics), overlay

    # Scan oriented rays inside the dial, excluding central spindle and outer
    # scale tick/numeral ring. Do NOT mistake missing slot/ray segments for proof.
    angles = np.arange(0, 360, 0.5, dtype=np.float64)
    radials = np.linspace(0.23 * radius, 0.72 * radius, 100, dtype=np.float64)
    theta = np.deg2rad(angles)[:, None]
    mx = (cx + np.cos(theta) * radials).astype(np.float32)
    my = (cy + np.sin(theta) * radials).astype(np.float32)
    rays = cv2.remap(gray, mx, my, cv2.INTER_LINEAR,
                     borderMode=cv2.BORDER_CONSTANT, borderValue=245).astype(np.float64)
    background = np.median(rays, axis=0)
    contrast = np.clip(background - rays, 0, 255)
    weighted = np.linspace(0.7, 1.5, len(radials))
    scores = np.sum(contrast * weighted, axis=1) / np.sum(weighted)
    # A 2.5 degree smoothing radius stabilizes antialiasing but preserves
    # the important separation from other dark radial artifacts.
    scores = (scores + np.roll(scores, 1) + np.roll(scores, -1)) / 3
    winner_index = int(np.argmax(scores))
    peak = float(scores[winner_index])
    min_signal = max(12.0, float(np.percentile(scores, 60)) * 2.5)
    diagnostics["needle_signal"] = round(peak, 2)
    diagnostics["signal_floor"] = round(min_signal, 2)
    if peak < min_signal:
        return _fail("needle_not_separable", diagnostics=diagnostics), overlay

    # Compare a genuinely different direction, excluding ±9° around candidate.
    bins = len(scores)
    far = np.array([i for i in range(bins)
                    if min(abs(i - winner_index), bins - abs(i - winner_index)) >= 18])
    runner_up = float(np.max(scores[far]))
    dominance = peak / max(runner_up, 0.01)
    diagnostics["directional_dominance"] = round(dominance, 3)
    if dominance < min_dominance:
        return _fail("multiple_plausible_needles", diagnostics=diagnostics), overlay

    angle_deg = float(angles[winner_index])
    clockwise_delta = (angle_deg - start) % 360.0
    diagnostics["needle_angle_clockwise_deg"] = angle_deg
    if clockwise_delta > sweep + 3.0:
        return _fail("needle_outside_calibrated_arc", diagnostics=diagnostics), overlay
    progress = min(1.0, clockwise_delta / sweep)
    measured = low + (high - low) * progress
    tip = (int(cx + 0.73 * radius * math.cos(math.radians(angle_deg))),
           int(cy + 0.73 * radius * math.sin(math.radians(angle_deg))))
    cv2.line(overlay, (cx, cy), tip, (30, 80, 220), 2, cv2.LINE_AA)
    cv2.circle(overlay, (cx, cy), 4, (30, 80, 220), -1)
    cv2.putText(overlay, "OBSERVATION - OPERATOR VERIFY",
                (12, min(26, overlay.shape[0] - 8)), cv2.FONT_HERSHEY_SIMPLEX,
                0.54, (0, 0, 220), 1, cv2.LINE_AA)
    return ({
        "schema": "gaugetrace/observation/v1",
        "decision": "OPERATOR_CONFIRMATION_REQUIRED",
        "reason": "camera_estimate_not_instrument_calibration",
        "reading": round(measured, 3),
        "reading_units": str(calibration.get("units", "operator-supplied units"))[:40],
        "calibration_verified": False,
        "diagnostics": diagnostics
    }), overlay


def main() -> int:
    p = argparse.ArgumentParser(description="Camera dial observation, not a safety instrument")
    p.add_argument("--image", type=Path, required=True)
    p.add_argument("--config", type=Path, required=True)
    p.add_argument("--json", type=Path, required=True)
    p.add_argument("--overlay", type=Path)
    args = p.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    raw = cv2.imread(str(args.image), cv2.IMREAD_COLOR)
    if raw is None:
        p.error("image could not be decoded")
    result, annotated = analyze_image(raw, config)
    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    if args.overlay:
        args.overlay.parent.mkdir(parents=True, exist_ok=True)
        if not cv2.imwrite(str(args.overlay), annotated):
            raise OSError("could not write review image")
    print(json.dumps({"decision": result["decision"], "reason": result["reason"]}))
    return 0 if result["decision"] == "OPERATOR_CONFIRMATION_REQUIRED" else 2


if __name__ == "__main__":
    raise SystemExit(main())
