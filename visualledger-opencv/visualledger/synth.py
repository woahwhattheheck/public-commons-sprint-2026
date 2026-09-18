"""Synthetic finance-document fixtures for deterministic local evaluation."""
from __future__ import annotations

from typing import Any


def make_case(kind: str = "clear", *, cv2_module: Any | None = None) -> bytes:
    try:
        import numpy as np
        cv2 = cv2_module
        if cv2 is None:
            import cv2 as cv2_import
            cv2 = cv2_import
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("OpenCV and NumPy required") from exc
    if kind not in {"clear", "blur", "glare", "two_docs", "sparse"}:
        raise ValueError("unknown synthetic case")
    canvas = np.full((1200, 1600, 3), 70, dtype=np.uint8)

    def doc(x0: int, y0: int, x1: int, y1: int, sparse: bool = False) -> None:
        cv2.rectangle(canvas, (x0, y0), (x1, y1), (238, 238, 238), -1)
        cv2.rectangle(canvas, (x0, y0), (x1, y1), (15, 15, 15), 8)
        cv2.putText(canvas, "INVOICE", (x0 + 70, y0 + 110), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (5, 5, 5), 5, cv2.LINE_AA)
        count = 1 if sparse else 12
        for i in range(count):
            y = y0 + 180 + i * max(35, (y1 - y0 - 250) // max(1, count))
            cv2.line(canvas, (x0 + 70, y), (x1 - 280, y), (25, 25, 25), 5)
            cv2.rectangle(canvas, (x1 - 230, y - 12), (x1 - 80, y + 12), (45, 45, 45), -1)
        cv2.putText(canvas, "$1,234.56", (x1 - 420, y1 - 80), cv2.FONT_HERSHEY_SIMPLEX, 1.3, (5, 5, 5), 4, cv2.LINE_AA)

    if kind == "two_docs":
        doc(80, 140, 760, 1080)
        doc(840, 140, 1520, 1080)
    else:
        doc(280, 90, 1320, 1110, sparse=(kind == "sparse"))
    if kind == "blur":
        canvas = cv2.GaussianBlur(canvas, (41, 41), 0)
    elif kind == "glare":
        cv2.rectangle(canvas, (300, 100), (1300, 650), (255, 255, 255), -1)
    ok, encoded = cv2.imencode(".png", canvas, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    if not ok:
        raise RuntimeError("failed to encode synthetic fixture")
    return bytes(encoded.tobytes())


def benchmark_cases() -> list[dict[str, str]]:
    return [
        {"kind": "clear", "expected_action": "REQUEST_FIELD_EXTRACTION"},
        {"kind": "blur", "expected_action": "REQUEST_RECAPTURE"},
        {"kind": "glare", "expected_action": "REQUEST_RECAPTURE"},
        {"kind": "two_docs", "expected_action": "REQUEST_HUMAN_CROP"},
        {"kind": "sparse", "expected_action": "REQUEST_HUMAN_CROP"},
    ]
