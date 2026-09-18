
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
        self.assertFalse(a["source_truth"]["source_test_demo_ready"])
        self.assertEqual(a["source_generation"]["state"], "NOT_ATTESTED_BY_COMMERCIAL_PACKET")
        self.assertIsNone(a["source_generation"]["commit"])
        self.assertIsNone(a["source_generation"]["manifest_sha256"])
        self.assertIsNone(a["source_generation"]["test_execution_receipt"])


    def test_resealed_positive_source_readiness_fails(self):
        from proofline.codec import digest_json
        packet = build_pilot_packet(copy.deepcopy(SAMPLE))
        packet["source_truth"]["source_test_demo_ready"] = True
        packet["source_generation"] = {
            "state": "ATTESTED",
            "commit": "6b660f8907fb18323976bc1deaafa9ba849d33d7",
            "manifest_sha256": "0" * 64,
            "test_execution_receipt": "caller-authored",
        }
        packet.pop("receipt_sha256")
        packet["receipt_sha256"] = digest_json(packet)
        self.assertFalse(verify_pilot_packet(packet))

    def test_old_v1_generation_cannot_verify_even_when_resealed(self):
        from proofline.codec import digest_json
        packet = build_pilot_packet(copy.deepcopy(SAMPLE))
        packet["schema"] = "proofline.commercial-pilot.v1"
        packet["generation"] = "commercial-pilot-2026-09-16"
        packet["source_base_commit"] = "6b660f8907fb18323976bc1deaafa9ba849d33d7"
        packet.pop("source_generation")
        packet["source_truth"]["source_test_demo_ready"] = True
        packet.pop("receipt_sha256")
        packet["receipt_sha256"] = digest_json(packet)
        self.assertFalse(verify_pilot_packet(packet))

    def test_source_reference_cannot_promote_readiness(self):
        from proofline.codec import digest_json
        packet = build_pilot_packet(copy.deepcopy(SAMPLE))
        packet["source_evidence"][0]["truth"] = "SOURCE_AND_TEST_READINESS_ONLY"
        packet["source_truth"]["source_test_demo_ready"] = True
        packet.pop("receipt_sha256")
        packet["receipt_sha256"] = digest_json(packet)
        self.assertFalse(verify_pilot_packet(packet))


    def test_resealed_packet_mutation_cannot_redefine_verifier_policy(self):
        from proofline.codec import digest_json
        packet = build_pilot_packet(copy.deepcopy(SAMPLE))
        packet["authority"]["claim_revenue"] = True
        packet["commercial_claims"]["revenue_received"] = True
        packet["source_evidence"][0]["truth"] = "CALLER_PROMOTED"
        packet["acceptance_criteria"][0]["proof"] = "caller says pass"
        packet.pop("receipt_sha256")
        packet["receipt_sha256"] = digest_json(packet)
        self.assertFalse(verify_pilot_packet(packet))

        clean = build_pilot_packet(copy.deepcopy(SAMPLE))
        self.assertTrue(verify_pilot_packet(clean))
        self.assertFalse(clean["authority"]["claim_revenue"])
        self.assertFalse(clean["commercial_claims"]["revenue_received"])
        self.assertEqual(
            clean["source_evidence"][0]["truth"],
            "SOURCE_REFERENCE_NOT_READINESS_ATTESTATION",
        )

    def test_post_import_policy_root_rebinding_cannot_promote_packet(self):
        import proofline.commercial as commercial
        from proofline.codec import digest_json

        clean = commercial.build_pilot_packet(copy.deepcopy(SAMPLE))

        def reseal(packet):
            candidate = copy.deepcopy(packet)
            candidate.pop("receipt_sha256", None)
            candidate["receipt_sha256"] = digest_json(candidate)
            return candidate

        variants = []
        candidate = copy.deepcopy(clean)
        candidate["source_generation"]["state"] = "ATTESTED"
        variants.append(reseal(candidate))
        candidate = copy.deepcopy(clean)
        candidate["authority"]["claim_revenue"] = True
        variants.append(reseal(candidate))
        candidate = copy.deepcopy(clean)
        candidate["commercial_claims"]["revenue_received"] = True
        variants.append(reseal(candidate))
        candidate = copy.deepcopy(clean)
        candidate["source_evidence"][0]["truth"] = "CALLER_PROMOTED"
        variants.append(reseal(candidate))
        candidate = copy.deepcopy(clean)
        candidate["acceptance_criteria"][0]["proof"] = "caller says pass"
        variants.append(reseal(candidate))
        candidate = copy.deepcopy(clean)
        candidate["pilot"]["buyer_label"] = ""
        variants.append(reseal(candidate))
        candidate = copy.deepcopy(clean)
        candidate["roi_scenario"]["modeled_cost_delta_minor_per_year"] += 1
        variants.append(reseal(candidate))
        candidate = copy.deepcopy(clean)
        candidate["receipt_sha256"] = "0" * 64
        variants.append(candidate)

        names = [
            "_false_authority", "_false_outcomes", "_source_evidence", "_acceptance_criteria",
            "_normalize_intake", "_roi_scenario", "_int", "_text", "_minor_cost",
            "_packet_for_validation", "SOURCE_READINESS_STATE", "ASSUMPTION_SOURCE",
            "PRICE_STATES", "DATA_CLASSES", "SCHEMA", "GENERATION", "digest_json",
        ]
        saved = {name: getattr(commercial, name) for name in names}
        try:
            commercial._false_authority = lambda: copy.deepcopy(variants[1]["authority"])
            commercial._false_outcomes = lambda: copy.deepcopy(variants[2]["commercial_claims"])
            commercial._source_evidence = lambda: copy.deepcopy(variants[3]["source_evidence"])
            commercial._acceptance_criteria = lambda: copy.deepcopy(variants[4]["acceptance_criteria"])
            commercial._normalize_intake = lambda _: copy.deepcopy(variants[5]["pilot"])
            commercial._roi_scenario = lambda _: copy.deepcopy(variants[6]["roi_scenario"])
            commercial._int = lambda value, *args, **kwargs: value
            commercial._text = lambda value, *args, **kwargs: value
            commercial._minor_cost = lambda *args, **kwargs: 0
            commercial._packet_for_validation = lambda body: copy.deepcopy(body["pilot"])
            commercial.SOURCE_READINESS_STATE = "ATTESTED"
            commercial.ASSUMPTION_SOURCE = "ATTACKER"
            commercial.PRICE_STATES = {"ACCEPTED"}
            commercial.DATA_CLASSES = {"SECRET"}
            commercial.SCHEMA = "attacker.schema"
            commercial.GENERATION = "attacker-generation"
            commercial.digest_json = lambda _: "0" * 64

            self.assertTrue(commercial.verify_pilot_packet(clean))
            for index, variant in enumerate(variants):
                with self.subTest(index=index):
                    self.assertFalse(commercial.verify_pilot_packet(variant))
            with self.assertRaises(commercial.CommercialError):
                commercial.build_pilot_packet(copy.deepcopy(SAMPLE))
        finally:
            for name, value in saved.items():
                setattr(commercial, name, value)

        self.assertTrue(commercial.verify_pilot_packet(clean))

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
