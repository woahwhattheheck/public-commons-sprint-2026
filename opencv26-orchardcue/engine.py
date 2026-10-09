#!/usr/bin/env python3
"""OrchardCue: conservative red-fruit visual candidate counting and review gates.

The output is observational evidence, NOT a harvest/yield, food-quality, or
agronomic assertion. No image or metadata is sent to a service by this module.
Requires OpenCV (cv2), numpy; OpenCV 4.13 compatibility checked locally.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

import cv2
import numpy as np

VERSION = "orchardcue-0.2"
MARKER_ID = 23
MARKER_DICTIONARY = cv2.aruco.DICT_4X4_50
MAX_SIDE = 2400


def decode_image(raw: bytes) -> np.ndarray:
    if len(raw) > 8_000_000:
        raise ValueError("image exceeds 8 MiB limit")
    array = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None or image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("input must be a readable RGB-image file")
    h, w = image.shape[:2]
    if min(w, h) < 180 or max(w, h) > MAX_SIDE:
        raise ValueError("image dimensions outside 180..2400-pixel working range")
    return image


def _scale_edge_px(xy: np.ndarray) -> float | None:
    """Allow approximate scale only for a sufficiently square marker projection.

    This is a conservative image-plane sanity gate, not a perspective correction
    or proof that the fruit and tag are coplanar. Strongly slanted tags can make
    a mean-edge-length physical conversion materially misleading.
    """
    if xy.shape != (4, 2) or not np.all(np.isfinite(xy)):
        return None
    edges = np.roll(xy, -1, axis=0).astype(np.float64) - xy.astype(np.float64)
    lengths = np.linalg.norm(edges, axis=1)
    shortest = float(np.min(lengths))
    longest = float(np.max(lengths))
    if shortest < 30.0 or longest / shortest > 1.30:
        return None
    unit = edges / lengths[:, None]
    neighboring = np.sum(unit * np.roll(unit, -1, axis=0), axis=1)
    if np.any(np.abs(neighboring) > 0.32):
        return None
    turns = edges[:, 0] * np.roll(edges[:, 1], -1) - edges[:, 1] * np.roll(edges[:, 0], -1)
    if not (np.all(turns > 0) or np.all(turns < 0)):
        return None
    return float(np.mean(lengths))


def _marker(image: np.ndarray, marker_side_mm: float) -> tuple[dict | None, np.ndarray, bool | str]:
    dictionary = cv2.aruco.getPredefinedDictionary(MARKER_DICTIONARY)
    detector = cv2.aruco.ArucoDetector(dictionary, cv2.aruco.DetectorParameters())
    corners, ids, _ = detector.detectMarkers(image)
    mask = np.full(image.shape[:2], 255, np.uint8)
    if ids is None:
        return None, mask, False
    # Two visible fiducials sharing one ID do not identify a unique scale plane.
    # Abstain before falling back to a single geometry-valid marker.
    matching = sum(int(marker_id) == MARKER_ID for marker_id in ids.flatten())
    if matching > 1:
        return None, mask, "duplicate"
    unreliable_geometry = False
    for points, marker_id in zip(corners, ids.flatten()):
        if int(marker_id) != MARKER_ID:
            continue
        xy = points.reshape(-1, 2)
        edge = _scale_edge_px(xy)
        if edge is None:
            unreliable_geometry = True
            continue
        region = cv2.convexHull(xy.astype(np.int32))
        cv2.fillConvexPoly(mask, region, 0)
        mask = cv2.erode(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
        return {"id": MARKER_ID, "edge_px": round(edge, 2),
                "marker_side_mm": marker_side_mm,
                "mm_per_pixel": round(marker_side_mm / edge, 6),
                "assumption": "approximate only: marker and fruit are coplanar"}, mask, False
    return None, mask, unreliable_geometry


def analyze(image: np.ndarray, *, raw_sha256: str, marker_side_mm: float = 50.0) -> tuple[dict[str, Any], np.ndarray]:
    if not 10 <= marker_side_mm <= 300:
        raise ValueError("marker_side_mm must be between 10 and 300")
    h, w = image.shape[:2]
    marker, valid, marker_geometry_rejected = _marker(image, marker_side_mm)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    saturation, value = hsv[:, :, 1], hsv[:, :, 2]
    good_pixels = valid > 0
    if not np.any(good_pixels):
        raise ValueError("empty image after marker exclusion")
    # Saturation edges stay visible when red fruit and green leaves share luminance.
    lap = cv2.Laplacian(saturation, cv2.CV_64F)
    sharpness = float(np.var(lap[good_pixels]))
    glare = float(np.mean((saturation[good_pixels] < 22) & (value[good_pixels] > 245)))
    brightness = float(np.mean(value[good_pixels]))
    reasons: list[str] = []
    if sharpness < 22.0:
        reasons.append("BLUR_RETAKE")
    if glare > 0.065:
        reasons.append("GLARE_RETAKE")
    if brightness < 48:
        reasons.append("DARK_RETAKE")
    if marker is None:
        reasons.append("SCALE_MARKER_AMBIGUOUS" if marker_geometry_rejected == "duplicate"
                       else "SCALE_MARKER_GEOMETRY_UNRELIABLE" if marker_geometry_rejected
                       else "SCALE_MARKER_MISSING")

    # Narrow, disclosed red fruit detector. Green/yellow varieties are not
    # detected; the system must not make general orchard yield claims.
    red_low = cv2.inRange(hsv, (0, 90, 45), (12, 255, 255))
    red_high = cv2.inRange(hsv, (170, 90, 45), (179, 255, 255))
    mask = cv2.bitwise_and(cv2.bitwise_or(red_low, red_high), valid)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = max(120, w * h * 0.00035)
    candidate = []
    ambiguous = 0
    overlay = image.copy()
    if marker is not None:
        cv2.putText(overlay, f"ArUco {MARKER_ID}: approx scale", (18, 28),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
    for cnt in sorted(contours, key=lambda c: cv2.boundingRect(c)[:2]):
        area = float(cv2.contourArea(cnt))
        if area < min_area:
            continue
        perimeter = float(cv2.arcLength(cnt, True))
        if perimeter < 1:
            continue
        circularity = 4 * math.pi * area / (perimeter * perimeter)
        x, y, bw, bh = cv2.boundingRect(cnt)
        aspect = bw / max(1, bh)
        if circularity < 0.49 or not (0.65 <= aspect <= 1.55):
            ambiguous += 1
            cv2.rectangle(overlay, (x, y), (x + bw, y + bh), (0, 165, 255), 2)
            continue
        (cx, cy), radius = cv2.minEnclosingCircle(cnt)
        diameter_px = 2 * math.sqrt(area / math.pi)
        item = {"center_px": [round(cx, 1), round(cy, 1)],
                "diameter_equivalent_px": round(diameter_px, 1),
                "circularity": round(circularity, 3), "bbox": [x, y, bw, bh]}
        if marker is not None:
            item["approx_diameter_mm"] = round(diameter_px * marker["mm_per_pixel"], 1)
        candidate.append(item)
        cv2.circle(overlay, (round(cx), round(cy)), round(radius), (255, 220, 60), 2)
        cv2.putText(overlay, str(len(candidate)), (x, max(55, y-9)),
                    cv2.FONT_HERSHEY_SIMPLEX, .55, (255, 255, 255), 2, cv2.LINE_AA)
    # Evaluate focus where the detected red candidates actually sit. The
    # whole-image score can be high from leaves and the calibration marker
    # even when the objects we intend to inspect are defocused. This is a
    # conservative synthetic-screening threshold, not a field calibration.
    roi_focus = []
    for item in candidate:
        x, y, bw, bh = item["bbox"]
        margin = 6
        patch = lap[max(0, y-margin):min(h, y+bh+margin),
                    max(0, x-margin):min(w, x+bw+margin)]
        roi_focus.append(float(np.var(patch)))
    median_roi_focus = float(np.median(roi_focus)) if roi_focus else None
    if median_roi_focus is not None and median_roi_focus < 60.0:
        reasons.append("FRUIT_ROI_BLUR_RETAKE")
    if ambiguous:
        reasons.append("MERGED_OR_IRREGULAR_RED_REGIONS")
    if not candidate:
        reasons.append("NO_RED_CANDIDATES")
    if any(k.endswith("RETAKE") for k in reasons):
        action = "RETAKE_REQUIRED"
    elif reasons:
        action = "HUMAN_REVIEW_REQUIRED"
    else:
        action = "READY_FOR_OPERATOR_REVIEW"
    badge = f"{action} | {len(candidate)} red candidates"
    cv2.rectangle(overlay, (0, h - 50), (w, h), (17, 37, 36), -1)
    cv2.putText(overlay, badge, (15, h-17), cv2.FONT_HERSHEY_SIMPLEX,
                min(.65, w/1150), (255, 255, 255), 2, cv2.LINE_AA)
    report = {
        "schema": "orchardcue-review/1", "engine": VERSION,
        "input_sha256": raw_sha256, "image_dimensions_px": [w, h],
        "reference_marker": marker, "candidate_count": len(candidate),
        "red_candidates": candidate, "ambiguous_regions": ambiguous,
        "quality": {"saturation_laplacian_variance": round(sharpness, 2),
                    "glare_fraction": round(glare, 5), "mean_brightness": round(brightness, 2),
                    "red_candidate_median_laplacian_variance":
                        round(median_roi_focus, 2) if median_roi_focus is not None else None},
        "decision": {"action": action, "reason_codes": reasons,
                     "human_confirmation_required": True},
        "limitations": ["Only red fruit-like regions are localized; green fruit is unsupported",
                        "Color/occlusion/overlap can make counts incorrect",
                        "Approximate diameters require coplanar marker and fruit",
                        "Fruit-local blur threshold is synthetic-only and requires field calibration",
                        "No crop yield or safety decision; synthetic fixture is not field validation"]
    }
    return report, overlay


def analyze_bytes(raw: bytes, *, marker_side_mm: float = 50.0) -> tuple[dict, bytes]:
    image = decode_image(raw)
    report, overlay = analyze(image, raw_sha256=hashlib.sha256(raw).hexdigest(),
                              marker_side_mm=marker_side_mm)
    success, png = cv2.imencode(".png", overlay)
    if not success:
        raise RuntimeError("OpenCV overlay encoder failed")
    return report, png.tobytes()


def save_review(raw: bytes, output: Path, *, marker_side_mm: float = 50.0) -> dict:
    report, overlay = analyze_bytes(raw, marker_side_mm=marker_side_mm)
    output.mkdir(parents=True, exist_ok=True)
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (output / "overlay.png").write_bytes(overlay)
    return report
