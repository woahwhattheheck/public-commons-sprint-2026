#!/usr/bin/env python3
"""ProofCam: deterministic OpenCV 5 visual evidence -> advisory action gate.

The module measures synthetic or right-cleared BGR frames with OpenCV and
content-binds the result into a trace. Visual evidence changes the next
advisory tool plan, but no branch authorizes physical actuation.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

SCHEMA = "proofcam.trace/v1"
DETECTOR = "red-region-v1"
MAX_FRAME_PIXELS = 4_194_304
MAX_AGE_MS = 2_000
MIN_HAZARD_PPM = 7_500
CENTER_LOW = 400
CENTER_HIGH = 600
ALLOWED_REQUEST_CLASSES = frozenset({"ADVISORY", "OBSERVATION_ONLY"})
SHA_RE = re.compile(r"^[0-9a-f]{64}$")


class ProofCamError(ValueError):
    pass


@dataclass(frozen=True)
class Detection:
    scene_sha256: str
    width: int
    height: int
    observed_ms: int
    hazard_pixels: int
    hazard_ppm: int
    centroid_x_permille: int | None
    visual_class: str
    opencv_version: str


def canonical_bytes(obj: Any) -> bytes:
    text = json.dumps(
        obj,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )
    return (text + "\n").encode("utf-8", "strict")


def digest_obj(obj: Any) -> str:
    return hashlib.sha256(canonical_bytes(obj)).hexdigest()


def opencv_major() -> int:
    token = cv2.__version__.split(".", 1)[0]
    return int(token) if token.isdigit() else 0


def opencv5_runtime_evidenced() -> bool:
    return opencv_major() == 5


def synthetic_scene(
    *,
    width: int = 320,
    height: int = 192,
    hazard: str = "none",
) -> np.ndarray:
    """Create deterministic rights-clean input without external media."""
    if not (64 <= width <= 1920 and 64 <= height <= 1080):
        raise ProofCamError("synthetic dimensions out of bounds")
    if width * height > MAX_FRAME_PIXELS:
        raise ProofCamError("synthetic frame too large")
    if hazard not in {"none", "left", "center", "right"}:
        raise ProofCamError("unknown synthetic hazard")

    frame = np.full((height, width, 3), 32, dtype=np.uint8)
    cv2.line(frame, (0, height // 2), (width - 1, height // 2), (96, 96, 96), 2)
    cv2.circle(
        frame,
        (width // 2, height // 3),
        max(4, min(width, height) // 18),
        (180, 120, 20),
        -1,
    )

    if hazard != "none":
        centers = {"left": width // 5, "center": width // 2, "right": 4 * width // 5}
        cx = centers[hazard]
        half_w = max(8, width // 12)
        half_h = max(8, height // 8)
        cv2.rectangle(
            frame,
            (max(0, cx - half_w), max(0, height // 2 - half_h)),
            (min(width - 1, cx + half_w), min(height - 1, height // 2 + half_h)),
            (0, 0, 255),
            -1,
        )
    return frame


def _validate_frame(frame: np.ndarray) -> tuple[int, int]:
    if not isinstance(frame, np.ndarray):
        raise ProofCamError("frame must be ndarray")
    if frame.dtype != np.uint8 or frame.ndim != 3 or frame.shape[2] != 3:
        raise ProofCamError("frame must be uint8 HxWx3 BGR")
    height, width = int(frame.shape[0]), int(frame.shape[1])
    if height <= 0 or width <= 0 or height * width > MAX_FRAME_PIXELS:
        raise ProofCamError("frame dimensions invalid")
    return width, height


def detect(frame: np.ndarray, *, observed_ms: int) -> Detection:
    width, height = _validate_frame(frame)
    if type(observed_ms) is not int or observed_ms < 0:
        raise ProofCamError("observed_ms must be nonnegative integer")

    scene_sha = hashlib.sha256(
        width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
        + frame.tobytes(order="C")
    ).hexdigest()

    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    lower_a = cv2.inRange(
        hsv,
        np.array([0, 160, 120], np.uint8),
        np.array([10, 255, 255], np.uint8),
    )
    lower_b = cv2.inRange(
        hsv,
        np.array([170, 160, 120], np.uint8),
        np.array([179, 255, 255], np.uint8),
    )
    mask = cv2.bitwise_or(lower_a, lower_b)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    hazard_pixels = int(cv2.countNonZero(mask))
    hazard_ppm = (hazard_pixels * 1_000_000) // (width * height)
    centroid_x: int | None = None

    if contours and hazard_ppm >= MIN_HAZARD_PPM:
        moments = cv2.moments(max(contours, key=cv2.contourArea))
        if moments["m00"] > 0:
            x = moments["m10"] / moments["m00"]
            centroid_x = max(0, min(1000, int(round(x * 1000 / width))))

    if hazard_ppm < MIN_HAZARD_PPM or centroid_x is None:
        visual_class = "CLEAR"
        centroid_x = None
    elif centroid_x < CENTER_LOW:
        visual_class = "HAZARD_LEFT"
    elif centroid_x > CENTER_HIGH:
        visual_class = "HAZARD_RIGHT"
    else:
        visual_class = "HAZARD_CENTER"

    return Detection(
        scene_sha256=scene_sha,
        width=width,
        height=height,
        observed_ms=observed_ms,
        hazard_pixels=hazard_pixels,
        hazard_ppm=hazard_ppm,
        centroid_x_permille=centroid_x,
        visual_class=visual_class,
        opencv_version=cv2.__version__,
    )


def evidence(det: Detection) -> dict[str, Any]:
    obj: dict[str, Any] = {
        "detector": DETECTOR,
        "scene_sha256": det.scene_sha256,
        "width": det.width,
        "height": det.height,
        "observed_ms": det.observed_ms,
        "hazard_pixels": det.hazard_pixels,
        "hazard_ppm": det.hazard_ppm,
        "centroid_x_permille": det.centroid_x_permille,
        "visual_class": det.visual_class,
        "opencv_version": det.opencv_version,
    }
    obj["evidence_sha256"] = digest_obj(obj)
    return obj


EVIDENCE_KEYS = frozenset(
    {
        "detector",
        "scene_sha256",
        "width",
        "height",
        "observed_ms",
        "hazard_pixels",
        "hazard_ppm",
        "centroid_x_permille",
        "visual_class",
        "opencv_version",
        "evidence_sha256",
    }
)


def validate_evidence(ev: Any, *, now_ms: int) -> dict[str, Any]:
    if type(now_ms) is not int or now_ms < 0:
        raise ProofCamError("now_ms must be nonnegative integer")
    if type(ev) is not dict or frozenset(ev) != EVIDENCE_KEYS:
        raise ProofCamError("evidence exact keys required")
    if ev["detector"] != DETECTOR:
        raise ProofCamError("wrong detector generation")
    if type(ev["scene_sha256"]) is not str or not SHA_RE.fullmatch(ev["scene_sha256"]):
        raise ProofCamError("scene digest invalid")
    if type(ev["opencv_version"]) is not str or not ev["opencv_version"]:
        raise ProofCamError("OpenCV version missing")

    for key in ("width", "height", "observed_ms", "hazard_pixels", "hazard_ppm"):
        if type(ev[key]) is not int or ev[key] < 0:
            raise ProofCamError(f"{key} invalid")

    if (
        ev["width"] <= 0
        or ev["height"] <= 0
        or ev["width"] * ev["height"] > MAX_FRAME_PIXELS
    ):
        raise ProofCamError("evidence dimensions invalid")
    if ev["hazard_pixels"] > ev["width"] * ev["height"] or ev["hazard_ppm"] > 1_000_000:
        raise ProofCamError("hazard measurement impossible")

    if ev["visual_class"] not in {
        "CLEAR",
        "HAZARD_LEFT",
        "HAZARD_CENTER",
        "HAZARD_RIGHT",
    }:
        raise ProofCamError("visual class invalid")

    cx = ev["centroid_x_permille"]
    if ev["visual_class"] == "CLEAR":
        if cx is not None:
            raise ProofCamError("clear evidence cannot have hazard centroid")
    elif type(cx) is not int or not 0 <= cx <= 1000:
        raise ProofCamError("hazard centroid invalid")

    if now_ms < ev["observed_ms"]:
        raise ProofCamError("future evidence")
    if now_ms - ev["observed_ms"] > MAX_AGE_MS:
        raise ProofCamError("stale evidence")

    claimed = ev["evidence_sha256"]
    if type(claimed) is not str or not SHA_RE.fullmatch(claimed):
        raise ProofCamError("evidence digest invalid")
    unsigned = {k: ev[k] for k in ev if k != "evidence_sha256"}
    if digest_obj(unsigned) != claimed:
        raise ProofCamError("evidence digest mismatch")
    return dict(ev)


def decide(
    ev: Any,
    *,
    now_ms: int,
    requested_action_class: str = "ADVISORY",
) -> dict[str, Any]:
    if requested_action_class not in ALLOWED_REQUEST_CLASSES:
        return {
            "decision": "HUMAN_APPROVAL_REQUIRED",
            "tool_plan": "NO_ACTION",
            "reason": "UNSAFE_OR_UNKNOWN_ACTION_CLASS",
            "requested_action_class": str(requested_action_class),
            "evidence_sha256": ev.get("evidence_sha256") if type(ev) is dict else None,
            "physical_actuation_authorized": False,
        }

    try:
        good = validate_evidence(ev, now_ms=now_ms)
    except (ProofCamError, TypeError, ValueError, OverflowError):
        return {
            "decision": "HOLD_EVIDENCE",
            "tool_plan": "NO_ACTION",
            "reason": "EVIDENCE_INVALID_OR_STALE",
            "requested_action_class": requested_action_class,
            "evidence_sha256": ev.get("evidence_sha256") if type(ev) is dict else None,
            "physical_actuation_authorized": False,
        }

    mapping = {
        "CLEAR": ("CONTINUE_OBSERVATION", "CAPTURE_NEXT_FRAME", "CLEAR_FRAME"),
        "HAZARD_LEFT": (
            "PLAN_FOCUSED_INSPECTION",
            "INSPECT_LEFT_ZONE",
            "VISUAL_HAZARD_LEFT",
        ),
        "HAZARD_RIGHT": (
            "PLAN_FOCUSED_INSPECTION",
            "INSPECT_RIGHT_ZONE",
            "VISUAL_HAZARD_RIGHT",
        ),
        "HAZARD_CENTER": (
            "HUMAN_APPROVAL_REQUIRED",
            "NO_ACTION",
            "VISUAL_HAZARD_CENTER",
        ),
    }
    decision, tool_plan, reason = mapping[good["visual_class"]]
    return {
        "decision": decision,
        "tool_plan": tool_plan,
        "reason": reason,
        "requested_action_class": requested_action_class,
        "evidence_sha256": good["evidence_sha256"],
        "physical_actuation_authorized": False,
    }


def compile_trace(
    frame: np.ndarray,
    *,
    observed_ms: int,
    now_ms: int,
    requested_action_class: str = "ADVISORY",
) -> dict[str, Any]:
    det = detect(frame, observed_ms=observed_ms)
    ev = evidence(det)
    outcome = decide(
        ev,
        now_ms=now_ms,
        requested_action_class=requested_action_class,
    )
    packet: dict[str, Any] = {
        "schema": SCHEMA,
        "perception": ev,
        "decision": outcome,
        "authority": {
            "physical_actuation_authorized": False,
            "camera_capture_authorized": False,
            "aws_deployment_authorized": False,
            "external_submission_authorized": False,
            "payment_or_revenue_claim_authorized": False,
        },
        "runtime_truth": {
            "opencv5_execution_evidenced": opencv5_runtime_evidenced(),
            "aws_deployment_evidenced": False,
            "synthetic_fixture": True,
        },
    }
    packet["trace_sha256"] = digest_obj(packet)
    return packet


def verify_trace(packet: Any) -> bool:
    if type(packet) is not dict:
        return False
    if frozenset(packet) != frozenset(
        {"schema", "perception", "decision", "authority", "runtime_truth", "trace_sha256"}
    ):
        return False
    claimed = packet.get("trace_sha256")
    if type(claimed) is not str or not SHA_RE.fullmatch(claimed):
        return False
    unsigned = {k: packet[k] for k in packet if k != "trace_sha256"}
    try:
        if digest_obj(unsigned) != claimed:
            return False
    except (TypeError, ValueError, OverflowError):
        return False

    auth = packet.get("authority")
    if type(auth) is not dict or any(value is not False for value in auth.values()):
        return False
    decision = packet.get("decision")
    if type(decision) is not dict or decision.get("physical_actuation_authorized") is not False:
        return False
    return True
