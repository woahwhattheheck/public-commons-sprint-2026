from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from visualledger.agent import canonical, compile_trace, verify_trace
from visualledger.aws_adapter import event_identity, handle_s3_event, normalize_s3_event
from visualledger.synth import benchmark_cases, make_case
from visualledger.vision import VisionError, VisionPolicy, analyze_image, hamming


def event(version: str = "v1", key: str = "entity-a/invoice.png") -> dict:
    return {
        "Records": [{
            "s3": {
                "bucket": {"name": "visualledger-fixtures"},
                "object": {"key": key, "versionId": version, "eTag": "abc123"},
            }
        }]
    }


class VisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.clear = make_case("clear")
        cls.blur = make_case("blur")
        cls.glare = make_case("glare")
        cls.two_docs = make_case("two_docs")
        cls.sparse = make_case("sparse")

    def trace(self, raw, **kwargs):
        return compile_trace(raw, evidence_id="EV-1", allow_opencv4_dev=True, **kwargs)

    def test_default_runtime_requires_opencv5(self):
        import cv2
        if int(cv2.__version__.split(".", 1)[0]) < 5:
            with self.assertRaises(VisionError):
                compile_trace(self.clear, evidence_id="EV")
        else:
            self.assertTrue(compile_trace(self.clear, evidence_id="EV")["perception"]["competition_opencv5_runtime"])

    def test_dev_runtime_is_explicitly_not_competition_runtime_on_opencv4(self):
        import cv2
        t = self.trace(self.clear)
        major = int(cv2.__version__.split(".", 1)[0])
        self.assertEqual(t["perception"]["competition_opencv5_runtime"], major >= 5)
        self.assertEqual(t["perception"]["development_compatibility_used"], major < 5)

    def test_clear_routes_to_field_extraction(self):
        t = self.trace(self.clear)
        self.assertEqual(t["decision"]["action"], "REQUEST_FIELD_EXTRACTION")
        self.assertEqual(t["decision"]["reasons"], ["VISION_INTAKE_PASSED"])

    def test_blur_routes_to_recapture(self):
        t = self.trace(self.blur)
        self.assertEqual(t["decision"]["action"], "REQUEST_RECAPTURE")
        self.assertIn("BLUR_BELOW_POLICY", t["decision"]["reasons"])

    def test_glare_routes_to_recapture(self):
        t = self.trace(self.glare)
        self.assertEqual(t["decision"]["action"], "REQUEST_RECAPTURE")
        self.assertIn("GLARE_ABOVE_POLICY", t["decision"]["reasons"])

    def test_two_documents_route_to_human_crop(self):
        t = self.trace(self.two_docs)
        self.assertEqual(t["decision"]["action"], "REQUEST_HUMAN_CROP")
        self.assertIn("AMBIGUOUS_DOCUMENT_GEOMETRY", t["decision"]["reasons"])

    def test_sparse_routes_to_human_crop(self):
        t = self.trace(self.sparse)
        self.assertEqual(t["decision"]["action"], "REQUEST_HUMAN_CROP")
        self.assertIn("TEXT_STRUCTURE_TOO_SPARSE", t["decision"]["reasons"])

    def test_exact_duplicate_preempts_other_routes(self):
        original = self.trace(self.clear)
        prior = [{"evidence_id": "OLD-1", "fingerprint": original["perception"]["fingerprint_dhash64"]}]
        t = self.trace(self.clear, prior_fingerprints=prior)
        self.assertEqual(t["decision"]["action"], "QUARANTINE_DUPLICATE_REVIEW")
        self.assertEqual(t["perception"]["nearest_prior"]["hamming"], 0)

    def test_near_duplicate_distance(self):
        original = self.trace(self.clear)
        fp = original["perception"]["fingerprint_dhash64"]
        mutated = f"{int(fp, 16) ^ 1:016x}"
        prior = [{"evidence_id": "OLD-1", "fingerprint": mutated}]
        t = self.trace(self.clear, prior_fingerprints=prior)
        self.assertEqual(t["perception"]["nearest_prior"]["hamming"], 1)
        self.assertEqual(t["decision"]["action"], "QUARANTINE_DUPLICATE_REVIEW")

    def test_hamming_known(self):
        self.assertEqual(hamming("0000000000000000", "000000000000000f"), 4)
        with self.assertRaises(VisionError):
            hamming("NOPE", "0000000000000000")

    def test_deterministic_trace(self):
        a = self.trace(self.clear)
        b = self.trace(self.clear)
        self.assertEqual(canonical(a), canonical(b))

    def test_verify_happy(self):
        t = self.trace(self.clear)
        self.assertEqual(verify_trace(t, self.clear, allow_opencv4_dev=True), t)

    def test_receipt_tamper_rejected(self):
        t = self.trace(self.clear)
        t["decision"]["action"] = "AUTO_APPROVE"
        with self.assertRaises(VisionError):
            verify_trace(t, self.clear, allow_opencv4_dev=True)

    def test_semantic_tamper_rejected_even_if_receipt_rewritten(self):
        import hashlib
        t = self.trace(self.clear)
        t["authority"]["pay_or_move_funds"] = True
        body = dict(t); body.pop("receipt_sha256")
        t["receipt_sha256"] = hashlib.sha256(canonical(body)).hexdigest()
        with self.assertRaises(VisionError):
            verify_trace(t, self.clear, allow_opencv4_dev=True)

    def test_source_image_change_rejected(self):
        t = self.trace(self.clear)
        with self.assertRaises(VisionError):
            verify_trace(t, self.sparse, allow_opencv4_dev=True)

    def test_authority_is_hard_false(self):
        authority = self.trace(self.clear)["authority"]
        self.assertTrue(authority)
        self.assertTrue(all(v is False for v in authority.values()))

    def test_truth_claims_are_false(self):
        truth = self.trace(self.clear)["truth"]
        self.assertTrue(all(v is False for v in truth.values()))

    def test_empty_malformed_and_oversize_rejected(self):
        for raw in [b"", b"not-an-image", b"x" * (20 * 1024 * 1024 + 1)]:
            with self.subTest(size=len(raw)), self.assertRaises(VisionError):
                analyze_image(raw, allow_opencv4_dev=True)

    def test_tiny_image_rejected(self):
        import cv2, numpy as np
        ok, enc = cv2.imencode(".png", np.zeros((100, 100, 3), dtype=np.uint8))
        self.assertTrue(ok)
        with self.assertRaises(VisionError):
            analyze_image(bytes(enc.tobytes()), allow_opencv4_dev=True)

    def test_policy_bool_and_invalid_bounds_rejected(self):
        for p in [VisionPolicy(min_width=True), VisionPolicy(min_document_area_ppm=500000, max_document_area_ppm=400000), VisionPolicy(duplicate_hamming_max=65)]:
            with self.subTest(p=p), self.assertRaises(VisionError):
                analyze_image(self.clear, policy=p, allow_opencv4_dev=True)

    def test_prior_schema_rejected(self):
        bad = [
            [{"fingerprint": "0" * 16}],
            [{"evidence_id": "X", "fingerprint": "GG" + "0" * 14}],
            [{"evidence_id": "../X", "fingerprint": "0" * 16}],
            [{"evidence_id": "X", "fingerprint": "0" * 16}, {"evidence_id": "X", "fingerprint": "1" * 16}],
        ]
        for prior in bad:
            with self.subTest(prior=prior), self.assertRaises(VisionError):
                self.trace(self.clear, prior_fingerprints=prior)

    def test_prior_bound_rejected(self):
        prior = [{"evidence_id": f"E{i}", "fingerprint": f"{i:016x}"} for i in range(3)]
        with self.assertRaises(VisionError):
            self.trace(self.clear, prior_fingerprints=prior, policy=VisionPolicy(max_prior_fingerprints=2))

    def test_benchmark_routes_all_match(self):
        raws = {k: getattr(self, k) for k in ["clear", "blur", "glare", "two_docs", "sparse"]}
        results = []
        for row in benchmark_cases():
            actual = self.trace(raws[row["kind"]])["decision"]["action"]
            results.append((row["kind"], row["expected_action"], actual))
        self.assertTrue(all(expected == actual for _, expected, actual in results), results)


class AwsAdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = make_case("clear")

    def test_event_normalization_and_identity_version_bound(self):
        a = normalize_s3_event(event("v1"))
        b = normalize_s3_event(event("v2"))
        self.assertNotEqual(event_identity(a), event_identity(b))

    def test_event_requires_exactly_one_versioned_record(self):
        for bad in [{}, {"Records": []}, {"Records": [event()["Records"][0], event()["Records"][0]]}]:
            with self.subTest(bad=bad), self.assertRaises(VisionError):
                normalize_s3_event(bad)
        bad = event(); del bad["Records"][0]["s3"]["object"]["versionId"]
        with self.assertRaises(VisionError): normalize_s3_event(bad)

    def test_event_rejects_unsafe_key(self):
        for key in ["/abs.png", "entity/../x.png", "entity/space key.png"]:
            with self.subTest(key=key), self.assertRaises(VisionError):
                normalize_s3_event(event(key=key))

    def test_handler_records_once_and_replays_without_reload(self):
        store = {}; calls = {"load": 0, "write": 0, "prior": 0}
        def load(bucket, key, version): calls["load"] += 1; return self.raw
        def read(k): return store.get(k)
        def write(k, v): calls["write"] += 1; store[k] = v
        def priors(scope): calls["prior"] += 1; return []
        first = handle_s3_event(event(), load_object=load, read_record=read, write_record=write, load_prior_fingerprints=priors, allow_opencv4_dev=True)
        second = handle_s3_event(event(), load_object=load, read_record=read, write_record=write, load_prior_fingerprints=priors, allow_opencv4_dev=True)
        self.assertEqual(first["status"], "RECORDED")
        self.assertEqual(second["status"], "IDEMPOTENT_REPLAY")
        self.assertEqual(calls, {"load": 1, "write": 1, "prior": 1})
        self.assertEqual(first["event_id"], second["event_id"])

    def test_handler_scope_prior_changes_action(self):
        base = compile_trace(self.raw, evidence_id="BASE", allow_opencv4_dev=True)
        prior = [{"evidence_id": "BASE", "fingerprint": base["perception"]["fingerprint_dhash64"]}]
        store = {}
        out = handle_s3_event(
            event(), load_object=lambda b,k,v: self.raw, read_record=lambda k: None,
            write_record=lambda k,v: store.setdefault(k,v), load_prior_fingerprints=lambda scope: prior,
            allow_opencv4_dev=True,
        )
        self.assertEqual(out["record"]["scope"], "entity-a")
        self.assertEqual(out["record"]["trace"]["decision"]["action"], "QUARANTINE_DUPLICATE_REVIEW")

    def test_handler_rejects_malformed_existing_record(self):
        with self.assertRaises(VisionError):
            handle_s3_event(
                event(), load_object=lambda *a: self.raw,
                read_record=lambda k: {"event_id": "wrong"}, write_record=lambda *a: None,
                load_prior_fingerprints=lambda s: [], allow_opencv4_dev=True,
            )

    def test_aws_record_receipt_is_deterministic(self):
        def run():
            store = {}
            return handle_s3_event(
                event(), load_object=lambda *a: self.raw, read_record=lambda k: None,
                write_record=lambda k,v: store.setdefault(k,v), load_prior_fingerprints=lambda s: [],
                allow_opencv4_dev=True,
            )["record"]
        self.assertEqual(canonical(run()), canonical(run()))


class CliTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = make_case("clear")

    def cli(self, *args):
        env = os.environ.copy(); env["PYTHONPATH"] = str(ROOT)
        return subprocess.run([sys.executable, "-m", "visualledger.cli", *map(str,args)], cwd=ROOT, env=env, capture_output=True, text=True, timeout=30)

    def test_analyze_verify_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); image=root/"doc.png"; out=root/"trace.json"; image.write_bytes(self.raw)
            a=self.cli("analyze", image, "--evidence-id", "CLI-1", "--out", out, "--allow-opencv4-dev")
            self.assertEqual(a.returncode, 0, a.stderr)
            v=self.cli("verify", image, out, "--allow-opencv4-dev")
            self.assertEqual(v.returncode, 0, v.stderr)
            self.assertEqual(a.stdout.strip(), v.stdout.strip())

    def test_analyze_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); image=root/"doc.png"; out=root/"trace.json"; image.write_bytes(self.raw); out.write_text("owned")
            a=self.cli("analyze", image, "--evidence-id", "CLI-1", "--out", out, "--allow-opencv4-dev")
            self.assertEqual(a.returncode, 1)
            self.assertEqual(out.read_text(), "owned")

    def test_symlink_input_refused(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); image=root/"doc.png"; alias=root/"alias.png"; out=root/"trace.json"; image.write_bytes(self.raw)
            try: alias.symlink_to(image)
            except OSError: self.skipTest("symlink unavailable")
            a=self.cli("analyze", alias, "--evidence-id", "CLI-1", "--out", out, "--allow-opencv4-dev")
            self.assertEqual(a.returncode, 1)

    def test_evaluate_routes_all_cases(self):
        r=self.cli("evaluate", "--allow-opencv4-dev")
        self.assertEqual(r.returncode, 0, r.stderr)
        payload=json.loads(r.stdout)
        self.assertEqual(payload["passed"], payload["total"])
        self.assertEqual(payload["total"], 5)


if __name__ == "__main__":
    unittest.main()
