import copy
import unittest

from proofline.agent import build_review_proposal, verify_review_proposal
from proofline.synthetic import encode_png, make_inspection, make_reference
from proofline.vision import InspectionConfig, VisionError, inspect_pair, require_opencv5, verify_evidence_packet


class VisionTests(unittest.TestCase):
    def test_opencv5_guard_is_explicit(self):
        with self.assertRaises(VisionError): require_opencv5(version="4.13.0")
        self.assertEqual(require_opencv5(version="5.1.2"), "5.1.2")
        self.assertEqual(require_opencv5(version="4.13.0", allow_v4_dev=True), "4.13.0")

    def test_synthetic_defect_roundtrip(self):
        reference = make_reference()
        inspection = make_inspection(reference, shift_xy=(3, -2), defects=[(360, 245, 48, 34)])
        packet = inspect_pair(encode_png(reference), encode_png(inspection), config=InspectionConfig(min_region_area_px=40, min_delta=32, max_regions=16), allow_opencv4_dev=True)
        self.assertTrue(verify_evidence_packet(packet))
        self.assertGreaterEqual(packet["summary"]["region_count"], 1)
        target = max(packet["regions"], key=lambda r: r["area_px"])
        self.assertGreater(target["area_px"], 300)
        proposal = build_review_proposal(packet)
        self.assertTrue(verify_review_proposal(proposal, packet))
        self.assertEqual(proposal["state"], "REVIEW_REQUIRED")

    def test_receipt_binds_source_frames(self):
        reference = make_reference(); inspection = make_inspection(reference, defects=[(160, 260, 30, 24)])
        packet = inspect_pair(encode_png(reference), encode_png(inspection), allow_opencv4_dev=True)
        forged = copy.deepcopy(packet); forged["inspection_sha256"] = "0" * 64
        self.assertFalse(verify_evidence_packet(forged))

    def test_aws_source_binding_is_receipt_bound_and_strict(self):
        reference = make_reference(); inspection = make_inspection(reference, defects=[(160, 260, 30, 24)])
        binding = {
            "reference":{"provider":"AWS_S3","bucket":"ref","key":"gold.png","version_id":"R1"},
            "inspection":{"provider":"AWS_S3","bucket":"inspection","key":"one.png","version_id":"I1"},
        }
        packet = inspect_pair(encode_png(reference), encode_png(inspection), allow_opencv4_dev=True, source_binding=binding)
        self.assertEqual(packet["source_binding"], binding)
        self.assertTrue(verify_evidence_packet(packet))
        forged = copy.deepcopy(packet); forged["source_binding"]["reference"]["version_id"] = "R2"
        self.assertFalse(verify_evidence_packet(forged))
        bad = copy.deepcopy(binding); bad["reference"]["version_id"] = ""
        with self.assertRaises(VisionError):
            inspect_pair(encode_png(reference), encode_png(inspection), allow_opencv4_dev=True, source_binding=bad)

    def test_dimension_mismatch_fails_closed(self):
        reference = make_reference(640, 420); inspection = make_reference(600, 420)
        with self.assertRaises(VisionError): inspect_pair(encode_png(reference), encode_png(inspection), allow_opencv4_dev=True)


if __name__ == "__main__": unittest.main()
