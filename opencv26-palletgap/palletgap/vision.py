"""Fixed-camera aisle audit; a decision aid, never an automated safety clearance.

All decisions are tied to the same reference image and polygon. No facial analysis.
"""
from __future__ import annotations

import dataclasses
from typing import Any

import cv2
import numpy as np


MAX_SIDE = 2048
MAX_PIXELS = 6_000_000


@dataclasses.dataclass(frozen=True)
class Parameters:
    min_area_pixels: int = 360
    min_fraction: float = 0.004
    pixel_change_threshold: float = 24.0
    min_inliers: int = 10
    min_inlier_ratio: float = 0.38
    min_coverage: float = 0.12
    max_illumination_shift: float = 40.0
    max_changed_fraction: float = 0.40


def read_image(path: str) -> np.ndarray:
    frame = cv2.imread(path, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError(f"Not a readable color image: {path}")
    check_image(frame)
    return frame


def decode_image(raw: bytes) -> np.ndarray:
    if not raw or len(raw) > 12_000_000:
        raise ValueError("Image byte size outside supported bounds")
    frame = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("Unsupported/corrupt image")
    check_image(frame)
    return frame


def check_image(frame: np.ndarray) -> None:
    if not isinstance(frame, np.ndarray) or len(frame.shape) != 3 or frame.shape[2] != 3:
        raise ValueError("Expected BGR image")
    h, w = frame.shape[:2]
    if min(h, w) < 160 or max(h, w) > MAX_SIDE or h * w > MAX_PIXELS:
        raise ValueError("Image dimensions outside fixed-camera limits")


def polygon_mask(shape: tuple[int, ...], vertices: list[list[int]]) -> np.ndarray:
    h, w = shape[:2]
    pts = np.array(vertices, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 2 or not 3 <= len(pts) <= 12:
        raise ValueError("Aisle polygon requires 3–12 vertices")
    if not np.isfinite(pts).all() or (pts < 0).any() or (pts[:, 0] >= w).any() or (pts[:, 1] >= h).any():
        raise ValueError("Aisle polygon extends outside reference image")
    area = abs(float(cv2.contourArea(pts.astype(np.float32))))
    if area < 1800 or area > 0.85 * h * w:
        raise ValueError("Aisle polygon area is unsafe or implausible")
    mask = np.zeros((h, w), np.uint8)
    cv2.fillPoly(mask, [pts.astype(np.int32)], 255)
    return mask


def register(reference: np.ndarray, live: np.ndarray, params: Parameters) -> tuple[np.ndarray | None, dict[str, Any]]:
    """Map live pixels onto reference. Fail closed on weak visual registration."""
    if reference.shape != live.shape:
        return None, {"reason": "camera_dimensions_changed", "inliers": 0}
    orb = cv2.ORB_create(nfeatures=1400, fastThreshold=12, edgeThreshold=14)
    k_ref, d_ref = orb.detectAndCompute(cv2.cvtColor(reference, cv2.COLOR_BGR2GRAY), None)
    k_live, d_live = orb.detectAndCompute(cv2.cvtColor(live, cv2.COLOR_BGR2GRAY), None)
    if d_ref is None or d_live is None or len(k_ref) < 20 or len(k_live) < 20:
        return None, {"reason": "insufficient_texture", "inliers": 0}
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    pairs = matcher.knnMatch(d_live, d_ref, k=2)
    good = [a for group in pairs if len(group) == 2 for a, b in [group] if a.distance < 0.76 * b.distance]
    if len(good) < max(12, params.min_inliers):
        return None, {"reason": "insufficient_correspondences", "matches": len(good)}
    from_pts = np.float32([k_live[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    to_pts = np.float32([k_ref[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    H, inlier_mask = cv2.findHomography(from_pts, to_pts, cv2.RANSAC, 3.0)
    if H is None or inlier_mask is None or not np.isfinite(H).all():
        return None, {"reason": "homography_failed", "matches": len(good)}
    inliers = inlier_mask.ravel().astype(bool)
    n_inliers = int(inliers.sum())
    inlier_ratio = n_inliers / len(good)
    h, w = reference.shape[:2]
    coverage = 0.0
    if n_inliers >= 3:
        hull = cv2.convexHull(to_pts[inliers].reshape(-1, 2))
        coverage = float(cv2.contourArea(hull)) / (w * h)
    diag = {"matches": len(good), "inliers": n_inliers, "inlier_ratio": round(inlier_ratio, 3), "coverage": round(coverage, 3)}
    if n_inliers < params.min_inliers or inlier_ratio < params.min_inlier_ratio or coverage < params.min_coverage:
        return None, {**diag, "reason": "registration_weak"}
    corners = np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]]).reshape(-1, 1, 2)
    warped_corners = cv2.perspectiveTransform(corners, H).reshape(-1, 2)
    if np.any(np.abs(warped_corners) > 3 * max(w, h)):
        return None, {**diag, "reason": "unstable_homography"}
    aligned = cv2.warpPerspective(live, H, (w, h))
    return aligned, diag


def inspect(reference: np.ndarray, live: np.ndarray, vertices: list[list[int]], params: Parameters | None = None) -> dict[str, Any]:
    params = params or Parameters()
    check_image(reference)
    check_image(live)
    roi = polygon_mask(reference.shape, vertices)
    aligned, diag = register(reference, live, params)
    if aligned is None:
        return {"status": "ABSTAIN", "reason": diag.get("reason", "registration_failed"), "registration": diag, "regions": [], "change_fraction": None}
    # Opposing bright/dark illumination shifts are cancelled by robust signed Lab medians.
    ref_lab = cv2.cvtColor(reference, cv2.COLOR_BGR2LAB).astype(np.float32)
    live_lab = cv2.cvtColor(aligned, cv2.COLOR_BGR2LAB).astype(np.float32)
    whole = cv2.erode(roi, np.ones((7, 7), np.uint8)) > 0
    shifts = np.median((live_lab - ref_lab)[whole], axis=0)
    illum = float(np.max(np.abs(shifts)))
    if illum > params.max_illumination_shift:
        return {"status": "ABSTAIN", "reason": "illumination_changed", "registration": diag, "regions": [], "illumination_shift": round(illum, 2)}
    difference = np.abs(live_lab - ref_lab - shifts)
    # Lightness alone is not reliable: chroma+lightness residual count together.
    changed = (np.sqrt(np.mean(difference ** 2, axis=2)) > params.pixel_change_threshold).astype(np.uint8) * 255
    changed[roi == 0] = 0
    changed = cv2.morphologyEx(changed, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    changed = cv2.morphologyEx(changed, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    changed[roi == 0] = 0
    fraction = int(np.count_nonzero(changed)) / max(1, int(np.count_nonzero(roi)))
    if fraction > params.max_changed_fraction:
        return {"status": "ABSTAIN", "reason": "scene_changed_too_much", "registration": diag, "regions": [], "change_fraction": round(fraction, 4)}
    count, _, stats, _ = cv2.connectedComponentsWithStats(changed)
    min_area = max(params.min_area_pixels, int(np.count_nonzero(roi) * params.min_fraction))
    regions = []
    for row in stats[1:count]:
        x, y, w, h, area = map(int, row)
        if area >= min_area:
            regions.append({"box_xywh": [x, y, w, h], "area_px": area})
    regions.sort(key=lambda x: x["area_px"], reverse=True)
    return {
        "status": "CANDIDATE" if regions else "CLEAR_OBSERVED",
        "reason": "large_change_in_aisle" if regions else "no_large_change_in_aisle",
        "registration": diag,
        "illumination_shift": round(illum, 2),
        "change_fraction": round(fraction, 4),
        "regions": regions[:12],
    }


def orchestrate(reference: np.ndarray, first: np.ndarray, aisle: list[list[int]], second: np.ndarray | None = None) -> dict[str, Any]:
    """Visual evidence drives a second capture before any human-facing finding."""
    initial = inspect(reference, first, aisle)
    if initial["status"] == "ABSTAIN":
        return {"decision": "RETAKE_REQUIRED", "reason": initial["reason"], "first": initial, "second": None, "next_action": "operator_reframe_camera"}
    if initial["status"] == "CLEAR_OBSERVED":
        return {"decision": "OBSERVED_NO_CHANGE", "first": initial, "second": None, "next_action": "continue_periodic_inspection"}
    if second is None:
        return {"decision": "SECOND_VIEW_REQUIRED", "first": initial, "second": None, "next_action": "capture_independent_frame"}
    # A frozen feed or replayed frame is not an independent observation.
    # Equality checks pixels after decoding; distinct capture provenance must
    # still be established at the trusted ingestion boundary.
    if np.array_equal(first, second):
        return {
            "decision": "RETAKE_REQUIRED",
            "reason": "confirmation_frame_identical",
            "first": initial,
            "second": None,
            "next_action": "capture_new_confirmation_frame",
        }
    follow = inspect(reference, second, aisle)
    if follow["status"] == "ABSTAIN":
        return {"decision": "RETAKE_REQUIRED", "reason": "confirmation_unreliable", "first": initial, "second": follow, "next_action": "operator_reframe_camera"}
    if follow["status"] != "CANDIDATE":
        return {"decision": "DISAGREEMENT_REVIEW", "first": initial, "second": follow, "next_action": "human_review_no_automatic_clearance"}
    boxes = [r["box_xywh"] for r in initial["regions"]]
    follow_boxes = [r["box_xywh"] for r in follow["regions"]]
    def overlaps(a: list[int], b: list[int]) -> bool:
        ix = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
        iy = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
        union = a[2] * a[3] + b[2] * b[3] - ix * iy
        return ix * iy / max(1, union) >= 0.22
    matched = sum(any(overlaps(a, b) for b in follow_boxes) for a in boxes)
    return {
        "decision": "HUMAN_REVIEW_REQUIRED" if matched else "DISAGREEMENT_REVIEW",
        "first": initial, "second": follow, "persistent_regions": matched,
        "next_action": "enqueue_review_packet" if matched else "human_review_no_automatic_clearance",
    }


def mark_reference(reference: np.ndarray, vertices: list[list[int]], decision: dict[str, Any]) -> np.ndarray:
    annotated = reference.copy()
    cv2.polylines(annotated, [np.array(vertices, dtype=np.int32)], True, (255, 160, 0), 2)
    for region in decision.get("first", {}).get("regions", []):
        x, y, w, h = region["box_xywh"]
        cv2.rectangle(annotated, (x, y), (x + w, y + h), (0, 40, 220), 2)
    cv2.putText(annotated, decision["decision"], (12, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.68, (0, 0, 0), 3)
    cv2.putText(annotated, decision["decision"], (12, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.68, (250, 250, 250), 1)
    return annotated
