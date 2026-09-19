from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path

from circularvalue.cli import MAX_JSON_BYTES, main as cli_main
from circularvalue.core import CircularValueError, canonical_json, compile_case, loads_strict, verify_packet
from circularvalue.demo import synthetic_case


class CircularValueTests(unittest.TestCase):
    def setUp(self):
        self.case = synthetic_case()

    def test_demo_compiles(self):
        packet = compile_case(self.case)
        self.assertEqual(packet["schema"], "circularvalue.packet/v1")
        self.assertEqual(packet["currency"], "GBP")

    def test_demo_is_human_review_due_to_hypothesis(self):
        packet = compile_case(self.case)
        self.assertEqual(packet["decisionSupportState"], "HUMAN_REVIEW_HYPOTHESIS")
        self.assertEqual(packet["quality"]["hypothesisLeverIds"], ["retention-signal"])

    def test_packet_verifies(self):
        packet = compile_case(self.case)
        self.assertTrue(verify_packet(self.case, packet))

    def test_packet_tamper_fails(self):
        packet = compile_case(self.case)
        packet["npv"]["centralMinor"] += 1
        self.assertFalse(verify_packet(self.case, packet))

    def test_resealed_packet_semantic_tamper_fails(self):
        packet = compile_case(self.case)
        packet["decisionSupportState"] = "EVIDENCE_POSITIVE_ACROSS_RANGE"
        body = dict(packet)
        body.pop("packetSha256")
        from circularvalue.core import digest_json
        packet["packetSha256"] = digest_json(body)
        self.assertFalse(verify_packet(self.case, packet))

    def test_source_tamper_fails(self):
        packet = compile_case(self.case)
        self.case["levers"][0]["centralMinor"] += 1
        self.assertFalse(verify_packet(self.case, packet))

    def test_evidence_sha_must_be_exact_lowercase_hex(self):
        self.case["evidence"][0]["sha256"] = "A" * 64
        with self.assertRaises(CircularValueError):
            compile_case(self.case)

    def test_evidence_sha_is_retained_in_packet(self):
        packet = compile_case(self.case)
        row = next(r for r in packet["evidence"] if r["id"] == "ev-packaging-spend")
        self.assertEqual(row["sha256"], self.case["evidence"][0]["sha256"])

    def test_evidence_hash_change_changes_source_binding(self):
        one = compile_case(copy.deepcopy(self.case))
        changed = copy.deepcopy(self.case)
        changed["evidence"][0]["sha256"] = "0" * 64
        two = compile_case(changed)
        self.assertNotEqual(one["sourceCaseSha256"], two["sourceCaseSha256"])
        self.assertNotEqual(one["packetSha256"], two["packetSha256"])

    def test_verifier_policy_survives_post_import_module_rebinding(self):
        import circularvalue.core as core
        case = copy.deepcopy(self.case)
        clean = core.compile_case(case)
        tampered = copy.deepcopy(clean)
        tampered["decisionSupportState"] = "EVIDENCE_POSITIVE_ACROSS_RANGE"
        body = dict(tampered)
        body.pop("packetSha256")
        tampered["packetSha256"] = core.digest_json(body)
        saved = {
            "compile_case": core.compile_case,
            "digest_json": core.digest_json,
            "_parse_case": core._parse_case,
            "_npv": core._npv,
            "_simple_payback_months": core._simple_payback_months,
        }
        try:
            core.compile_case = lambda raw: tampered
            core.digest_json = lambda value: "0" * 64
            core._parse_case = lambda raw: {}
            core._npv = lambda *args, **kwargs: 999999999
            core._simple_payback_months = lambda *args, **kwargs: 0
            self.assertTrue(core.verify_packet(case, clean))
            self.assertFalse(core.verify_packet(case, tampered))
        finally:
            for name, value in saved.items():
                setattr(core, name, value)

    def test_unknown_evidence_fails(self):
        self.case["levers"][0]["evidenceIds"] = ["missing"]
        with self.assertRaises(CircularValueError):
            compile_case(self.case)

    def test_missing_evidence_fails(self):
        self.case["levers"][0]["evidenceIds"] = []
        with self.assertRaises(CircularValueError):
            compile_case(self.case)

    def test_duplicate_evidence_id_fails(self):
        self.case["evidence"].append(copy.deepcopy(self.case["evidence"][0]))
        with self.assertRaises(CircularValueError):
            compile_case(self.case)

    def test_duplicate_lever_id_fails(self):
        self.case["levers"].append(copy.deepcopy(self.case["levers"][0]))
        with self.assertRaises(CircularValueError):
            compile_case(self.case)

    def test_bad_range_fails(self):
        self.case["levers"][0]["lowMinor"] = self.case["levers"][0]["centralMinor"] + 1
        with self.assertRaises(CircularValueError):
            compile_case(self.case)

    def test_float_json_rejected(self):
        with self.assertRaises(CircularValueError):
            loads_strict('{"x": 1.5}')

    def test_duplicate_json_key_rejected(self):
        with self.assertRaises(CircularValueError):
            loads_strict('{"x":1,"x":2}')

    def test_nonfinite_json_rejected(self):
        with self.assertRaises(CircularValueError):
            loads_strict('{"x": NaN}')

    def test_future_evidence_fails(self):
        self.case["evidence"][0]["observedOn"] = "2026-09-19"
        with self.assertRaises(CircularValueError):
            compile_case(self.case)

    def test_stale_evidence_routes_human_review(self):
        self.case["maxEvidenceAgeDays"] = 1
        packet = compile_case(self.case)
        self.assertEqual(packet["decisionSupportState"], "HUMAN_REVIEW_STALE_EVIDENCE")
        self.assertTrue(packet["quality"]["staleEvidenceIds"])

    def test_remove_hypothesis_can_be_positive_across_range(self):
        self.case["levers"] = self.case["levers"][:2]
        packet = compile_case(self.case)
        self.assertIn(packet["decisionSupportState"], {"EVIDENCE_POSITIVE_ACROSS_RANGE", "EXPLORE_SENSITIVITY", "HOLD_NO_POSITIVE_CENTRAL_CASE"})
        self.assertEqual(packet["quality"]["hypothesisLeverIds"], [])

    def test_negative_central_case_holds(self):
        self.case["levers"] = [{
            "id":"loss","label":"Net downside","category":"direct_cash","confidence":"observed",
            "lowMinor":-1_000_000,"centralMinor":-500_000,"highMinor":0,"evidenceIds":["ev-packaging-spend"]
        }]
        self.case["oneOffCostMinor"] = 1_000_000
        self.case["annualRecurringCostMinor"] = 500_000
        packet = compile_case(self.case)
        self.assertEqual(packet["decisionSupportState"], "HOLD_NO_POSITIVE_CENTRAL_CASE")

    def test_sensitivity_sorted_by_spread_then_id(self):
        packet = compile_case(self.case)
        spreads = [r["spreadMinor"] for r in packet["sensitivity"]]
        self.assertEqual(spreads, sorted(spreads, reverse=True))

    def test_category_totals_trace_levers(self):
        packet = compile_case(self.case)
        self.assertEqual(packet["categoryTotals"]["direct_cash"]["leverIds"], ["packaging-purchase-avoidance"])

    def test_authority_is_hard_false(self):
        packet = compile_case(self.case)
        self.assertTrue(packet["authority"])
        self.assertFalse(any(packet["authority"].values()))

    def test_currency_must_be_iso_like_uppercase(self):
        self.case["currency"] = "gbp"
        with self.assertRaises(CircularValueError):
            compile_case(self.case)

    def test_horizon_bounded(self):
        self.case["horizonYears"] = 21
        with self.assertRaises(CircularValueError):
            compile_case(self.case)

    def test_discount_rate_bounded(self):
        self.case["discountRateBps"] = 5001
        with self.assertRaises(CircularValueError):
            compile_case(self.case)

    def test_exact_key_ingress(self):
        self.case["surprise"] = 1
        with self.assertRaises(CircularValueError):
            compile_case(self.case)

    def test_deterministic_recompile(self):
        one = compile_case(copy.deepcopy(self.case))
        two = compile_case(copy.deepcopy(self.case))
        self.assertEqual(one, two)

    def test_order_of_evidence_input_does_not_change_canonical_packet(self):
        one = compile_case(copy.deepcopy(self.case))
        other = copy.deepcopy(self.case)
        other["evidence"].reverse()
        two = compile_case(other)
        self.assertNotEqual(one["sourceCaseSha256"], two["sourceCaseSha256"])
        a = dict(one); b = dict(two)
        a.pop("sourceCaseSha256"); b.pop("sourceCaseSha256")
        a.pop("packetSha256"); b.pop("packetSha256")
        self.assertEqual(a, b)

    def test_payback_none_when_annual_net_nonpositive(self):
        self.case["levers"] = [
            {"id":"zero","label":"Zero","category":"direct_cash","confidence":"observed","lowMinor":0,"centralMinor":0,"highMinor":0,"evidenceIds":["ev-packaging-spend"]}
        ]
        packet = compile_case(self.case)
        self.assertIsNone(packet["simplePaybackMonthsCentral"])

    def test_payback_zero_when_no_oneoff_and_net_nonnegative(self):
        self.case["oneOffCostMinor"] = 0
        self.case["levers"] = [
            {"id":"small","label":"Small","category":"direct_cash","confidence":"observed","lowMinor":100,"centralMinor":100,"highMinor":100,"evidenceIds":["ev-packaging-spend"]}
        ]
        self.case["annualRecurringCostMinor"] = 0
        packet = compile_case(self.case)
        self.assertEqual(packet["simplePaybackMonthsCentral"], 0)

    def test_modelled_lever_reported(self):
        packet = compile_case(self.case)
        self.assertEqual(packet["quality"]["modeledLeverIds"], ["expedite-resilience"])


class CircularValueCliFilesystemTests(unittest.TestCase):
    def setUp(self):
        self.case = synthetic_case()

    def _write_case(self, root: Path) -> Path:
        case_path = root / "case.json"
        case_path.write_text(canonical_json(self.case) + "\n", encoding="utf-8")
        return case_path

    def _symlink_or_skip(self, link: Path, target: Path, *, is_dir: bool = False) -> None:
        try:
            link.symlink_to(target, target_is_directory=is_dir)
        except (OSError, NotImplementedError) as exc:
            self.skipTest(f"symlink unavailable: {exc}")

    def test_cli_rejects_input_symlink(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            case_path = self._write_case(root)
            link = root / "case-link.json"
            self._symlink_or_skip(link, case_path)
            out = root / "packet.json"
            self.assertEqual(cli_main(["compile", str(link), "--out", str(out)]), 2)
            self.assertFalse(out.exists())

    def test_cli_rejects_non_regular_input(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            not_a_file = root / "case-dir"
            not_a_file.mkdir()
            out = root / "packet.json"
            self.assertEqual(cli_main(["compile", str(not_a_file), "--out", str(out)]), 2)
            self.assertFalse(out.exists())

    def test_cli_rejects_oversized_input(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            case_path = root / "case.json"
            case_path.write_bytes(b"{" + (b" " * MAX_JSON_BYTES) + b"}")
            out = root / "packet.json"
            self.assertEqual(cli_main(["compile", str(case_path), "--out", str(out)]), 2)
            self.assertFalse(out.exists())

    def test_compile_refuses_existing_output_without_truncation(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            case_path = self._write_case(root)
            out = root / "packet.json"
            out.write_text("sentinel", encoding="utf-8")
            self.assertEqual(cli_main(["compile", str(case_path), "--out", str(out)]), 2)
            self.assertEqual(out.read_text(encoding="utf-8"), "sentinel")

    def test_compile_refuses_output_symlink_without_write_through(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            case_path = self._write_case(root)
            target = root / "target.txt"
            target.write_text("sentinel", encoding="utf-8")
            out = root / "packet.json"
            self._symlink_or_skip(out, target)
            self.assertEqual(cli_main(["compile", str(case_path), "--out", str(out)]), 2)
            self.assertEqual(target.read_text(encoding="utf-8"), "sentinel")

    def test_demo_refuses_existing_case_child_without_partial_publish(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "demo"
            out.mkdir()
            case_path = out / "case.json"
            case_path.write_text("sentinel", encoding="utf-8")
            self.assertEqual(cli_main(["demo", "--out-dir", str(out)]), 2)
            self.assertEqual(case_path.read_text(encoding="utf-8"), "sentinel")
            self.assertFalse((out / "packet.json").exists())

    def test_demo_refuses_existing_packet_child_and_cleans_first_reservation(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "demo"
            out.mkdir()
            packet_path = out / "packet.json"
            packet_path.write_text("sentinel", encoding="utf-8")
            self.assertEqual(cli_main(["demo", "--out-dir", str(out)]), 2)
            self.assertEqual(packet_path.read_text(encoding="utf-8"), "sentinel")
            self.assertFalse((out / "case.json").exists())

    def test_demo_refuses_child_symlink_without_write_through(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            out = root / "demo"
            out.mkdir()
            target = root / "target.txt"
            target.write_text("sentinel", encoding="utf-8")
            self._symlink_or_skip(out / "case.json", target)
            self.assertEqual(cli_main(["demo", "--out-dir", str(out)]), 2)
            self.assertEqual(target.read_text(encoding="utf-8"), "sentinel")
            self.assertFalse((out / "packet.json").exists())

    def test_demo_refuses_symlink_output_directory(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            real = root / "real"
            real.mkdir()
            link = root / "demo-link"
            self._symlink_or_skip(link, real, is_dir=True)
            self.assertEqual(cli_main(["demo", "--out-dir", str(link)]), 2)
            self.assertEqual(list(real.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
