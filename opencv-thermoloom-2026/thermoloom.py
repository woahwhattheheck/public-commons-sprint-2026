# SPDX-License-Identifier: MIT
"""ThermoLoom: conservative visual anomaly triage of *uncalibrated* PV grayscale images.

This reports relative pixel anomalies, NEVER degrees, electrical faults, or safety clearance.
Input geometry is an operator-provided four-corner outline ordered TL, TR, BR, BL.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np

MAX_PIXELS = 8_000_000
MAX_IMAGE_BYTES = 8 * 1024 * 1024


class ImageRejected(ValueError):
    """A capture cannot safely be interpreted as a PV inspection."""


def decode_image(payload: bytes) -> np.ndarray:
    if not isinstance(payload, bytes) or not payload or len(payload) > MAX_IMAGE_BYTES:
        raise ImageRejected("image bytes missing or above 8 MiB bound")
    source = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    if source is None:
        raise ImageRejected("unsupported or corrupt image")
    if source.ndim != 2 or source.dtype not in (np.dtype('uint8'), np.dtype('uint16')):
        raise ImageRejected("use a single-channel 8/16-bit grayscale capture; pseudo-color is unsafe")
    if source.size > MAX_PIXELS or min(source.shape) < 64:
        raise ImageRejected("image geometry is too small or exceeds pixel bound")
    return source


def _rectify(image: np.ndarray, corners: list[list[float]] | None) -> np.ndarray:
    if corners is None:
        return image
    points = np.asarray(corners, dtype=np.float64)
    h, w = image.shape
    if (points.shape != (4, 2) or not np.isfinite(points).all()
        or (points[:, 0] < 0).any() or (points[:, 0] >= w).any()
        or (points[:, 1] < 0).any() or (points[:, 1] >= h).any()):
        raise ImageRejected("four finite TL/TR/BR/BL image-pixel corners required")
    vertices = points.astype(np.float32)
    if not cv2.isContourConvex(vertices) or abs(cv2.contourArea(vertices)) < 0.1 * w * h:
        raise ImageRejected("panel-array outline is nonconvex or too small")
    # Reject reversed and crossed corner order rather than silently mirror the row mapping.
    if (points[1, 0] <= points[0, 0] or points[2, 0] <= points[3, 0]
        or points[3, 1] <= points[0, 1] or points[2, 1] <= points[1, 1]):
        raise ImageRejected("corners must describe the expected TL/TR/BR/BL orientation")
    target = np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]])
    homography = cv2.getPerspectiveTransform(vertices, target)
    if not np.isfinite(homography).all():
        raise ImageRejected("ill-conditioned panel alignment")
    return cv2.warpPerspective(image, homography, (w, h), flags=cv2.INTER_LINEAR,
                               borderMode=cv2.BORDER_REPLICATE)


def _to_intensity(image: np.ndarray) -> tuple[np.ndarray, float]:
    vals = image.astype(np.float32)
    p1, p99 = np.percentile(vals, (1, 99))
    dynamic = float(p99 - p1)
    if image.dtype == np.uint16:
        # Scale is strictly *within-capture*; no temperature calibration implied.
        if dynamic < 24:
            return np.zeros(image.shape, dtype=np.uint8), dynamic
        vals = (vals - p1) * (220 / dynamic) + 18
        vals = np.clip(vals, 0, 255)
    return vals.astype(np.uint8), dynamic


def _capture_digest(image: np.ndarray, rows: int, cols: int, threshold_mode: str) -> str:
    """The pre-existing v1 fingerprint, shared by inspection and drawing."""
    version = f'|{rows}|{cols}|v1'.encode()
    suffix = b'' if threshold_mode == "peer" else b'|panel'
    return hashlib.sha256(image.tobytes() + version + suffix).hexdigest()


def _quality(gray: np.ndarray, source_dynamic: float, rows: int, cols: int) -> list[str]:
    h, w = gray.shape
    reasons = []
    if h // rows < 24 or w // cols < 24:
        reasons.append("panel cells are under 24 pixels; recapture closer")
    if source_dynamic < (24 if source_dynamic > 255 else 8):
        reasons.append("capture has insufficient grayscale contrast")
    if np.mean(gray == 255) > 0.12 or np.mean(gray == 0) > 0.15:
        reasons.append("large clipped-intensity region obscures comparison")
    return reasons


def inspect(image: np.ndarray, *, rows: int = 4, cols: int = 6,
            corners: list[list[float]] | None = None,
            threshold_mode: str = "peer") -> dict[str, Any]:
    """Return human-owned triage; panel-local thresholding is strictly opt-in."""
    if type(threshold_mode) is not str or threshold_mode not in {"peer", "panel"}:
        raise ImageRejected("threshold_mode must be peer or panel")
    if type(rows) is not int or type(cols) is not int or not (2 <= rows <= 12 and 2 <= cols <= 12):
        raise ImageRejected("rows and cols must each be integers from 2 through 12")
    if image.ndim != 2 or image.dtype not in (np.dtype('uint8'), np.dtype('uint16')):
        raise ImageRejected("expected one-channel uint8/uint16 image")
    if image.size > MAX_PIXELS or min(image.shape) < 64:
        raise ImageRejected("invalid image size")
    corrected = _rectify(image, corners)
    gray, dynamic = _to_intensity(corrected)
    # Preserve every incumbent peer-mode fingerprint, but avoid aliasing distinct
    # decisions when the same pixels are deliberately scored in both modes.
    digest = _capture_digest(corrected, rows, cols, threshold_mode)
    reasons = _quality(gray, dynamic, rows, cols)
    base = {"schema": "thermoloom-visual-triage/v1", "capture_sha256": digest,
            "calibrated_temperature": False, "panel_layout": {"rows": rows, "cols": cols},
            "pixel_space": "rectified" if corners is not None else "input", "opencv_version": cv2.__version__}
    if threshold_mode == "panel":
        base["threshold_mode"] = "panel"
    if reasons:
        return {**base, "decision": "RETAKE", "review_required": True,
                "reasons": reasons, "evidence": [], "panel_medians": [],
                "next_action": "Obtain a grayscale capture with visible panels; human confirms geometry."}

    h, w = gray.shape
    cells: list[dict[str, Any]] = []
    for row in range(rows):
        for col in range(cols):
            x0, x1 = round(col * w / cols), round((col + 1) * w / cols)
            y0, y1 = round(row * h / rows), round((row + 1) * h / rows)
            pad_x = max(2, int(0.08 * (x1 - x0)))
            pad_y = max(2, int(0.08 * (y1 - y0)))
            x0, y0, x1, y1 = x0 + pad_x, y0 + pad_y, x1 - pad_x, y1 - pad_y
            patch = gray[y0:y1, x0:x1]
            if patch.size < 400:
                raise ImageRejected("grid too fine for image resolution")
            cells.append({"row": row, "col": col, "bounds": [x0, y0, x1, y1],
                          "median": float(np.median(patch)), "pixels": patch})
    medians = np.asarray([p["median"] for p in cells], dtype=np.float64)
    median_peer = float(np.median(medians))
    panel_mad = float(np.median(np.abs(medians - median_peer)))
    # Across-panel intensity drift is tolerated; a connected *localized* excess
    # must still clear a conservative image-relative floor.
    anomaly_delta = max(26.0, 5.0 * 1.4826 * panel_mad)
    evidence: list[dict[str, Any]] = []
    med_records: list[dict[str, Any]] = []
    for cell in cells:
        x0, y0, x1, y1 = cell["bounds"]
        patch = cell["pixels"]
        peak = float(np.percentile(patch, 99))
        record = {"row": cell["row"], "col": cell["col"],
                  "median_pixel": cell["median"], "p99_pixel": peak}
        if threshold_mode == "panel":
            # A fixed peer-global cut becomes too high as harmless broad lighting
            # gradients increase between-panel MAD. A local robust cutoff retains
            # sensitivity to small *within-panel* excess regions instead.
            local_mad = float(np.median(np.abs(patch.astype(np.float32) - cell["median"])))
            local_delta = max(26.0, 5.0 * 1.4826 * local_mad)
            baseline = cell["median"]
            cutoff = baseline + local_delta
            record.update({"local_mad_pixel": round(local_mad, 2),
                           "local_delta_pixel": round(local_delta, 2),
                           "cutoff_pixel": round(cutoff, 2)})
        else:
            baseline = median_peer
            cutoff = median_peer + anomaly_delta
        med_records.append(record)
        hot = (patch.astype(np.float32) >= cutoff).astype(np.uint8)
        hot = cv2.morphologyEx(hot, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        n, labels, stats, _ = cv2.connectedComponentsWithStats(hot, connectivity=8)
        min_area = max(6, round(0.002 * patch.size))
        for idx in range(1, n):
            sx, sy, sw, sh, area = (int(a) for a in stats[idx])
            if area < min_area or area >= 0.30 * patch.size:
                continue
            local = patch[labels == idx]
            delta = round(float(np.median(local)) - baseline, 2)
            evidence.append({"row": cell["row"], "col": cell["col"],
                             "bbox_xywh": [x0 + sx, y0 + sy, sw, sh],
                             "area_pixels": area, "relative_intensity_delta": delta,
                             "reason": ("connected region exceeds panel-local robust pixel baseline"
                                        if threshold_mode == "panel" else
                                        "connected region exceeds peer-relative pixel baseline")})
    evidence.sort(key=lambda item: (-item["relative_intensity_delta"], item["row"], item["col"]))
    is_alert = bool(evidence)
    threshold = {"peer_median_pixel": round(median_peer, 2),
                 "anomaly_delta_pixel": round(anomaly_delta, 2),
                 "panel_mad_pixel": round(panel_mad, 2)}
    if threshold_mode == "panel":
        # Retain the incumbent global reference as comparison metadata, while
        # recording the actual per-panel cutoffs in panel_medians.
        threshold["applied_mode"] = "panel_local_median_mad"
    return {**base, "decision": "HUMAN_REVIEW" if is_alert else "MONITOR",
            "review_required": is_alert, "reasons": (["uncalibrated relative anomaly; field diagnosis required"]
                                            if is_alert else []),
            "threshold": threshold,
            "panel_medians": med_records, "evidence": evidence,
            "next_action": ("Confirm capture quality and inspect flagged panels; no autonomous electrical action."
                            if is_alert else "Monitor; no visible relative outlier in this capture.")}


def overlay(image: np.ndarray, report: dict[str, Any], *,
            corners: list[list[float]] | None = None) -> np.ndarray:
    """Annotate the exact input or perspective-rectified pixels that were inspected."""
    space = report.get("pixel_space")
    if space == "rectified":
        if corners is None:
            raise ImageRejected("rectified overlay requires the inspection's four corners")
        frame = _rectify(image, corners)
    elif space == "input":
        if corners is not None:
            raise ImageRejected("input-space report must not be drawn with rectification")
        frame = image
    else:
        raise ImageRejected("unknown report pixel space")
    layout = report.get("panel_layout")
    if not isinstance(layout, dict):
        raise ImageRejected("report panel layout missing")
    rows, cols = layout.get("rows"), layout.get("cols")
    mode = report.get("threshold_mode", "peer")
    if (type(rows) is not int or type(cols) is not int
            or type(mode) is not str or mode not in {"peer", "panel"}):
        raise ImageRejected("report fingerprint parameters invalid")
    if _capture_digest(frame, rows, cols, mode) != report.get("capture_sha256"):
        raise ImageRejected("overlay pixels or perspective corners do not match inspection")
    gray, _ = _to_intensity(frame)
    canvas = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    for box in report["evidence"]:
        x, y, w, h = box["bbox_xywh"]
        cv2.rectangle(canvas, (x, y), (x + w, y + h), (0, 0, 255), 2)
    cv2.putText(canvas, report["decision"], (12, 30), cv2.FONT_HERSHEY_SIMPLEX,
                0.7, (255, 255, 255), 2, cv2.LINE_AA)
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser(description="Conservative uncalibrated PV grayscale image triage")
    parser.add_argument("image", type=Path)
    parser.add_argument("--rows", type=int, default=4)
    parser.add_argument("--cols", type=int, default=6)
    parser.add_argument("--threshold-mode", choices=("peer", "panel"), default="peer",
                        help="opt-in panel-local synthetic candidate; default keeps incumbent")
    parser.add_argument("--corners-json", type=Path, help="ordered TL,TR,BR,BL pixel corners")
    parser.add_argument("--out", type=Path, help="write JSON receipt")
    parser.add_argument("--overlay", type=Path, help="write image evidence only without rectification")
    args = parser.parse_args()
    try:
        source = decode_image(args.image.read_bytes())
        corners = json.loads(args.corners_json.read_text()) if args.corners_json else None
        receipt = inspect(source, rows=args.rows, cols=args.cols, corners=corners,
                          threshold_mode=args.threshold_mode)
        if args.overlay:
            if not cv2.imwrite(str(args.overlay), overlay(source, receipt, corners=corners)):
                raise OSError("unable to write evidence overlay")
        rendered = json.dumps(receipt, indent=2, sort_keys=True)
        if args.out:
            args.out.write_text(rendered + "\n", encoding="utf-8")
        print(rendered)
    except (ImageRejected, OSError, ValueError) as exc:
        parser.exit(status=2, message=f"thermoloom: {exc}\n")


if __name__ == "__main__":
    main()
