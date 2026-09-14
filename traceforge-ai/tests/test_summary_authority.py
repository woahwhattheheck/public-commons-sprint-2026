from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from traceforge.core import EvidenceDocument, analyze, sha256_json, verify_receipt

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = "database timeout while acquiring checkout connection\n"
FALSE_SUMMARY = "All customer records were exfiltrated and the incident is contained."


class FalseSummaryGroundedFindingModel:
    @property
    def identity(self) -> str:
        return "false-summary-grounded-finding/v1"

    def complete(self, *, phase, prompt, evidence: EvidenceDocument, context=None) -> str:
        del prompt
        if phase == "investigator":
            payload = {
                "schema": "traceforge-investigator/v1",
                "evidence_sha256": evidence.sha256,
                "summary": FALSE_SUMMARY,
                "findings": [
                    {
                        "id": "F1",
                        "claim": "Database timeout while acquiring checkout connection",
                        "severity": "high",
                        "citations": ["E0001"],
                        "action": "Inspect dependency health before changing production.",
                    }
                ],
            }
        else:
            payload = {
                "schema": "traceforge-skeptic/v1",
                "evidence_sha256": evidence.sha256,
                "verdicts": [
                    {
                        "finding_id": "F1",
                        "status": "ACCEPT",
                        "reason": "The cited evidence supports the timeout claim only.",
                    }
                ],
            }
        return json.dumps(payload, separators=(",", ":"))


def reseal(packet: dict) -> dict:
    core = {key: value for key, value in packet.items() if key != "receipt"}
    digest = sha256_json(core)
    packet["receipt"] = {
        "schema": "traceforge-receipt/v1",
        "evidence_sha256": core["evidence"]["sha256"],
        "analysis_sha256": digest,
        "model": core["model"],
        "run_id": digest[:16],
    }
    return packet


class SummaryAuthorityTests(unittest.TestCase):
    def test_false_summary_is_receipt_bound_but_explicitly_review_only(self):
        packet = analyze(EVIDENCE, FalseSummaryGroundedFindingModel())
        self.assertEqual(packet["findings"][0]["status"], "PASS")
        self.assertEqual(packet["summary"], FALSE_SUMMARY)
        self.assertEqual(packet["summary_review"]["status"], "REVIEW_ONLY")
        self.assertIn("not evidence-verified", packet["summary_review"]["reason"])
        self.assertTrue(verify_receipt(packet))

    def test_resealed_summary_authority_upgrade_is_rejected(self):
        packet = analyze(EVIDENCE, FalseSummaryGroundedFindingModel())
        packet["summary_review"] = {
            "status": "VERIFIED",
            "reason": "forged summary authority",
        }
        self.assertFalse(verify_receipt(reseal(packet)))

    def test_resealed_summary_review_omission_is_rejected(self):
        packet = analyze(EVIDENCE, FalseSummaryGroundedFindingModel())
        del packet["summary_review"]
        self.assertFalse(verify_receipt(reseal(packet)))

    def test_browser_copy_separates_packet_integrity_from_model_truth(self):
        app = (ROOT / "web" / "app.js").read_text(encoding="utf-8")
        page = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
        self.assertIn("REVIEW_ONLY · MODEL SUMMARY", page)
        self.assertIn("VERIFIED CLAIMS · REVIEW-ONLY MODEL TEXT", page)
        self.assertIn("Packet integrity verified · model summary/actions remain review-only", app)
        self.assertNotIn("Receipt verified'", app)


if __name__ == "__main__":
    unittest.main()
