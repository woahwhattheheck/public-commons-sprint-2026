"""Focused source/crop custody and actual local HTTP workflow checks."""
import copy
import hashlib
import io
import json
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zipfile

from visualledger.agent import canonical, compile_trace
from visualledger.crop import CropResult, crop_evidence, export_bundle, verify_bundle, verify_crop
from visualledger.synth import make_case
from visualledger.vision import VisionError
from visualledger.workspace import make_server

RECT = {"left": 40, "top": 90, "right": 800, "bottom": 1140}
NOTE = "Select the complete left synthetic document with its border."


class CropWorkspaceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = make_case("two_docs")
        cls.parent = compile_trace(cls.raw, evidence_id="SYNTH-TWO-DOCS", allow_opencv4_dev=True)

    def result(self, **overrides):
        args = {"human_confirmed": True, "note": NOTE, "allow_opencv4_dev": True}
        args.update(overrides)
        return crop_evidence(self.raw, self.parent, RECT, **args)

    def test_actual_crop_transition_and_portable_replay(self):
        before = canonical(self.parent)
        result = self.result()
        self.assertEqual(self.parent["decision"]["action"], "REQUEST_HUMAN_CROP")
        self.assertEqual(result.trace["decision"]["action"], "REQUEST_FIELD_EXTRACTION")
        self.assertTrue(result.trace["decision"]["human_review_required"])
        self.assertFalse(any(result.trace["authority"].values()))
        self.assertEqual(result.trace["perception"]["policy"], self.parent["perception"]["policy"])
        self.assertEqual(canonical(self.parent), before)
        bundle = export_bundle(self.raw, self.parent, result, allow_opencv4_dev=True)
        replayed = verify_bundle(bundle, allow_opencv4_dev=True)
        self.assertEqual(replayed.receipt, result.receipt)
        with zipfile.ZipFile(io.BytesIO(bundle)) as archive:
            self.assertEqual(archive.read("source.img"), self.raw)
            manifest = json.loads(archive.read("manifest.json"))
            self.assertEqual(len(manifest["documents"]), 2)

    def test_crop_refuses_invalid_geometry_provenance_and_route_bypass(self):
        for rect in [dict(RECT, left=-1), dict(RECT, left=True), dict(RECT, right=1601)]:
            with self.subTest(rect=rect), self.assertRaises(VisionError):
                crop_evidence(self.raw, self.parent, rect, human_confirmed=True, note=NOTE,
                              allow_opencv4_dev=True)
        with self.assertRaises(VisionError):
            self.result(human_confirmed=False)
        with self.assertRaises(VisionError):
            self.result(prior_fingerprints=[{"evidence_id": "PREVIOUS", "fingerprint": "0000000000000000"}])
        result = self.result()
        forged = copy.deepcopy(result.receipt)
        forged["rectangle"]["left"] += 1
        forged.pop("receipt_sha256")
        forged["receipt_sha256"] = hashlib.sha256(canonical(forged)).hexdigest()
        with self.assertRaises(VisionError):
            verify_crop(self.raw, self.parent, CropResult(result.png, result.trace, forged),
                        allow_opencv4_dev=True)
        blurred = make_case("blur")
        trace = compile_trace(blurred, evidence_id="BLUR", allow_opencv4_dev=True)
        with self.assertRaises(VisionError):
            crop_evidence(blurred, trace, RECT, human_confirmed=True, note=NOTE, allow_opencv4_dev=True)

    def test_http_load_crop_export_and_stale_case_fence(self):
        server = make_server(0, allow_opencv4_dev=True)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        origin = f"http://127.0.0.1:{server.server_address[1]}"
        try:
            with urlopen(origin + "/api/config", timeout=10) as response:
                config = json.load(response)
            def post(path, body, foreign=False):
                request = Request(origin + path, canonical(body), method="POST", headers={
                    "Content-Type": "application/json", "X-Workspace-Token": config["token"],
                    "Origin": "http://example.invalid" if foreign else origin})
                return urlopen(request, timeout=15)
            with self.assertRaises(HTTPError) as blocked:
                post("/api/demo", {"kind": "two_docs"}, foreign=True)
            self.assertEqual(blocked.exception.code, 403)
            with post("/api/demo", {"kind": "two_docs"}) as response:
                source = json.load(response)
            payload = {"case_id": source["case_id"], "rectangle": RECT,
                       "human_confirmed": True, "note": NOTE}
            with post("/api/crop", payload) as response:
                child = json.load(response)
            with post("/api/export", {"case_id": source["case_id"],
                                       "receipt_sha256": child["receipt"]["receipt_sha256"]}) as response:
                self.assertEqual(response.headers["Content-Type"], "application/zip")
                verify_bundle(response.read(), allow_opencv4_dev=True)
            with post("/api/demo", {"kind": "blur"}) as response:
                self.assertEqual(json.load(response)["trace"]["decision"]["action"], "REQUEST_RECAPTURE")
            with self.assertRaises(HTTPError) as stale:
                post("/api/crop", payload)
            self.assertEqual(stale.exception.code, 400)
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
