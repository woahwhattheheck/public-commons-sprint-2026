from pathlib import Path
import copy
import sys
import unittest

import cv2
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import evaluate
import proofcam as p

class ProofCamTests(unittest.TestCase):
    def trace(self,hazard="none",**kwargs):
        return p.compile_trace(p.synthetic_scene(hazard=hazard),observed_ms=1000,now_ms=1100,**kwargs)

    def test_opencv5(self):
        self.assertEqual(p.opencv_major(),5,cv2.__version__)
        self.assertTrue(p.opencv5_runtime_evidenced())

    def test_scene_determinism(self):
        self.assertTrue(np.array_equal(p.synthetic_scene(hazard="left"),p.synthetic_scene(hazard="left")))
        self.assertFalse(np.array_equal(p.synthetic_scene(hazard="left"),p.synthetic_scene(hazard="right")))

    def test_agentic_routes(self):
        expected={"none":"CAPTURE_NEXT_FRAME","left":"INSPECT_LEFT_ZONE","center":"NO_ACTION","right":"INSPECT_RIGHT_ZONE"}
        for hazard,tool in expected.items():
            with self.subTest(hazard=hazard):
                trace=self.trace(hazard)
                self.assertEqual(trace["decision"]["tool_plan"],tool)
                self.assertTrue(p.verify_trace(trace))

    def test_center_requires_review(self):
        trace=self.trace("center")
        self.assertEqual(trace["decision"]["decision"],"HUMAN_APPROVAL_REQUIRED")

    def test_unknown_request_requires_review(self):
        trace=self.trace("left",requested_action_class="EXTERNAL_SIDE_EFFECT")
        self.assertEqual(trace["decision"]["decision"],"HUMAN_APPROVAL_REQUIRED")
        self.assertEqual(trace["decision"]["tool_plan"],"NO_ACTION")

    def test_stale_future_and_tampered_evidence_hold(self):
        ev=p.evidence(p.detect(p.synthetic_scene(hazard="left"),observed_ms=1000))
        self.assertEqual(p.decide(ev,now_ms=1000+p.MAX_AGE_MS+1)["decision"],"HOLD_EVIDENCE")
        self.assertEqual(p.decide(ev,now_ms=999)["decision"],"HOLD_EVIDENCE")
        ev["hazard_ppm"]+=1
        self.assertEqual(p.decide(ev,now_ms=1100)["decision"],"HOLD_EVIDENCE")

    def test_wrong_generation_holds_after_digest_refresh(self):
        ev=p.evidence(p.detect(p.synthetic_scene(hazard="left"),observed_ms=1000))
        ev["detector"]="other-generation"
        unsigned={k:ev[k] for k in ev if k!="evidence_sha256"}
        ev["evidence_sha256"]=p.digest_obj(unsigned)
        self.assertEqual(p.decide(ev,now_ms=1100)["decision"],"HOLD_EVIDENCE")

    def test_trace_tamper_fails(self):
        trace=self.trace("right")
        trace["decision"]["tool_plan"]="UNEXPECTED_TOOL"
        self.assertFalse(p.verify_trace(trace))

    def test_authority_flags_stay_false(self):
        trace=self.trace("left")
        self.assertTrue(all(value is False for value in trace["authority"].values()))
        forged=copy.deepcopy(trace)
        forged["authority"]["external_submission_authorized"]=True
        unsigned={k:forged[k] for k in forged if k!="trace_sha256"}
        forged["trace_sha256"]=p.digest_obj(unsigned)
        self.assertFalse(p.verify_trace(forged))

    def test_bool_timestamp_rejected(self):
        with self.assertRaises(p.ProofCamError):
            p.detect(p.synthetic_scene(),observed_ms=True)

    def test_bad_frame_rejected(self):
        with self.assertRaises(p.ProofCamError):
            p.detect(np.zeros((10,10),dtype=np.uint8),observed_ms=0)

    def test_evaluation(self):
        result=evaluate.run_suite()
        self.assertEqual(result["passed"],4)
        self.assertEqual(result["success_ppm"],1000000)

if __name__=="__main__":
    unittest.main()
