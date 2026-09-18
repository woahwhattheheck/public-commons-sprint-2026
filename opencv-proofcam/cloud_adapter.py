"""Stateless handler-shaped adapter for running ProofCam in a managed cloud function."""
from __future__ import annotations

import base64
from typing import Any

import cv2
import numpy as np

from proofcam import ProofCamError, compile_trace

MAX_ENCODED_CHARS=8_000_000
MAX_DECODED_BYTES=6_000_000

def handler(event: Any, context: Any=None) -> dict[str, Any]:
    required={"image_base64","observed_ms","now_ms","requested_action_class"}
    if type(event) is not dict or set(event)!=required:
        return {"statusCode":400,"body":{"error":"INVALID_EVENT"}}
    raw64=event["image_base64"]
    if type(raw64) is not str or not raw64 or len(raw64)>MAX_ENCODED_CHARS:
        return {"statusCode":400,"body":{"error":"INVALID_IMAGE"}}
    try:
        raw=base64.b64decode(raw64,validate=True)
        if not raw or len(raw)>MAX_DECODED_BYTES:
            raise ProofCamError("decoded image size invalid")
        image=cv2.imdecode(np.frombuffer(raw,dtype=np.uint8),cv2.IMREAD_COLOR)
        if image is None:
            raise ProofCamError("decode failed")
        receipt=compile_trace(
            image,
            observed_ms=event["observed_ms"],
            now_ms=event["now_ms"],
            requested_action_class=event["requested_action_class"],
        )
    except (ValueError,TypeError,ProofCamError):
        return {"statusCode":400,"body":{"error":"INVALID_IMAGE_OR_INPUT"}}
    return {
        "statusCode":200,
        "body":receipt,
        "runtime_truth":{
            "handler_source_present":True,
            "cloud_deployment_evidenced":False,
        },
    }
