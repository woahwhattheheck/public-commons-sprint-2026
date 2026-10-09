"""Human-selected, original-pixel crops with replayable parent/child custody."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import hmac
import io
import json
from pathlib import Path
from typing import Any
import zipfile

from .agent import canonical, compile_trace, verify_trace
from .vision import MAX_IMAGE_BYTES, VisionError, VisionPolicy, _cv

SCHEMA = "visualledger-human-crop/v1"
MAX_BUNDLE_BYTES = 2 * MAX_IMAGE_BYTES + 2 * 1024 * 1024
MEMBERS = {"source.img", "source.trace.json", "crop.png", "crop.trace.json",
           "crop.receipt.json", "prior_fingerprints.json", "manifest.json"}


def _digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def strict_json(raw: bytes) -> Any:
    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for key, value in items:
            if key in out:
                raise VisionError("duplicate JSON key")
            out[key] = value
        return out

    def invalid_constant(value: str) -> None:
        raise VisionError("nonfinite JSON number")

    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs,
                          parse_constant=invalid_constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise VisionError("invalid UTF-8 JSON") from exc


@dataclass(frozen=True)
class CropResult:
    png: bytes
    trace: dict[str, Any]
    receipt: dict[str, Any]


def crop_evidence(raw: bytes, parent: dict[str, Any], rectangle: dict[str, int], *,
                  human_confirmed: bool, note: str,
                  prior_fingerprints: list[dict[str, str]] | tuple[dict[str, str], ...] = (),
                  allow_opencv4_dev: bool = False) -> CropResult:
    """Replay the source, crop exclusive pixel edges, then run the same policy.

    This is not an approval of the invoice, the crop's completeness, or the
    claimed identity of the human. No caller-supplied route can bypass vision.
    """
    if human_confirmed is not True:
        raise VisionError("an explicit human crop confirmation is required")
    if type(note) is not str or not note.strip() or len(note) > 500:
        raise VisionError("a crop reason of 1 to 500 characters is required")
    note = note.strip()
    if type(rectangle) is not dict or set(rectangle) != {"left", "top", "right", "bottom"}:
        raise VisionError("rectangle requires left, top, right and bottom")
    if any(type(value) is not int for value in rectangle.values()):
        raise VisionError("crop edges must be plain integer source-pixel coordinates")
    verified = verify_trace(parent, raw, prior_fingerprints=prior_fingerprints,
                            allow_opencv4_dev=allow_opencv4_dev)
    if verified["decision"]["action"] != "REQUEST_HUMAN_CROP":
        raise VisionError("this source is not awaiting a human crop; retain its current route")
    perception = verified["perception"]
    policy = VisionPolicy(**perception["policy"])
    left, top, right, bottom = (rectangle[key] for key in ("left", "top", "right", "bottom"))
    if not (0 <= left < right <= perception["width"] and
            0 <= top < bottom <= perception["height"]):
        raise VisionError("crop edges must be ordered and inside the original image")
    if right - left < policy.min_width or bottom - top < policy.min_height:
        raise VisionError("crop dimensions are below the unchanged vision policy minimum")
    cv2, np, _, _ = _cv(None, allow_opencv4_dev=allow_opencv4_dev)
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None or image.shape[:2] != (perception["height"], perception["width"]):
        raise VisionError("source image changed during crop replay")
    ok, encoded = cv2.imencode(".png", image[top:bottom, left:right],
                               [cv2.IMWRITE_PNG_COMPRESSION, 9])
    if not ok:
        raise VisionError("could not encode crop")
    png = encoded.tobytes()
    if len(png) > MAX_IMAGE_BYTES:
        raise VisionError("encoded crop exceeds image byte bound")
    identity = _digest(canonical({"parent": parent["receipt_sha256"], "rectangle": rectangle}))
    trace = compile_trace(png, evidence_id="crop-" + identity[:32],
                          prior_fingerprints=prior_fingerprints, policy=policy,
                          allow_opencv4_dev=allow_opencv4_dev)
    receipt = {
        "schema": SCHEMA,
        "source_sha256": _digest(raw),
        "source_trace_receipt_sha256": parent["receipt_sha256"],
        "crop_sha256": _digest(png),
        "crop_trace_receipt_sha256": trace["receipt_sha256"],
        "prior_fingerprints_sha256": _digest(canonical(prior_fingerprints)),
        "rectangle": dict(rectangle),
        "coordinate_space": "OpenCV decoded source pixels; right/bottom exclusive",
        "transformation": "rectangle-only; no resizing, enhancement or padding",
        "human_confirmed": True,
        "human_reason": note,
        "source_action": parent["decision"]["action"],
        "crop_action": trace["decision"]["action"],
        "human_review_required": True,
        "complete_document_or_identity_authenticated": False,
    }
    receipt["receipt_sha256"] = _digest(canonical(receipt))
    return CropResult(png, trace, receipt)


def verify_crop(raw: bytes, parent: dict[str, Any], result: CropResult, *,
                prior_fingerprints: list[dict[str, str]] | tuple[dict[str, str], ...] = (),
                allow_opencv4_dev: bool = False) -> CropResult:
    receipt = result.receipt
    if type(receipt) is not dict or receipt.get("schema") != SCHEMA:
        raise VisionError("invalid crop receipt schema")
    expected = crop_evidence(raw, parent, receipt.get("rectangle"),
                             human_confirmed=receipt.get("human_confirmed"),
                             note=receipt.get("human_reason"),
                             prior_fingerprints=prior_fingerprints,
                             allow_opencv4_dev=allow_opencv4_dev)
    if (not hmac.compare_digest(expected.png, result.png) or
            not hmac.compare_digest(canonical(expected.trace), canonical(result.trace)) or
            not hmac.compare_digest(canonical(expected.receipt), canonical(receipt))):
        raise VisionError("crop pixels, trace or provenance do not replay")
    return expected


def export_bundle(raw: bytes, parent: dict[str, Any], result: CropResult, *,
                  prior_fingerprints: list[dict[str, str]] | tuple[dict[str, str], ...] = (),
                  allow_opencv4_dev: bool = False) -> bytes:
    """Export actual source pixels and both canonical traces, never a display-only crop."""
    verify_crop(raw, parent, result, prior_fingerprints=prior_fingerprints,
                allow_opencv4_dev=allow_opencv4_dev)
    manifest = {"schema": "visualledger-review-manifest/v1", "documents": [
        {"image": "source.img", "trace": "source.trace.json", "prior_fingerprints": list(prior_fingerprints)},
        {"image": "crop.png", "trace": "crop.trace.json", "prior_fingerprints": list(prior_fingerprints)},
    ]}
    members = {"source.img": raw, "source.trace.json": canonical(parent),
               "crop.png": result.png, "crop.trace.json": canonical(result.trace),
               "crop.receipt.json": canonical(result.receipt),
               "prior_fingerprints.json": canonical(prior_fingerprints),
               "manifest.json": canonical(manifest)}
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, content in members.items():
            limit = MAX_IMAGE_BYTES if name in {"source.img", "crop.png"} else 1024 * 1024
            if len(content) > limit:
                raise VisionError("crop bundle member exceeds replay bound")
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o100600 << 16
            archive.writestr(info, content)
    bundle = output.getvalue()
    if len(bundle) > MAX_BUNDLE_BYTES:
        raise VisionError("crop evidence bundle exceeds bound")
    return bundle


def verify_bundle(bundle: bytes, *, allow_opencv4_dev: bool = False) -> CropResult:
    """Read only the fixed member set without extracting paths to disk."""
    if type(bundle) is not bytes or not bundle or len(bundle) > MAX_BUNDLE_BYTES:
        raise VisionError("bundle must be bounded nonempty bytes")
    try:
        with zipfile.ZipFile(io.BytesIO(bundle)) as archive:
            infos = archive.infolist()
            if len(infos) != len(MEMBERS) or {item.filename for item in infos} != MEMBERS:
                raise VisionError("unexpected or duplicate bundle member")
            for item in infos:
                limit = MAX_IMAGE_BYTES if item.filename in {"source.img", "crop.png"} else 1024 * 1024
                if item.file_size > limit or item.flag_bits & 1 or item.is_dir():
                    raise VisionError("oversize, encrypted or invalid bundle member")
            data = {item.filename: archive.read(item) for item in infos}
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError) as exc:
        raise VisionError("invalid crop bundle") from exc
    parent = strict_json(data["source.trace.json"])
    priors = strict_json(data["prior_fingerprints.json"])
    result = CropResult(data["crop.png"], strict_json(data["crop.trace.json"]),
                        strict_json(data["crop.receipt.json"]))
    expected = verify_crop(data["source.img"], parent, result,
                           prior_fingerprints=priors, allow_opencv4_dev=allow_opencv4_dev)
    expected_manifest = {"schema": "visualledger-review-manifest/v1", "documents": [
        {"image": "source.img", "trace": "source.trace.json", "prior_fingerprints": priors},
        {"image": "crop.png", "trace": "crop.trace.json", "prior_fingerprints": priors},
    ]}
    if canonical(strict_json(data["manifest.json"])) != canonical(expected_manifest):
        raise VisionError("review manifest differs from replayed inputs")
    return expected


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--allow-opencv4-dev", action="store_true")
    args = parser.parse_args()
    try:
        with args.bundle.open("rb") as stream:
            result = verify_bundle(stream.read(MAX_BUNDLE_BYTES + 1),
                                   allow_opencv4_dev=args.allow_opencv4_dev)
        print(json.dumps({"status": "REPLAY_MATCHED", "crop_action": result.receipt["crop_action"],
                          "receipt_sha256": result.receipt["receipt_sha256"],
                          "human_review_required": True}))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"Crop replay failed: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
