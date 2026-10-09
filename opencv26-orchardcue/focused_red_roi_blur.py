#!/usr/bin/env python3
"""Single scoped synthetic check: sharp background must not disguise soft fruit.

This is not field data, a statistical validation or a competition score.
"""
import hashlib
import cv2
import numpy as np
from fixture import synthetic
from engine import analyze

CIRCLES = [(240, 150, 34), (390, 175, 30), (555, 150, 35),
           (260, 340, 38), (455, 355, 32), (670, 320, 36)]


def sharp_background_local_softness(*, soft: bool) -> np.ndarray:
    frame = synthetic()
    # Crisp high-frequency leaves on the right, away from the fruit and marker.
    for y in range(160, 585, 5):
        for x in range(790, 940, 7):
            cv2.line(frame, (x, y), (x + 3, y + 2), (29, 190, 30), 1)
    if soft:
        for x, y, radius in CIRCLES:
            m = radius + 13
            roi = frame[y-m:y+m+1, x-m:x+m+1].copy()
            frame[y-m:y+m+1, x-m:x+m+1] = cv2.GaussianBlur(roi, (31, 31), 8.8)
    return frame


def check():
    receipts = []
    for soft in (False, True):
        frame = sharp_background_local_softness(soft=soft)
        raw = cv2.imencode(".png", frame)[1].tobytes()
        report, _ = analyze(frame, raw_sha256=hashlib.sha256(raw).hexdigest())
        action = report["decision"]["action"]
        roi = report["quality"]["red_candidate_median_laplacian_variance"]
        global_focus = report["quality"]["saturation_laplacian_variance"]
        expected = "RETAKE_REQUIRED" if soft else "READY_FOR_OPERATOR_REVIEW"
        assert report["candidate_count"] == 6, report
        assert report["reference_marker"]["id"] == 23, report
        assert action == expected, (soft, expected, report["decision"])
        assert global_focus >= 22, global_focus
        if soft:
            assert "FRUIT_ROI_BLUR_RETAKE" in report["decision"]["reason_codes"]
            assert roi < 60, roi
        else:
            assert roi >= 60, roi
        receipts.append({"locally_blurred":soft,"global_sharpness":global_focus,
                         "roi_sharpness":roi,"count":report["candidate_count"],
                         "action":action})
    return receipts


if __name__ == "__main__":
    import json
    print(json.dumps(check(), indent=2))
