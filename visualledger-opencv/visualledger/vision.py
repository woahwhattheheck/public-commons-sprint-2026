"""Deterministic OpenCV measurements for finance-document intake.

Competition mode requires OpenCV 5.x. A development compatibility switch exists
only so source/evaluation work can run on hosts that still ship OpenCV 4.x; every
receipt records that it is not competition-runtime evidence.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
import hashlib
import math
import re
from typing import Any, Iterable

MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 24_000_000
FINGERPRINT_RE = re.compile(r"[0-9a-f]{16}\Z")


class VisionError(ValueError):
    pass


@dataclass(frozen=True)
class VisionPolicy:
    min_width: int = 320
    min_height: int = 320
    min_document_area_ppm: int = 180_000
    max_document_area_ppm: int = 990_000
    min_laplacian_variance_milli: int = 30_000
    min_contrast_milli: int = 25_000
    max_glare_ppm: int = 180_000
    min_edge_ppm: int = 5_000
    min_text_line_count: int = 12
    duplicate_hamming_max: int = 4
    max_prior_fingerprints: int = 512

    def validate(self) -> None:
        values = asdict(self)
        if any(type(v) is not int for v in values.values()):
            raise VisionError("policy fields must be plain integers")
        if not 64 <= self.min_width <= 10_000 or not 64 <= self.min_height <= 10_000:
            raise VisionError("invalid minimum image dimensions")
        if not 1 <= self.min_document_area_ppm < self.max_document_area_ppm <= 1_000_000:
            raise VisionError("invalid document-area thresholds")
        if not 0 <= self.max_glare_ppm <= 1_000_000:
            raise VisionError("invalid glare threshold")
        if not 0 <= self.duplicate_hamming_max <= 64:
            raise VisionError("invalid duplicate distance")
        if not 1 <= self.max_prior_fingerprints <= 10_000:
            raise VisionError("invalid prior fingerprint bound")


def _cv(cv2_module: Any | None, *, allow_opencv4_dev: bool) -> tuple[Any, Any, str, bool]:
    try:
        import numpy as np
        cv2 = cv2_module
        if cv2 is None:
            import cv2 as cv2_import
            cv2 = cv2_import
    except Exception as exc:  # pragma: no cover - dependency absence is environment-specific
        raise VisionError("OpenCV and NumPy are required") from exc
    version = str(getattr(cv2, "__version__", ""))
    try:
        major = int(version.split(".", 1)[0])
    except (ValueError, IndexError) as exc:
        raise VisionError("unparseable OpenCV version") from exc
    competition = major >= 5
    if not competition and not allow_opencv4_dev:
        raise VisionError("competition mode requires OpenCV 5.x")
    return cv2, np, version, competition


def _int_metric(value: float, scale: int = 1000) -> int:
    if not math.isfinite(value):
        raise VisionError("non-finite vision metric")
    return int(round(value * scale))


def _canonical_quad(points: Any, np: Any) -> Any:
    pts = np.asarray(points, dtype=np.float32).reshape(4, 2)
    sums = pts.sum(axis=1)
    diffs = np.diff(pts, axis=1).reshape(-1)
    ordered = np.empty((4, 2), dtype=np.float32)
    ordered[0] = pts[int(np.argmin(sums))]   # top-left
    ordered[2] = pts[int(np.argmax(sums))]   # bottom-right
    ordered[1] = pts[int(np.argmin(diffs))]  # top-right
    ordered[3] = pts[int(np.argmax(diffs))]  # bottom-left
    return ordered


def _warp_document(image: Any, quad: Any, cv2: Any, np: Any) -> Any:
    src = _canonical_quad(quad, np)
    tl, tr, br, bl = src
    width = max(int(round(np.linalg.norm(br - bl))), int(round(np.linalg.norm(tr - tl))))
    height = max(int(round(np.linalg.norm(tr - br))), int(round(np.linalg.norm(tl - bl))))
    if width < 64 or height < 64:
        raise VisionError("detected document geometry is too small")
    width = min(width, 1600)
    height = min(height, 2200)
    dst = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(image, matrix, (width, height), flags=cv2.INTER_LINEAR)


def _document_quads(gray: Any, cv2: Any, np: Any, policy: VisionPolicy) -> list[tuple[int, Any]]:
    h, w = gray.shape[:2]
    total = h * w
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(closed, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    found: list[tuple[int, Any]] = []
    for contour in contours:
        area = float(cv2.contourArea(contour))
        ppm = int(round(area * 1_000_000 / total))
        if not policy.min_document_area_ppm <= ppm <= policy.max_document_area_ppm:
            continue
        perimeter = float(cv2.arcLength(contour, True))
        if perimeter <= 0:
            continue
        approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(approx) == 4 and bool(cv2.isContourConvex(approx)):
            found.append((ppm, approx.reshape(4, 2)))
    found.sort(key=lambda item: item[0], reverse=True)
    # Nested contours around the same document border are common. Deduplicate by area.
    dedup: list[tuple[int, Any, float, float]] = []
    for ppm, quad in found:
        center_x = float(np.asarray(quad)[:, 0].mean())
        center_y = float(np.asarray(quad)[:, 1].mean())
        if any(abs(center_x - px) <= 0.04 * w and abs(center_y - py) <= 0.04 * h for _, _, px, py in dedup):
            continue
        dedup.append((ppm, quad, center_x, center_y))
    return [(ppm, quad) for ppm, quad, _, _ in dedup[:4]]


def _text_lines(gray: Any, cv2: Any) -> int:
    if gray.shape[1] < 64 or gray.shape[0] < 64:
        return 0
    edges = cv2.Canny(gray, 50, 150)
    minimum = max(40, gray.shape[1] // 8)
    lines = cv2.HoughLinesP(
        edges, 1, math.pi / 180.0, threshold=40,
        minLineLength=minimum, maxLineGap=max(10, gray.shape[1] // 50),
    )
    if lines is None:
        return 0
    # Python bindings expose Hough segments as (N, 1, 4) in OpenCV 4
    # and (N, 4) in newer bindings. Normalize only those supported layouts;
    # a blind reshape could reinterpret an unrelated/malformed array.
    shape = getattr(lines, "shape", ())
    if len(shape) == 3 and shape[1:] == (1, 4):
        rows = lines[:, 0, :]
    elif len(shape) == 2 and shape[1] == 4:
        rows = lines
    else:
        raise VisionError("unexpected HoughLinesP segment array shape")
    ys: list[int] = []
    for row in rows:
        x1, y1, x2, y2 = map(int, row)
        dx = abs(x2 - x1)
        dy = abs(y2 - y1)
        if dx < minimum or dy > max(4, dx // 20):
            continue
        y = (y1 + y2) // 2
        if y < gray.shape[0] * 0.04 or y > gray.shape[0] * 0.96:
            continue
        if all(abs(y - prior) > 6 for prior in ys):
            ys.append(y)
    return len(ys)


def _dhash(gray: Any, cv2: Any) -> str:
    small = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)
    bits = small[:, 1:] > small[:, :-1]
    value = 0
    for bit in bits.flatten().tolist():
        value = (value << 1) | int(bool(bit))
    return f"{value:016x}"


def hamming(a: str, b: str) -> int:
    if FINGERPRINT_RE.fullmatch(a) is None or FINGERPRINT_RE.fullmatch(b) is None:
        raise VisionError("fingerprints must be lowercase 16-hex dHash values")
    return (int(a, 16) ^ int(b, 16)).bit_count()


def _prior(values: Iterable[dict[str, Any]], policy: VisionPolicy) -> list[dict[str, str]]:
    if type(values) not in (list, tuple):
        raise VisionError("prior_fingerprints must be a list or tuple")
    if len(values) > policy.max_prior_fingerprints:
        raise VisionError("prior fingerprint index exceeds bound")
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in values:
        if type(row) is not dict or set(row) != {"evidence_id", "fingerprint"}:
            raise VisionError("invalid prior fingerprint row")
        evidence_id, fingerprint = row["evidence_id"], row["fingerprint"]
        if type(evidence_id) is not str or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}", evidence_id):
            raise VisionError("invalid prior evidence id")
        if type(fingerprint) is not str or FINGERPRINT_RE.fullmatch(fingerprint) is None:
            raise VisionError("invalid prior fingerprint")
        if evidence_id in seen:
            raise VisionError("duplicate prior evidence id")
        seen.add(evidence_id)
        out.append({"evidence_id": evidence_id, "fingerprint": fingerprint})
    return out


def analyze_image(
    raw: bytes,
    *,
    prior_fingerprints: list[dict[str, str]] | tuple[dict[str, str], ...] = (),
    policy: VisionPolicy | None = None,
    allow_opencv4_dev: bool = False,
    cv2_module: Any | None = None,
) -> dict[str, Any]:
    """Analyze one encoded finance-document image and return deterministic measurements."""
    if type(raw) is not bytes or not raw or len(raw) > MAX_IMAGE_BYTES:
        raise VisionError("image must be non-empty bytes within the size bound")
    policy = policy or VisionPolicy()
    policy.validate()
    prior = _prior(prior_fingerprints, policy)
    cv2, np, version, competition = _cv(cv2_module, allow_opencv4_dev=allow_opencv4_dev)
    encoded = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if image is None or getattr(image, "ndim", 0) != 3 or image.shape[2] != 3:
        raise VisionError("OpenCV could not decode a three-channel image")
    height, width = map(int, image.shape[:2])
    if width < policy.min_width or height < policy.min_height:
        raise VisionError("image dimensions below minimum")
    if width * height > MAX_PIXELS:
        raise VisionError("image pixel count exceeds bound")

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    quads = _document_quads(gray, cv2, np, policy)
    normalized = _warp_document(image, quads[0][1], cv2, np) if quads else image
    normalized_gray = cv2.cvtColor(normalized, cv2.COLOR_BGR2GRAY)

    lap = float(cv2.Laplacian(normalized_gray, cv2.CV_64F).var())
    contrast = float(normalized_gray.std())
    glare = float((normalized_gray >= 245).mean())
    edges = cv2.Canny(normalized_gray, 60, 180)
    edge_fraction = float((edges > 0).mean())
    line_count = int(_text_lines(normalized_gray, cv2))
    fingerprint = _dhash(normalized_gray, cv2)

    ok, png = cv2.imencode(".png", normalized, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    if not ok:
        raise VisionError("OpenCV failed to encode normalized evidence")
    normalized_bytes = bytes(png.tobytes())

    nearest: dict[str, Any] | None = None
    for row in prior:
        distance = hamming(fingerprint, row["fingerprint"])
        candidate = {"evidence_id": row["evidence_id"], "hamming": distance}
        if nearest is None or (distance, row["evidence_id"]) < (nearest["hamming"], nearest["evidence_id"]):
            nearest = candidate

    return {
        "schema": "visualledger-vision/v1",
        "opencv_version": version,
        "competition_opencv5_runtime": competition,
        "development_compatibility_used": not competition,
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "source_bytes": len(raw),
        "width": width,
        "height": height,
        "document_candidate_count": len(quads),
        "primary_document_area_ppm": quads[0][0] if quads else 0,
        "laplacian_variance_milli": _int_metric(lap),
        "contrast_milli": _int_metric(contrast),
        "glare_ppm": _int_metric(glare, 1_000_000),
        "edge_ppm": _int_metric(edge_fraction, 1_000_000),
        "text_line_count": line_count,
        "fingerprint_dhash64": fingerprint,
        "nearest_prior": nearest,
        "normalized_png_sha256": hashlib.sha256(normalized_bytes).hexdigest(),
        "normalized_width": int(normalized.shape[1]),
        "normalized_height": int(normalized.shape[0]),
        "policy": asdict(policy),
    }
