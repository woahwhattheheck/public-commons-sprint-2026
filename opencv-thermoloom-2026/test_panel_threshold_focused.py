# SPDX-License-Identifier: MIT
"""Synthetic-only focused regression for opt-in panel-local hotspot selection.

These examples are engineered inputs, not field imagery or accuracy estimates.
"""
from __future__ import annotations

import hashlib
import cv2
import numpy as np

from thermoloom import ImageRejected, decode_image, inspect


def make_pair(seed: int, gradient: int) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    noise = rng.integers(-3, 4, (480, 720), dtype=np.int16)
    clean = np.clip(74 + noise + gradient * np.arange(720)[None, :] / 720, 0, 255).astype(np.uint8)
    for y in range(0, 480, 120):
        clean[y:y + 2, :] = 66
    for x in range(0, 720, 120):
        clean[:, x:x + 2] = 66
    hot = clean.copy()
    cv2.ellipse(hot, (430, 180), (12, 9), 0, 0, 360, 185, -1)
    return clean, hot


def run() -> None:
    peer_hits = local_hits = 0
    clean_false = 0
    pairs = 0
    for seed in (0, 4, 8):
        for gradient in (0, 48, 64, 100):
            clean, hot = make_pair(seed, gradient)
            for image, injected in ((clean, False), (hot, True)):
                incumbent = inspect(image)
                peer = inspect(image, threshold_mode="peer")
                panel = inspect(image, threshold_mode="panel")
                assert incumbent == peer, "explicit peer mode must be identical to incumbent default"
                assert incumbent["capture_sha256"] == hashlib.sha256(
                    image.tobytes() + b"|4|6|v1").hexdigest(), "original peer fingerprint changed"
                assert panel["capture_sha256"] != incumbent["capture_sha256"], "modes must not alias receipt IDs"
                assert all(e["reason"].startswith("connected region") for e in panel["evidence"])
                if not injected:
                    clean_false += int(peer["decision"] != "MONITOR") + int(panel["decision"] != "MONITOR")
                else:
                    peer_hits += int(any((e["row"], e["col"]) == (1, 3) for e in peer["evidence"]))
                    local_hits += int(any((e["row"], e["col"]) == (1, 3) for e in panel["evidence"]))
                    assert panel["threshold_mode"] == "panel"
                    assert panel["threshold"]["applied_mode"] == "panel_local_median_mad"
                    assert "cutoff_pixel" in panel["panel_medians"][9]
            pairs += 1
    assert clean_false == 0, f"false positive on clean synthetic input: {clean_false}"
    assert local_hits == pairs, f"local threshold failed on synthetic spots: {local_hits}/{pairs}"
    assert peer_hits < local_hits, "stress inputs do not discriminate new and old modes"
    flat = np.full((480, 720), 80, dtype=np.uint8)
    assert inspect(flat)["decision"] == inspect(flat, threshold_mode="panel")["decision"] == "RETAKE"
    for invalid in (None, 1, "other"):
        try:
            inspect(flat, threshold_mode=invalid)
        except ImageRejected:
            pass
        else:
            raise AssertionError(f"invalid threshold_mode accepted: {invalid!r}")
    success, png = cv2.imencode(".png", make_pair(0, 48)[1])
    assert success and np.array_equal(decode_image(png.tobytes()), make_pair(0, 48)[1])
    print(f"PASS synthetic-only focused A/B: {pairs} clean + {pairs} spot; "
          f"peer localized {peer_hits}/{pairs}, panel localized {local_hits}/{pairs}, "
          f"clean false-alerts {clean_false}/{pairs * 2}; default/digest/RETAKE/decode/invalid-mode fences PASS; "
          f"local OpenCV {cv2.__version__}")


if __name__ == "__main__":
    run()
