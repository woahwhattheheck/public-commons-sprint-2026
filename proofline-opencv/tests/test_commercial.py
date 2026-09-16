
from __future__ import annotations
import copy, json, subprocess, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from proofline.commercial import build_pilot_packet, verify_pilot_packet

SAMPLE = {
    "pilot_id": "SYNTH-DEMO-001",
    "buyer_label": "SYNTHETIC DEMO MANUFACTURER",
    "buyer_is_synthetic": True,
    "site_label": "Demo Cell 1",
    "use_case": "surface visual-change review against a buyer-approved golden reference",
    "reference_policy": "buyer-approved reference image per generation",
    "sample_count": 30,
    "retention_days": 14,
    "input_data_classification": "NON_SENSITIVE_SYNTHETIC",
    "price": {"currency": "USD", "fixed_minor": 1250000, "state": "PROPOSED_NOT_ACCEPTED"},
    "assumptions": {
        "source": "BUYER_SUPPLIED_OR_OWNER_SCENARIO_INPUT",
        "units_per_period": 5000,
        "periods_per_year": 12,
        "manual_review_seconds_per_unit": 45,
        "loaded_labor_cost_per_hour_minor": 4200,
        "modeled_review_share_bps": 2000,
    },
}

class CommercialPilotTests(unittest.TestCase):
    def test_packet_is_deterministic_and_verifies(self):
        a = build_pilot_packet(copy.deepcopy(SAMPLE))
        b = build_pilot_packet(copy.deepcopy(SAMPLE))
        self.assertEqual(a, b)
        self.assertTrue(verify_pilot_packet(a))
        self.assertEqual(a["case_study_state"], "SYNTHETIC_ONLY")
        self.assertEqual(a["commercial_claims"]["revenue_received"], False)

    def test_roi_is_scenario_only(self):
        packet = build_pilot_packet(copy.deepcopy(SAMPLE))
        roi = packet["roi_scenario"]
        self.assertEqual(roi["state"], "USER_INPUT_SCENARIO_NOT_OBSERVED_SAVINGS")
        self.assertIsNone(roi["observed_savings_minor"])
        self.assertGreater(roi["modeled_cost_delta_minor_per_year"], 0)
        self.assertFalse(packet["authority"]["claim_savings"])

    def test_accepted_price_is_rejected(self):
        bad = copy.deepcopy(SAMPLE)
        bad["price"]["state"] = "ACCEPTED"
        with self.assertRaises(ValueError):
            build_pilot_packet(bad)

    def test_unsupported_extra_claim_field_is_rejected(self):
        bad = copy.deepcopy(SAMPLE)
        bad["observed_savings_minor"] = 99999999
        with self.assertRaises(ValueError):
            build_pilot_packet(bad)

    def test_mutated_positive_outcome_fails_even_with_stale_receipt(self):
        packet = build_pilot_packet(copy.deepcopy(SAMPLE))
        packet["commercial_claims"]["pilot_accepted"] = True
        self.assertFalse(verify_pilot_packet(packet))

    def test_mutated_positive_outcome_fails_with_recomputed_receipt(self):
        from proofline.codec import digest_json
        packet = build_pilot_packet(copy.deepcopy(SAMPLE))
        packet["commercial_claims"]["pilot_accepted"] = True
        packet.pop("receipt_sha256")
        packet["receipt_sha256"] = digest_json(packet)
        self.assertFalse(verify_pilot_packet(packet))

    def test_payment_link_injection_fails(self):
        from proofline.codec import digest_json
        packet = build_pilot_packet(copy.deepcopy(SAMPLE))
        packet["pilot"]["price"]["payment_link"] = "https://example.invalid/pay"
        packet.pop("receipt_sha256")
        packet["receipt_sha256"] = digest_json(packet)
        self.assertFalse(verify_pilot_packet(packet))

    def test_live_deployment_injection_fails(self):
        from proofline.codec import digest_json
        packet = build_pilot_packet(copy.deepcopy(SAMPLE))
        packet["source_truth"]["live_aws_deployed"] = True
        packet.pop("receipt_sha256")
        packet["receipt_sha256"] = digest_json(packet)
        self.assertFalse(verify_pilot_packet(packet))

    def test_real_buyer_input_still_is_not_customer_result(self):
        real = copy.deepcopy(SAMPLE)
        real["buyer_label"] = "OWNER-SUPPLIED BUYER LABEL"
        real["buyer_is_synthetic"] = False
        real["input_data_classification"] = "BUYER_APPROVED_NON_SECRET"
        packet = build_pilot_packet(real)
        self.assertTrue(verify_pilot_packet(packet))
        self.assertEqual(packet["case_study_state"], "BUYER_INPUT_PACKET_NOT_CUSTOMER_RESULT")
        self.assertFalse(packet["commercial_claims"]["customer_result"])

    def test_owner_pricing_required_has_no_amount(self):
        data = copy.deepcopy(SAMPLE)
        data["price"] = {"currency": "USD", "fixed_minor": None, "state": "OWNER_PRICING_REQUIRED"}
        packet = build_pilot_packet(data)
        self.assertTrue(verify_pilot_packet(packet))
        self.assertIsNone(packet["pilot"]["price"]["fixed_minor"])


    def test_target_account_research_is_ten_deduped_and_no_outbound(self):
        targets = json.loads((ROOT / "commercial" / "target_accounts.json").read_text(encoding="utf-8"))
        self.assertEqual(len(targets), 10)
        self.assertEqual(len({row["organization"] for row in targets}), 10)
        for row in targets:
            self.assertEqual(row["state"], "RESEARCH_ONLY_NO_OUTBOUND")
            self.assertTrue(row["fit_source"].startswith("https://"))
            self.assertTrue(row["public_route"].startswith("https://"))
            self.assertNotIn("contacted", row)
            self.assertNotIn("buyer_interest", row)

    def test_cli_compile_verify_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            inp = td / "intake.json"
            out = td / "packet.json"
            inp.write_text(json.dumps(SAMPLE), encoding="utf-8")
            env = dict(__import__("os").environ)
            env["PYTHONPATH"] = str(ROOT)
            c = subprocess.run(
                [sys.executable, "-m", "proofline.commercial", "compile", str(inp), str(out)],
                cwd=ROOT, env=env, capture_output=True, text=True, timeout=10
            )
            self.assertEqual(c.returncode, 0, c.stderr)
            v = subprocess.run(
                [sys.executable, "-m", "proofline.commercial", "verify", str(out)],
                cwd=ROOT, env=env, capture_output=True, text=True, timeout=10
            )
            self.assertEqual(v.returncode, 0, v.stderr)

if __name__ == "__main__":
    unittest.main()
