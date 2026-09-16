import copy
import math
import unittest

from proofline.agent import ProposalError, build_review_proposal, verify_review_proposal
from proofline.codec import CodecError, canonical_json, digest_json, loads_strict
from proofline.vision import PIPELINE_GENERATION, verify_evidence_packet


def evidence_packet():
    packet = {
        "schema": "proofline.evidence.v1",
        "pipeline_generation": PIPELINE_GENERATION,
        "opencv_version": "5.0.0",
        "reference_sha256": "a" * 64,
        "inspection_sha256": "b" * 64,
        "dimensions_wh": [640, 420],
        "registration": {"method": "ECC_AFFINE", "score": 0.99, "inspection_to_reference": [[1,0,0],[0,1,0]]},
        "segmentation": {"method": "ABSDIFF_OTSU_MORPH_CC", "threshold": 24, "mask_sha256": "c" * 64},
        "regions": [{"region_id": "R001", "bbox_xywh": [10,20,30,40], "area_px": 500, "area_ratio": 0.001, "mean_delta": 60.0, "max_delta": 120, "evidence_crop_sha256": "d" * 64}],
        "summary": {"region_count": 1, "total_region_area_px": 500, "max_region_area_px": 500},
        "authority": {"quality_disposition": False, "production_mutation": False, "vendor_contact": False, "purchase_or_payment": False, "external_send": False},
    }
    packet["receipt_sha256"] = digest_json(packet)
    return packet


class CodecAgentTests(unittest.TestCase):
    def test_canonical_rejects_nonfinite_and_surrogate(self):
        with self.assertRaises(CodecError):
            canonical_json({"x": math.nan})
        with self.assertRaises(CodecError):
            canonical_json({"x": "\ud800"})

    def test_loads_bounds_and_utf8(self):
        self.assertEqual(loads_strict('{"b":2,"a":1}'), {"a": 1, "b": 2})
        with self.assertRaises(CodecError):
            loads_strict(b"\xff")
        with self.assertRaises(CodecError):
            loads_strict("x" * 100, max_bytes=10)

    def test_packet_and_proposal_tamper_fail(self):
        packet = evidence_packet()
        self.assertTrue(verify_evidence_packet(packet))
        proposal = build_review_proposal(packet)
        self.assertTrue(verify_review_proposal(proposal, packet))
        tampered = copy.deepcopy(proposal)
        tampered["authority"]["approve_product"] = True
        self.assertFalse(verify_review_proposal(tampered, packet))
        tampered2 = copy.deepcopy(packet)
        tampered2["regions"][0]["area_px"] += 1
        self.assertFalse(verify_evidence_packet(tampered2))
        with self.assertRaises(ProposalError):
            build_review_proposal(tampered2)

    def test_duplicate_region_rejected(self):
        packet = evidence_packet()
        second = copy.deepcopy(packet["regions"][0])
        packet["regions"].append(second)
        packet["summary"]["region_count"] = 2
        packet["receipt_sha256"] = digest_json({k:v for k,v in packet.items() if k != "receipt_sha256"})
        self.assertFalse(verify_evidence_packet(packet))


if __name__ == "__main__":
    unittest.main()
