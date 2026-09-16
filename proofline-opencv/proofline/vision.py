from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from .codec import digest_json, sha256_hex

PIPELINE_GENERATION = "proofline-opencv-v1"
MAX_IMAGE_BYTES = 24 * 1024 * 1024
MAX_PIXELS = 24_000_000
MAX_REGIONS = 64


class VisionError(ValueError):
    pass


@dataclass(frozen=True)
class InspectionConfig:
    min_region_area_px: int = 36
    min_delta: int = 24
    max_regions: int = 32
    ecc_iterations: int = 80
    ecc_epsilon: float = 1e-6

    def validate(self) -> None:
        if not 4 <= self.min_region_area_px <= 1_000_000:
            raise VisionError("min_region_area_px out of bounds")
        if not 1 <= self.min_delta <= 255:
            raise VisionError("min_delta out of bounds")
        if not 1 <= self.max_regions <= MAX_REGIONS:
            raise VisionError("max_regions out of bounds")
        if not 5 <= self.ecc_iterations <= 500:
            raise VisionError("ecc_iterations out of bounds")
        if not 0 < self.ecc_epsilon < 1:
            raise VisionError("ecc_epsilon out of bounds")


def require_opencv5(*, version: str | None = None, allow_v4_dev: bool = False) -> str:
    actual = version or cv2.__version__
    try:
        major = int(actual.split(".", 1)[0])
    except (ValueError, IndexError) as exc:
        raise VisionError(f"unparseable OpenCV version: {actual!r}") from exc
    if major < 5 and not allow_v4_dev:
        raise VisionError(f"OpenCV 5.x required for competition runtime; found {actual}")
    return actual


def _decode_image(raw: bytes) -> np.ndarray:
    if not isinstance(raw, (bytes, bytearray)) or not raw:
        raise VisionError("image bytes are required")
    if len(raw) > MAX_IMAGE_BYTES:
        raise VisionError("image exceeds byte limit")
    buf = np.frombuffer(bytes(raw), dtype=np.uint8)
    image = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if image is None or image.ndim != 3 or image.shape[2] != 3:
        raise VisionError("image could not be decoded as 3-channel color")
    height, width = image.shape[:2]
    if height < 32 or width < 32:
        raise VisionError("image is too small")
    if height * width > MAX_PIXELS:
        raise VisionError("image exceeds pixel limit")
    return image


def _as_gray(image: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def _align_ecc(reference: np.ndarray, inspection: np.ndarray, config: InspectionConfig) -> tuple[np.ndarray, list[list[float]], float]:
    if reference.shape != inspection.shape:
        raise VisionError("reference and inspection dimensions must match")
    ref_gray = _as_gray(reference).astype(np.float32) / 255.0
    ins_gray = _as_gray(inspection).astype(np.float32) / 255.0
    warp = np.eye(2, 3, dtype=np.float32)
    criteria = (
        cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT,
        config.ecc_iterations,
        config.ecc_epsilon,
    )
    try:
        score, warp = cv2.findTransformECC(
            ref_gray,
            ins_gray,
            warp,
            cv2.MOTION_AFFINE,
            criteria,
            None,
            1,
        )
    except cv2.error as exc:
        raise VisionError("affine registration failed") from exc
    if not math.isfinite(float(score)) or float(score) < 0.25:
        raise VisionError("registration confidence below fail-closed floor")
    aligned = cv2.warpAffine(
        inspection,
        warp,
        (reference.shape[1], reference.shape[0]),
        flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
        borderMode=cv2.BORDER_REFLECT101,
    )
    matrix = [[round(float(value), 8) for value in row] for row in warp.tolist()]
    return aligned, matrix, round(float(score), 8)


def _segment_regions(reference: np.ndarray, aligned: np.ndarray, config: InspectionConfig) -> tuple[list[dict[str, Any]], np.ndarray, int]:
    delta = cv2.absdiff(reference, aligned)
    gray = cv2.cvtColor(delta, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    otsu, _ = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    threshold_value = max(config.min_delta, int(round(float(otsu))))
    mask = np.where(blurred >= threshold_value, 255, 0).astype(np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    candidates: list[dict[str, Any]] = []
    total_pixels = reference.shape[0] * reference.shape[1]
    for label in range(1, count):
        x, y, w, h, area = [int(v) for v in stats[label]]
        if area < config.min_region_area_px:
            continue
        region_mask = labels[y:y+h, x:x+w] == label
        region_delta = gray[y:y+h, x:x+w][region_mask]
        mean_delta = float(region_delta.mean()) if region_delta.size else 0.0
        max_delta = int(region_delta.max()) if region_delta.size else 0
        crop = aligned[y:y+h, x:x+w]
        ok, encoded = cv2.imencode(".png", crop, [cv2.IMWRITE_PNG_COMPRESSION, 9])
        if not ok:
            raise VisionError("evidence crop encoding failed")
        candidates.append({
            "bbox_xywh": [x, y, w, h],
            "area_px": area,
            "area_ratio": round(area / total_pixels, 10),
            "mean_delta": round(mean_delta, 6),
            "max_delta": max_delta,
            "evidence_crop_sha256": sha256_hex(encoded.tobytes()),
        })
    candidates.sort(key=lambda item: (-item["area_px"], item["bbox_xywh"]))
    if len(candidates) > config.max_regions:
        raise VisionError("too many defect regions; review image/threshold before proceeding")
    for index, item in enumerate(candidates, 1):
        item["region_id"] = f"R{index:03d}"
    return candidates, mask, threshold_value


def _source_object(value: Any, name: str) -> dict[str, str]:
    if not isinstance(value, dict) or set(value) != {"provider", "bucket", "key", "version_id"}:
        raise VisionError(f"{name} must contain exact S3 source identity")
    if value.get("provider") != "AWS_S3":
        raise VisionError(f"{name}.provider must be AWS_S3")
    limits = {"bucket": 255, "key": 1024, "version_id": 1024}
    normalized = {"provider": "AWS_S3"}
    for field, limit in limits.items():
        item = value.get(field)
        if not isinstance(item, str) or not item or "\x00" in item:
            raise VisionError(f"{name}.{field} must be non-empty text")
        try:
            raw = item.encode("utf-8", "strict")
        except UnicodeEncodeError as exc:
            raise VisionError(f"{name}.{field} must be valid UTF-8") from exc
        if len(raw) > limit:
            raise VisionError(f"{name}.{field} exceeds byte limit")
        normalized[field] = item
    return normalized


def _source_binding(value: Any) -> dict[str, dict[str, str]]:
    if not isinstance(value, dict) or set(value) != {"reference", "inspection"}:
        raise VisionError("source_binding must contain exact reference and inspection identities")
    return {
        "reference": _source_object(value.get("reference"), "source_binding.reference"),
        "inspection": _source_object(value.get("inspection"), "source_binding.inspection"),
    }


def inspect_pair(
    reference_bytes: bytes,
    inspection_bytes: bytes,
    *,
    config: InspectionConfig | None = None,
    allow_opencv4_dev: bool = False,
    source_binding: dict[str, Any] | None = None,
) -> dict[str, Any]:
    config = config or InspectionConfig()
    config.validate()
    version = require_opencv5(allow_v4_dev=allow_opencv4_dev)
    reference = _decode_image(reference_bytes)
    inspection = _decode_image(inspection_bytes)
    aligned, transform, registration_score = _align_ecc(reference, inspection, config)
    regions, mask, threshold_value = _segment_regions(reference, aligned, config)
    ok, mask_png = cv2.imencode(".png", mask, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    if not ok:
        raise VisionError("mask encoding failed")
    packet: dict[str, Any] = {
        "schema": "proofline.evidence.v1",
        "pipeline_generation": PIPELINE_GENERATION,
        "opencv_version": version,
        "reference_sha256": hashlib.sha256(reference_bytes).hexdigest(),
        "inspection_sha256": hashlib.sha256(inspection_bytes).hexdigest(),
        "dimensions_wh": [int(reference.shape[1]), int(reference.shape[0])],
        "registration": {
            "method": "ECC_AFFINE",
            "score": registration_score,
            "inspection_to_reference": transform,
        },
        "segmentation": {
            "method": "ABSDIFF_OTSU_MORPH_CC",
            "threshold": threshold_value,
            "mask_sha256": sha256_hex(mask_png.tobytes()),
        },
        "regions": regions,
        "summary": {
            "region_count": len(regions),
            "total_region_area_px": sum(int(r["area_px"]) for r in regions),
            "max_region_area_px": max((int(r["area_px"]) for r in regions), default=0),
        },
        "authority": {
            "quality_disposition": False,
            "production_mutation": False,
            "vendor_contact": False,
            "purchase_or_payment": False,
            "external_send": False,
        },
    }
    if source_binding is not None:
        packet["source_binding"] = _source_binding(source_binding)
    packet["receipt_sha256"] = digest_json(packet)
    return packet


def verify_evidence_packet(packet: dict[str, Any]) -> bool:
    if not isinstance(packet, dict) or packet.get("schema") != "proofline.evidence.v1":
        return False
    receipt = packet.get("receipt_sha256")
    if not isinstance(receipt, str) or len(receipt) != 64:
        return False
    body = dict(packet)
    body.pop("receipt_sha256", None)
    if digest_json(body) != receipt:
        return False
    if body.get("pipeline_generation") != PIPELINE_GENERATION:
        return False
    authority = body.get("authority")
    if not isinstance(authority, dict) or not authority or any(value is not False for value in authority.values()):
        return False
    if "source_binding" in body:
        try:
            if _source_binding(body["source_binding"]) != body["source_binding"]:
                return False
        except VisionError:
            return False
    regions = body.get("regions")
    if not isinstance(regions, list) or len(regions) > MAX_REGIONS:
        return False
    if body.get("summary", {}).get("region_count") != len(regions):
        return False
    seen: set[str] = set()
    for region in regions:
        if not isinstance(region, dict):
            return False
        region_id = region.get("region_id")
        if not isinstance(region_id, str) or region_id in seen:
            return False
        seen.add(region_id)
        bbox = region.get("bbox_xywh")
        if not isinstance(bbox, list) or len(bbox) != 4 or any(type(v) is not int or v < 0 for v in bbox):
            return False
    return True
