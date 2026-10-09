"""Bounded, evidence-first visual comparison of a reference and a candidate photo.

Never makes an automatic pass/fail safety decision. Real subject alignment must be
independently confirmed; an inconclusive frame asks for recapture.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from .header_guard import ImageHeaderError, admit_image_header

MAX_IMAGE_BYTES = 4_000_000
MAX_PIXELS = 5_000_000
MAX_SIDE = 2600


class EvidenceError(ValueError):
    """Invalid input, not a product/part quality judgment."""


@dataclass(frozen=True)
class Settings:
    max_regions: int = 12
    min_matches: int = 24
    min_inlier_ratio: float = 0.35
    min_coverage: float = 0.72
    max_reprojection_px: float = 4.0
    min_region_pixels: int = 110
    min_region_fraction: float = 0.00012
    min_region_fill: float = 0.42  # this detector targets compact missing components


def _decode(payload: bytes, name: str) -> np.ndarray:
    if not isinstance(payload, bytes) or not 0 < len(payload) <= MAX_IMAGE_BYTES:
        raise EvidenceError(f"{name}: image bytes missing or outside 4 MB limit")
    try:
        admit_image_header(payload, min_side=160, max_side=MAX_SIDE,
                           max_pixels=MAX_PIXELS)
    except ImageHeaderError as exc:
        raise EvidenceError(f"{name}: {exc}") from exc
    raw = np.frombuffer(payload, dtype=np.uint8)
    image = cv2.imdecode(raw, cv2.IMREAD_COLOR)
    if image is None or image.ndim != 3 or image.shape[2] != 3:
        raise EvidenceError(f"{name}: could not decode a color image")
    h, w = image.shape[:2]
    if min(h, w) < 160 or max(h, w) > MAX_SIDE or h * w > MAX_PIXELS:
        raise EvidenceError(f"{name}: dimensions outside admitted range")
    return image


def _result(decision: str, action: str, *, alignment: dict[str, Any],
            regions: list[dict[str, Any]], warnings: list[str]) -> dict[str, Any]:
    return {
        "schema": "witnessalign-visual-audit/v1",
        "decision": decision,
        "human_action": action,
        "alignment": alignment,
        "candidate_regions": regions,
        "warnings": warnings,
        "authority": {
            "automatic_quality_acceptance": False,
            "automatic_rejection": False,
            "human_review_required": True,
            "source_images_retained": False,
            "visual_observation_only": True,
        },
    }


def _recapture(reason: str, alignment: dict[str, Any] | None = None) -> tuple[dict[str, Any], None]:
    return _result(
        "recapture_required", "Retake photo with full, sharp fixture visible at a matching angle.",
        alignment=alignment or {"status": "unresolved"}, regions=[], warnings=[reason],
    ), None


def _align(ref: np.ndarray, candidate: np.ndarray, settings: Settings):
    ref_gray = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY)
    cand_gray = cv2.cvtColor(candidate, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    ref_feat, cand_feat = clahe.apply(ref_gray), clahe.apply(cand_gray)
    orb = cv2.ORB_create(nfeatures=2600, fastThreshold=12)
    kr, dr = orb.detectAndCompute(ref_feat, None)
    kc, dc = orb.detectAndCompute(cand_feat, None)
    count_r, count_c = len(kr), len(kc)
    if dr is None or dc is None or min(count_r, count_c) < settings.min_matches:
        return None, None, {"status": "unresolved", "reference_keypoints": count_r,
                                "candidate_keypoints": count_c}, "insufficient distinctive features"
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False).knnMatch(dc, dr, k=2)
    good = [m for pair in pairs if len(pair) == 2
            for m, n in [pair] if m.distance < 0.73 * n.distance]
    if len(good) < settings.min_matches:
        return None, None, {"status": "unresolved", "good_matches": len(good)}, "too few reliable feature correspondences"
    source = np.float32([kc[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    target = np.float32([kr[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    transform, inliers = cv2.findHomography(source, target, cv2.RANSAC, 3.25)
    if transform is None or inliers is None or not np.isfinite(transform).all():
        return None, None, {"status": "unresolved", "good_matches": len(good)}, "homography estimation failed"
    mask = inliers.ravel() != 0
    count = int(np.count_nonzero(mask))
    ratio = count / len(good)
    projected = cv2.perspectiveTransform(source[mask], transform)
    residuals = np.linalg.norm((projected - target[mask]).reshape(-1, 2), axis=1)
    median_px = float(np.median(residuals)) if residuals.size else 1e6
    h, w = ref.shape[:2]
    original_valid = np.full(candidate.shape[:2], 255, dtype=np.uint8)
    covered = cv2.warpPerspective(original_valid, transform, (w, h),
                                  flags=cv2.INTER_NEAREST, borderValue=0) > 0
    coverage = float(np.mean(covered))
    info = {"status": "resolved", "reference_keypoints": count_r,
            "candidate_keypoints": count_c, "good_matches": len(good),
            "ransac_inliers": count, "inlier_fraction": round(ratio, 4),
            "median_reprojection_px": round(median_px, 3),
            "reference_coverage": round(coverage, 4)}
    if ratio < settings.min_inlier_ratio or median_px > settings.max_reprojection_px or coverage < settings.min_coverage:
        info["status"] = "low_confidence"
        return None, None, info, "registration quality or coverage below review threshold"
    aligned = cv2.warpPerspective(candidate, transform, (w, h),
                                  flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0))
    return aligned, covered, info, None


def _regions(ref: np.ndarray, aligned: np.ndarray, covered: np.ndarray,
             settings: Settings) -> tuple[list[dict[str, Any]], np.ndarray, dict[str, Any]]:
    # Suppress low-frequency exposure changes, retaining localized shape/texture changes.
    a = cv2.GaussianBlur(cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY), (5, 5), 0).astype(np.float32)
    b = cv2.GaussianBlur(cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY), (5, 5), 0).astype(np.float32)
    delta = b - a
    local_light = cv2.GaussianBlur(delta, (0, 0), sigmaX=31)
    residual = np.abs(delta - local_light)
    # Boundary strips are excluded, avoiding artifacts of padding/resampling.
    safe = cv2.erode(covered.astype(np.uint8), np.ones((13, 13), np.uint8), iterations=1) != 0
    levels = residual[safe]
    if levels.size < 10_000:
        raise EvidenceError("insufficient valid pixels after border exclusion")
    median = float(np.median(levels))
    mad = float(np.median(np.abs(levels - median)))
    threshold = max(20.0, median + 5.0 * max(mad, 1.0))
    suspect = ((residual > threshold) & safe).astype(np.uint8) * 255
    suspect = cv2.morphologyEx(suspect, cv2.MORPH_OPEN,
                              cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    suspect = cv2.morphologyEx(suspect, cv2.MORPH_CLOSE,
                              cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    labels, components, stats, centers = cv2.connectedComponentsWithStats(suspect)
    minimum = max(settings.min_region_pixels, int(ref.shape[0] * ref.shape[1] * settings.min_region_fraction))
    found = []
    for index in range(1, labels):
        x, y, width, height, area = [int(v) for v in stats[index]]
        if area < minimum or area / max(1, width * height) < settings.min_region_fill:
            # Sparse alignment-edge ghosts are not compact component candidates.
            continue
        support = residual[y:y + height, x:x + width][components[y:y + height, x:x + width] == index]
        found.append({"box_xywh": [x, y, width, height], "changed_pixels": area,
                      "mean_residual": round(float(support.mean()), 2),
                      "pixel_fraction": round(area / (ref.shape[0] * ref.shape[1]), 6)})
    found.sort(key=lambda row: row["changed_pixels"] * row["mean_residual"], reverse=True)
    found = found[:settings.max_regions]
    stats_info = {"residual_median": round(median, 2), "residual_mad": round(mad, 2),
                  "threshold": round(threshold, 2), "min_region_pixels": minimum,
                  "min_region_fill": settings.min_region_fill}
    return found, suspect, stats_info


def analyze(reference_bytes: bytes, candidate_bytes: bytes,
            *, settings: Settings | None = None) -> tuple[dict[str, Any], bytes | None]:
    """Return bounded triage evidence and annotated PNG, or recapture instructions.

    Neither outcome can serve as autonomous inspection signoff.
    """
    settings = settings or Settings()
    ref = _decode(reference_bytes, "reference")
    candidate = _decode(candidate_bytes, "candidate")
    aligned, covered, alignment, error = _align(ref, candidate, settings)
    if error:
        return _recapture(error, alignment)
    try:
        regions, suspect, metrics = _regions(ref, aligned, covered, settings)
    except EvidenceError as exc:
        return _recapture(str(exc), alignment)
    annotated = aligned.copy()
    # Coverage is explicitly shown; missing border pixels are not considered inspected.
    outline = cv2.Canny((covered.astype(np.uint8) * 255), 30, 80)
    annotated[outline > 0] = (0, 225, 255)
    for index, row in enumerate(regions, 1):
        x, y, w, h = row["box_xywh"]
        cv2.rectangle(annotated, (x, y), (x + w, y + h), (0, 0, 255), 3)
        cv2.putText(annotated, f"REVIEW {index}", (x, max(20, y - 9)),
                    cv2.FONT_HERSHEY_SIMPLEX, .55, (255, 255, 255), 3, cv2.LINE_AA)
        cv2.putText(annotated, f"REVIEW {index}", (x, max(20, y - 9)),
                    cv2.FONT_HERSHEY_SIMPLEX, .55, (0, 0, 220), 1, cv2.LINE_AA)
    cv2.putText(annotated, "HUMAN INSPECTION REQUIRED", (12, ref.shape[0] - 18),
                cv2.FONT_HERSHEY_SIMPLEX, .8, (255, 255, 255), 4, cv2.LINE_AA)
    cv2.putText(annotated, "HUMAN INSPECTION REQUIRED", (12, ref.shape[0] - 18),
                cv2.FONT_HERSHEY_SIMPLEX, .8, (20, 20, 20), 2, cv2.LINE_AA)
    ok, buffer = cv2.imencode(".png", annotated, [cv2.IMWRITE_PNG_COMPRESSION, 6])
    if not ok:
        raise EvidenceError("annotated preview encoding failed")
    decision = "review_required" if regions else "no_regions_above_threshold"
    human_action = ("Inspect candidate red regions against the reference image."
                    if regions else "Perform normal manual inspection; this is not quality clearance.")
    return _result(decision, human_action, alignment={**alignment, "detector": metrics},
                   regions=regions, warnings=["Photo registration and visual residuals do not prove a defect.",
                                             "Gold-reference drift, reflections, shadows and occlusions require manual review."]), buffer.tobytes()
