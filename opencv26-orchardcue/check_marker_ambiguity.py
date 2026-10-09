"""Focused offline regression for OrchardCue duplicate-scale fail-closed behavior.

No camera, network, AWS resources or third-party images involved.
"""
import cv2
from engine import analyze
from fixture import synthetic


def check() -> None:
    good, _ = analyze(synthetic(), raw_sha256="synthetic-single")
    assert good["candidate_count"] == 6, good
    assert good["reference_marker"]["id"] == 23, good
    assert good["decision"]["action"] == "READY_FOR_OPERATOR_REVIEW", good
    assert all("approx_diameter_mm" in item for item in good["red_candidates"]), good

    none, _ = analyze(synthetic(marker=False), raw_sha256="synthetic-missing")
    assert none["decision"]["reason_codes"] == ["SCALE_MARKER_MISSING"], none
    assert none["reference_marker"] is None, none
    assert all("approx_diameter_mm" not in item for item in none["red_candidates"]), none

    duplicate = synthetic()
    aruco = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    smaller = cv2.aruco.generateImageMarker(aruco, 23, 70)
    duplicate[30:130, 770:870] = (255, 255, 255)
    duplicate[45:115, 785:855] = cv2.cvtColor(smaller, cv2.COLOR_GRAY2BGR)
    duplicates, _ = analyze(duplicate, raw_sha256="synthetic-duplicate-unequal-scale")
    assert duplicates["candidate_count"] == 6, duplicates
    assert duplicates["reference_marker"] is None, duplicates
    assert duplicates["decision"]["action"] == "HUMAN_REVIEW_REQUIRED", duplicates
    assert "SCALE_MARKER_AMBIGUOUS" in duplicates["decision"]["reason_codes"], duplicates
    assert "SCALE_MARKER_MISSING" not in duplicates["decision"]["reason_codes"], duplicates
    assert all("approx_diameter_mm" not in item for item in duplicates["red_candidates"]), duplicates
    assert all(report["decision"]["human_confirmation_required"] for report in (good, none, duplicates))
    print("PASS OrchardCue focused marker integrity (single, absent, duplicate different scale): 3/3")


if __name__ == "__main__":
    check()
