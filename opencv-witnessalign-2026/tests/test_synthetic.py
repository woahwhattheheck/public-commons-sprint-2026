"""One focused local synthetic regression. Not a real-world accuracy benchmark."""
from __future__ import annotations

import base64
import json
import unittest

import cv2

from demo.make_fixtures import generate, MISSING_COMPONENT
from witnessalign.engine import analyze
from witnessalign.aws_lambda import handler


def png(image):
    ok, packet = cv2.imencode(".png", image)
    assert ok
    return packet.tobytes()


class SyntheticPairTests(unittest.TestCase):
    def test_realigned_photo_can_flag_a_missing_component(self):
        reference, clean, missing = generate()
        ref_bytes = png(reference)
        clean_report, clean_preview = analyze(ref_bytes, png(clean))
        fault_report, fault_preview = analyze(ref_bytes, png(missing))
        self.assertEqual(clean_report["alignment"]["status"], "resolved")
        self.assertEqual(fault_report["alignment"]["status"], "resolved")
        self.assertEqual(clean_report["decision"], "no_regions_above_threshold")
        self.assertEqual(clean_report["candidate_regions"], [])
        self.assertIsNotNone(clean_preview)
        self.assertIsNotNone(fault_preview)
        self.assertFalse(clean_report["authority"]["automatic_quality_acceptance"])
        self.assertFalse(fault_report["authority"]["automatic_rejection"])
        self.assertEqual(fault_report["decision"], "review_required")
        cx, cy = MISSING_COMPONENT
        nearby = []
        for row in fault_report["candidate_regions"]:
            x,y,w,h = row["box_xywh"]
            if x-30 <= cx <= x+w+30 and y-30 <= cy <= y+h+30:
                nearby.append(row)
        self.assertTrue(nearby, msg=str(fault_report["candidate_regions"]))

    def test_aws_lambda_http_adapter_is_bounded_and_keeps_human_authority(self):
        reference, _, missing = generate()
        body = json.dumps({"reference_b64": base64.b64encode(png(reference)).decode(),
                           "candidate_b64": base64.b64encode(png(missing)).decode()})
        request = {"requestContext": {"http": {"method": "POST"}},
                   "body": body, "isBase64Encoded": False}
        response = handler(request, None)
        self.assertEqual(response["statusCode"], 200)
        result = json.loads(response["body"])
        self.assertEqual(result["decision"], "review_required")
        self.assertFalse(result["authority"]["automatic_quality_acceptance"])
        self.assertGreaterEqual(len(result["candidate_regions"]), 1)
        forbidden = handler({**request, "requestContext": {"http": {"method": "GET"}}}, None)
        self.assertEqual(forbidden["statusCode"], 405)
        oversized = handler({**request, "body": "x" * 9_000_001}, None)
        self.assertEqual(oversized["statusCode"], 413)

    def test_unregistrable_photos_fail_closed(self):
        reference, _, _ = generate()
        # Featureless candidate is incompatible with golden reference: never inspect.
        blank = reference.copy()
        blank[:] = (140,140,140)
        report, preview = analyze(png(reference), png(blank))
        self.assertEqual(report["decision"], "recapture_required")
        self.assertIsNone(preview)


if __name__ == "__main__":
    unittest.main()
