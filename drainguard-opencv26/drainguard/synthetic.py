"""Seeded entirely synthetic imagery. No real street or resident media."""
from __future__ import annotations
import cv2
import numpy as np
from .vision import Slot


def make_scene(seed: int = 20261009) -> tuple[np.ndarray, np.ndarray, list[Slot]]:
    rng = np.random.default_rng(seed)
    H, W = 400, 680
    base = np.empty((H, W, 3), dtype=np.uint8)
    gray = np.clip(rng.normal(119, 13, (H, W)), 60, 175).astype(np.uint8)
    for c in range(3):
        base[:, :, c] = np.clip(gray + rng.integers(-7, 8, (H, W)), 0, 255).astype(np.uint8)
    # Feature-rich invented concrete surface and bolts anchor registration.
    for _ in range(105):
        x = int(rng.integers(25, W-25)); y = int(rng.integers(25, H-25))
        cv2.circle(base, (x, y), int(rng.integers(1, 4)), (90, 95, 98), -1)
    cv2.rectangle(base, (145, 120), (550, 320), (53, 65, 73), -1)
    cv2.rectangle(base, (151, 126), (544, 314), (149, 153, 162), 5)
    slots = [Slot(f"S{i+1}", 180 + i*89, 153, 58, 132) for i in range(4)]
    for slot in slots:
        x, y, w, h = slot.rect()
        cv2.rectangle(base, (x-5,y-6), (x+w+5,y+h+6), (173, 181, 187), -1)
        cv2.rectangle(base, (x,y), (x+w,y+h), (24, 27, 30), -1)
        for j in range(3):
            xx = x + 4 + j*22
            cv2.line(base, (xx,y+8), (xx,y+h-9), (34, 35, 40), 2)
        for yy in [y-4,y+h+4]:
            cv2.circle(base, (x-3,yy), 2, (35,35,35), -1)
            cv2.circle(base, (x+w+3,yy), 2, (35,35,35), -1)
    current = base.copy()
    for j in (1, 2):
        slot = slots[j]
        x, y, w, h = slot.rect()
        # Brown/yellow invented leaves and debris, 62% of the aperture.
        for row in range(y+24, y+h-10):
            for col in range(x+8, x+w-7):
                if ((row//12 + col//9) % 8) < 7:
                    current[row, col] = [int(rng.integers(65,92)), int(rng.integers(98,137)), int(rng.integers(140,183))]
    # Different viewpoint: small motion requiring reference registration.
    transform = cv2.getRotationMatrix2D((W/2, H/2), 1.15, 1.0)
    transform[:, 2] += np.array([5.0, -3.0])
    current = cv2.warpAffine(current, transform, (W,H), borderMode=cv2.BORDER_REFLECT)
    return base, current, slots
