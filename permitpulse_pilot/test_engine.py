import json
import subprocess
import sys
import tempfile
import unittest
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE_PATH = Path(__file__).resolve().parent / "engine.py"
SPEC = spec_from_file_location("pp_engine", ENGINE_PATH)
ENGINE = module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(ENGINE)
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "synthetic_pilot.json"


def base():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


class TestPermitPulsePilot(unittest.TestCase):
    def test_fixture_compiles(self):
        packet = ENGINE.compile_packet(base(), repo_root=ROOT)
        self.assertEqual(packet["commercial"]["status"], "PROPOSED_NOT_ACCEPTED")
        self.assertFalse(packet["commercial"]["paymentLink"])
        self.assertEqual(packet["commercial"]["acceptedPriceMinor"], 0)
        self.assertFalse(any(packet["commercialFlags"].values()))
        self.assertFalse(packet["laborWorksheet"]["savingsInferred"])
        self.assertFalse(packet["acceptanceContract"]["legalOrComplianceConclusion"])
        self.assertEqual(packet["truthLedger"]["predecessor"]["readyForSubmission"], False)
        self.assertEqual(packet["truthLedger"]["provider"], "NOT_INVOKED")
        self.assertEqual(packet["researchAccounts"][0]["posture"], "RESEARCH_ONLY_NO_OUTBOUND")
        self.assertEqual(packet["laborWorksheet"]["totalLaborMinutes"], 45)

    def test_float_rejected(self):
        with self.assertRaisesRegex(ENGINE.ValidationError, "floats"):
            ENGINE.loads_strict('{"x":1.2}')

    def test_duplicate_key_rejected(self):
        with self.assertRaisesRegex(ENGINE.ValidationError, "duplicate JSON key"):
            ENGINE.loads_strict('{"a":1,"a":2}')

    def test_bool_int_rejected(self):
        src = base()
        src["intake"]["retentionDays"] = True
        with self.assertRaisesRegex(ENGINE.ValidationError, "integer"):
            ENGINE.compile_packet(src, repo_root=ROOT)

    def test_accepted_commercial_rejected(self):
        src = base()
        src["commercial"]["status"] = "ACCEPTED"
        with self.assertRaisesRegex(ENGINE.ValidationError, "PROPOSED_NOT_ACCEPTED"):
            ENGINE.compile_packet(src, repo_root=ROOT)

    def test_payment_link_rejected(self):
        src = base()
        src["commercial"]["paymentLink"] = True
        with self.assertRaisesRegex(ENGINE.ValidationError, "paymentLink"):
            ENGINE.compile_packet(src, repo_root=ROOT)

    def test_forbidden_token_rejected(self):
        src = base()
        src["intake"]["jurisdictions"][0]["label"] = "compliant-county"
        with self.assertRaisesRegex(ENGINE.ValidationError, "forbidden"):
            ENGINE.compile_packet(src, repo_root=ROOT)

    def test_non_synthetic_source_rejected(self):
        src = base()
        src["intake"]["sources"][0]["httpsUrl"] = "https://real-agency.example.com/permits"
        with self.assertRaisesRegex(ENGINE.ValidationError, "example.invalid"):
            ENGINE.compile_packet(src, repo_root=ROOT)

    def test_research_outbound_rejected(self):
        src = base()
        src["researchAccounts"][0]["posture"] = "SEND_NOW"
        with self.assertRaisesRegex(ENGINE.ValidationError, "RESEARCH_ONLY"):
            ENGINE.compile_packet(src, repo_root=ROOT)

    def test_identical_change_digests_rejected(self):
        src = base()
        src["changes"][0]["afterDigest"] = src["changes"][0]["beforeDigest"]
        with self.assertRaisesRegex(ENGINE.ValidationError, "distinct"):
            ENGINE.compile_packet(src, repo_root=ROOT)

    def test_cli_compile_verify(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out"
            self.assertEqual(ENGINE.main(["compile", str(FIXTURE), str(out)]), 0)
            self.assertEqual(ENGINE.main(["verify", str(FIXTURE), str(out)]), 0)
            self.assertTrue(ENGINE.verify(base(), out, repo_root=ROOT))
            receipt = json.loads((out / "receipt.json").read_text(encoding="utf-8"))
            self.assertIs(receipt["readyForSubmission"], False)

    def test_overwrite_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out"
            self.assertEqual(ENGINE.main(["compile", str(FIXTURE), str(out)]), 0)
            self.assertEqual(ENGINE.main(["compile", str(FIXTURE), str(out)]), 2)

    def test_subprocess_module(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out"
            proc = subprocess.run(
                [sys.executable, str(ENGINE_PATH), "compile", str(FIXTURE), str(out)],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            proc = subprocess.run(
                [sys.executable, "-O", str(ENGINE_PATH), "verify", str(FIXTURE), str(out)],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)


if __name__ == "__main__":
    unittest.main()
