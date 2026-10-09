"""Reference-aligned, fail-closed vision audit. Never authorizes physical maintenance.

OpenCV 5-compatible public APIs only; this artifact's local prototype was developed
against the container's OpenCV 4.13 and has NOT been proven on OpenCV 5 yet.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any
import math

import cv2
import numpy as np


@dataclass(frozen=True)
class Slot:
    slot_id: str
    x: int
    y: int
    width: int
    height: int

    @classmethod
    def parse(cls, obj: dict[str, Any]) -> "Slot":
        if not isinstance(obj, dict):
            raise ValueError("slot must be an object")
        keys = ("id", "x", "y", "width", "height")
        if any(k not in obj for k in keys):
            raise ValueError("missing slot field")
        name = str(obj["id"])
        if not name.isascii() or not (1 <= len(name) <= 32) or not all(c.isalnum() or c in "_-" for c in name):
            raise ValueError("slot id must be ASCII word-like")
        dims = [obj[k] for k in keys[1:]]
        if any(type(n) is not int for n in dims):
            raise ValueError("slot rectangle fields must be integers")
        x, y, w, h = dims
        if x < 0 or y < 0 or w < 18 or h < 18:
            raise ValueError("slot rectangle invalid")
        return cls(name, x, y, w, h)

    def rect(self) -> tuple[int, int, int, int]:
        return self.x, self.y, self.width, self.height


def _check_frame(image: np.ndarray, name: str) -> None:
    if not isinstance(image, np.ndarray) or image.dtype != np.uint8 or image.ndim != 3 or image.shape[2] != 3:
        raise ValueError(f"{name} must be uint8 BGR HxWx3")
    height, width = image.shape[:2]
    if not (150 <= width <= 4096 and 150 <= height <= 4096 and height * width <= 10_000_000):
        raise ValueError(f"{name} dimensions outside admitted bounds")


def _alignment(ref: np.ndarray, cur: np.ndarray) -> tuple[np.ndarray | None, np.ndarray | None, dict[str, Any]]:
    h, w = ref.shape[:2]
    a, b = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY), cv2.cvtColor(cur, cv2.COLOR_BGR2GRAY)
    orb = cv2.ORB_create(nfeatures=2000, edgeThreshold=13, fastThreshold=9)
    kp_r, descriptors_r = orb.detectAndCompute(a, None)
    kp_c, descriptors_c = orb.detectAndCompute(b, None)
    if descriptors_r is None or descriptors_c is None:
        return None, None, {"ok": False, "reason": "insufficient_visual_features", "matches": 0}
    good = []
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    for candidates in matcher.knnMatch(descriptors_c, descriptors_r, k=2):
        if len(candidates) == 2 and candidates[0].distance < 0.73 * candidates[1].distance:
            good.append(candidates[0])
    if len(good) < 16:
        return None, None, {"ok": False, "reason": "insufficient_correspondences", "matches": len(good)}
    src = np.float32([kp_c[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kp_r[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    transform, inlier_mask = cv2.findHomography(src, dst, cv2.RANSAC, 3.0)
    if transform is None or inlier_mask is None or not np.isfinite(transform).all():
        return None, None, {"ok": False, "reason": "homography_not_solved", "matches": len(good)}
    inliers = inlier_mask.ravel() != 0
    count, fraction = int(inliers.sum()), float(inliers.mean())
    if count < 14 or fraction < .54:
        return None, None, {"ok": False, "reason": "weak_homography", "matches": len(good), "inliers": count, "inlier_fraction": round(fraction, 3)}
    projected = cv2.perspectiveTransform(src[inliers].reshape(-1, 1, 2), transform).reshape(-1, 2)
    actual = dst[inliers].reshape(-1, 2)
    rmse = float(np.sqrt(np.mean(np.sum((projected - actual)**2, axis=1))))
    corners = np.float32([[[0, 0]], [[cur.shape[1] - 1, 0]], [[cur.shape[1] - 1, cur.shape[0] - 1]], [[0, cur.shape[0] - 1]]])
    mapped = cv2.perspectiveTransform(corners, transform).reshape(-1, 2)
    polygon_area = abs(float(cv2.contourArea(mapped.astype(np.float32))))
    if rmse > 3.5 or not (.45 <= polygon_area / (h * w) <= 1.8):
        return None, None, {"ok": False, "reason": "unstable_geometry", "rmse_px": round(rmse, 2)}
    ones = np.full(cur.shape[:2], 255, np.uint8)
    aligned = cv2.warpPerspective(cur, transform, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    valid = cv2.warpPerspective(ones, transform, (w, h), flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT) == 255
    return aligned, valid, {"ok": True, "matches": len(good), "inliers": count,
                             "inlier_fraction": round(fraction, 3), "rmse_px": round(rmse, 2),
                             "coverage": round(float(valid.mean()), 3)}


def _reproducible_report(status: str, reason: str, geometry: dict[str, Any]) -> dict[str, Any]:
    return {"schema": "drainguard/report/v1", "status": status, "reason": reason,
            "human_review_required": True, "can_authorize_maintenance": False,
            "alignment": geometry, "slots": [], "method": "ORB/RANSAC + reference brightness contrast; not a safety clearance"}


def inspect(reference: np.ndarray, current: np.ndarray, slots: list[Slot]) -> tuple[dict[str, Any], np.ndarray]:
    """Returns a transparent human-review report and a BGR annotation (never a physical directive).

    This method detects *bright occlusions of reference-dark apertures*. A dark object,
    floodwater, glare, adverse weather, changed hardware, or missing baseline may be missed.
    All decisions therefore require independent field review.
    """
    _check_frame(reference, "reference")
    _check_frame(current, "current")
    if not 1 <= len(slots) <= 64 or len({slot.slot_id for slot in slots}) != len(slots):
        raise ValueError("requires 1-64 distinct slots")
    height, width = reference.shape[:2]
    occupied = np.zeros((height, width), np.uint8)
    for slot in slots:
        x, y, w, h = slot.rect()
        if x + w > width or y + h > height:
            raise ValueError("slot outside reference image")
        if occupied[y:y+h, x:x+w].any():
            raise ValueError("overlapping slot rectangles")
        occupied[y:y+h, x:x+w] = 255

    aligned, valid, geom = _alignment(reference, current)
    if aligned is None or valid is None:
        return _reproducible_report("RECAPTURE", "image registration insufficient for inspection", geom), current.copy()
    ref = cv2.cvtColor(reference, cv2.COLOR_BGR2LAB)[:, :, 0].astype(np.float32)
    cur = cv2.cvtColor(aligned, cv2.COLOR_BGR2LAB)[:, :, 0].astype(np.float32)
    # Calibrate image-wide illumination ONLY outside known aperture ROIs;
    # a large lighting mismatch is an abstention, not silently normalized evidence.
    static_mask = (occupied == 0) & valid
    if static_mask.sum() < .20 * height * width:
        return _reproducible_report("RECAPTURE", "insufficient stable calibration area", geom), aligned
    deltas = (cur - ref)[static_mask]
    offset = float(np.median(deltas))
    mad = float(np.median(np.abs(deltas - offset)))
    geom.update({"lighting_offset_lab_l": round(offset, 2), "lighting_mad_lab_l": round(mad, 2)})
    if abs(offset) > 28 or mad > 24:
        return _reproducible_report("RECAPTURE", "lighting is not comparable to baseline", geom), aligned

    annotated = aligned.copy()
    decisions = []
    for slot in slots:
        x, y, w, h = slot.rect()
        inset = max(4, min(8, w // 8, h // 8))
        zone = np.zeros((height, width), np.uint8)
        zone[y+inset:y+h-inset, x+inset:x+w-inset] = 255
        supported = (zone != 0) & valid
        coverage = float(supported.sum()) / max(1, int((zone != 0).sum()))
        reference_luminance = ref[supported]
        if coverage < .93 or reference_luminance.size < 80:
            classification, ratio, reason = "RECAPTURE", None, "slot leaves aligned image coverage"
        else:
            baseline = float(np.median(reference_luminance))
            # Only aperture pixels that really are dark in the baseline qualify.
            aperture = supported & (ref <= baseline + 18) & (ref < 105)
            aperture_count = int(aperture.sum())
            if aperture_count < 60:
                classification, ratio, reason = "RECAPTURE", None, "baseline has no sufficiently dark aperture"
            else:
                bright = ((cur - ref - offset) >= 37) & (cur >= ref + 29) & aperture
                # Mild smoothing prevents single JPEG noise pixels becoming detections.
                clean = cv2.morphologyEx(bright.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) != 0
                ratio = float(clean.sum()) / aperture_count
                if ratio >= .16:
                    classification, reason = "REVIEW_BRIGHT_BLOCKAGE", "bright obstruction-like change observed"
                elif ratio > .055:
                    classification, reason = "REVIEW_AMBIGUOUS", "localized change requires closer review"
                else:
                    classification, reason = "REVIEW_NO_BRIGHT_BLOCKAGE", "no bright obstruction found; other hazards not ruled out"
        decisions.append({"slot_id": slot.slot_id, "reference_box_xywh": list(slot.rect()),
                          "classification": classification,
                          "bright_change_fraction": None if ratio is None else round(ratio, 4),
                          "aligned_coverage": round(coverage, 3), "reason": reason})
        rgb = (24, 60, 235) if classification == "REVIEW_BRIGHT_BLOCKAGE" else (0, 190, 255) if classification in ("REVIEW_AMBIGUOUS", "RECAPTURE") else (30, 190, 65)
        cv2.rectangle(annotated, (x, y), (x+w, y+h), rgb, 3)
        label = f"{slot.slot_id}:" + ("?" if ratio is None else f"{100*ratio:.0f}%")
        cv2.putText(annotated, label, (x, max(16, y-9)),
                    cv2.FONT_HERSHEY_SIMPLEX, .45, rgb, 1, cv2.LINE_AA)

    if any(x["classification"] == "RECAPTURE" for x in decisions):
        status = "RECAPTURE"
    elif any(x["classification"] == "REVIEW_BRIGHT_BLOCKAGE" for x in decisions):
        status = "REVIEW_BRIGHT_BLOCKAGE"
    elif any(x["classification"] == "REVIEW_AMBIGUOUS" for x in decisions):
        status = "REVIEW_AMBIGUOUS"
    else:
        status = "REVIEW_NO_BRIGHT_BLOCKAGE"
    result = _reproducible_report(status, "human review required; do not interpret as drainage clearance", geom)
    result["slots"] = decisions
    result["assumptions"] = ["same grate and camera subject", "reference photo is known-good and rights-cleared",
                              "bright occlusion only; dark debris and water can be missed", "no field deployment validation"]
    return result, annotated
