"""Focused, synthetic-only duplicate-ArUco scale abstention regression.

Run from opencv26-orchardcue/: python test_duplicate_marker.py
This is not field evidence or an OpenCV 5 conformance result.
"""
import cv2

from engine import analyze
from fixture import synthetic


def with_second_marker(image, marker_id):
    image = image.copy()
    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    tag = cv2.aruco.generateImageMarker(dictionary, marker_id, 80)
    image[35:135, 790:890] = (255, 255, 255)
    image[45:125, 800:880] = cv2.cvtColor(tag, cv2.COLOR_GRAY2BGR)
    return image


def result(image, case):
    report, _ = analyze(image, raw_sha256="synthetic-" + case)
    assert report["candidate_count"] == 6, (case, report)
    assert report["decision"]["human_confirmation_required"] is True, case
    return report


def run():
    baseline = result(synthetic(), "single")
    assert baseline["decision"]["action"] == "READY_FOR_OPERATOR_REVIEW"
    assert baseline["reference_marker"] is not None
    assert all("approx_diameter_mm" in c for c in baseline["red_candidates"])

    foreign = result(with_second_marker(synthetic(), 7), "foreign-id")
    assert foreign["decision"]["action"] == "READY_FOR_OPERATOR_REVIEW"
    assert foreign["reference_marker"] is not None
    assert all("approx_diameter_mm" in c for c in foreign["red_candidates"])

    double = with_second_marker(synthetic(), 23)
    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    _, ids, _ = cv2.aruco.ArucoDetector(dictionary, cv2.aruco.DetectorParameters()).detectMarkers(double)
    assert ids is not None and sum(int(x) == 23 for x in ids.flatten()) == 2, ids
    collision = result(double, "two-qualifying-id23")
    assert collision["reference_marker"] is None, collision
    assert collision["decision"]["action"] == "HUMAN_REVIEW_REQUIRED", collision
    assert "SCALE_MARKER_AMBIGUOUS" in collision["decision"]["reason_codes"], collision
    assert "SCALE_MARKER_MISSING" not in collision["decision"]["reason_codes"], collision
    assert all("approx_diameter_mm" not in c for c in collision["red_candidates"]), collision

    absent = result(synthetic(marker=False), "missing")
    assert absent["decision"]["action"] == "HUMAN_REVIEW_REQUIRED", absent
    assert "SCALE_MARKER_MISSING" in absent["decision"]["reason_codes"]
    assert all("approx_diameter_mm" not in c for c in absent["red_candidates"])
    print("PASS: single marker, unrelated id, duplicate-id abstention, no marker; six red candidates in every case")


if __name__ == "__main__":
    run()
