from __future__ import annotations

from typing import Iterable

import cv2
import numpy as np


class SyntheticError(ValueError):
    pass


def make_reference(width: int = 640, height: int = 420) -> np.ndarray:
    if width < 128 or height < 128:
        raise SyntheticError("synthetic canvas too small")
    image = np.full((height, width, 3), 238, dtype=np.uint8)
    cv2.rectangle(image, (35, 35), (width - 35, height - 35), (30, 30, 30), 3)
    for x in range(90, width - 60, 110):
        cv2.circle(image, (x, 85), 14, (35, 35, 35), -1)
        cv2.line(image, (x - 18, height - 90), (x + 18, height - 60), (60, 60, 60), 4)
    cv2.putText(image, "PROOFLINE QA 01", (70, height // 2), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (20, 20, 20), 2, cv2.LINE_AA)
    cv2.rectangle(image, (width // 2 - 80, height // 2 + 45), (width // 2 + 80, height // 2 + 115), (90, 90, 90), 2)
    return image


def make_inspection(reference: np.ndarray, *, shift_xy: tuple[int, int] = (3, -2), defects: Iterable[tuple[int, int, int, int]] = ()) -> np.ndarray:
    dx, dy = shift_xy
    matrix = np.array([[1.0, 0.0, float(dx)], [0.0, 1.0, float(dy)]], dtype=np.float32)
    moved = cv2.warpAffine(reference, matrix, (reference.shape[1], reference.shape[0]), borderMode=cv2.BORDER_REFLECT101)
    output = moved.copy()
    for x, y, w, h in defects:
        if w <= 0 or h <= 0:
            raise SyntheticError("defect dimensions must be positive")
        cv2.rectangle(output, (x, y), (x + w - 1, y + h - 1), (0, 0, 245), -1)
    return output


def encode_png(image: np.ndarray) -> bytes:
    ok, encoded = cv2.imencode(".png", image, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    if not ok:
        raise SyntheticError("PNG encoding failed")
    return encoded.tobytes()
