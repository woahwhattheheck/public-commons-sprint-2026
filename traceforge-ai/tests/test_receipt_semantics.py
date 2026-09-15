from __future__ import annotations

import copy
import hashlib
import json
import math
import unittest

from traceforge.core import MAX_EVIDENCE_BYTES, EvidenceDocument, analyze, sha256_json, verify_receipt


EVIDENCE = "2026-09-14 database timeout while acquiring checkout connection\n"


class StaticModel:
    @property
    def identity(self) -> str:
        return "semantic-receipt-test/v1"

    def complete(self, *, phase, prompt, evidence: EvidenceDocument, context=None) -> str:
        del prompt
        if phase == "investigator":
            payload = {
                "schema": "traceforge-investigator/v1",
                "evidence_sha256": evidence.sha256,
                "summary": "Database timeout evidence is present.",
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
                        "finding_id": item["id"],
                        "status": "ACCEPT",
                        "reason": "Evidence checked.",
                    }
                    for item in (context or {}).get("findings", [])
                ],
            }
        return json.dumps(payload, separators=(",", ":"))


class MissingCitationModel(StaticModel):
    def complete(self, *, phase, prompt, evidence: EvidenceDocument, context=None) -> str:
        if phase == "investigator":
            payload = {
                "schema": "traceforge-investigator/v1",
                "evidence_sha256": evidence.sha256,
                "summary": "A bounded unsupported claim.",
                "findings": [
                    {
                        "id": "F9",
                        "claim": "Database timeout while acquiring checkout connection",
                        "severity": "high",
                        "citations": ["E9999"],
                        "action": "Inspect dependency health before changing production.",
                    }
                ],
            }
            return json.dumps(payload, separators=(",", ":"))
        return super().complete(
            phase=phase,
            prompt=prompt,
            evidence=evidence,
            context=context,
        )


def valid_packet() -> dict:
    packet = analyze(EVIDENCE, StaticModel())
    if not verify_receipt(packet):
        raise AssertionError("test fixture must start valid")
    return packet


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


class ReceiptSemanticConsistencyTests(unittest.TestCase):
    def assert_forgery_rejected(self, mutator):
        packet = copy.deepcopy(valid_packet())
        mutator(packet)
        self.assertFalse(verify_receipt(reseal(packet)))

    def test_valid_analyzer_packet_still_verifies(self):
        self.assertTrue(verify_receipt(valid_packet()))

    def test_max_raw_evidence_without_terminal_newline_round_trips(self):
        packet = analyze("x" * MAX_EVIDENCE_BYTES, StaticModel())
        self.assertEqual(packet["evidence"]["byte_count"], MAX_EVIDENCE_BYTES + 1)
        self.assertTrue(verify_receipt(packet))

    def test_legitimate_missing_citation_hold_still_verifies(self):
        packet = analyze(EVIDENCE, MissingCitationModel())
        self.assertEqual(packet["findings"][0]["status"], "HOLD")
        self.assertTrue(verify_receipt(packet))

    def test_rejects_checksum_correct_evidence_digest_forgery(self):
        self.assert_forgery_rejected(
            lambda packet: packet["evidence"].__setitem__("sha256", "0" * 64)
        )

    def test_rejects_checksum_correct_noncanonical_line_sequence(self):
        self.assert_forgery_rejected(
            lambda packet: packet["evidence"]["lines"][0].__setitem__("id", "E0002")
        )

    def test_rejects_checksum_correct_evidence_byte_count_forgery(self):
        self.assert_forgery_rejected(
            lambda packet: packet["evidence"].__setitem__(
                "byte_count", packet["evidence"]["byte_count"] + 1
            )
        )

    def test_rejects_checksum_correct_counts_forgery(self):
        def mutate(packet):
            packet["counts"] = {"pass": 0, "hold": 1}

        self.assert_forgery_rejected(mutate)

    def test_rejects_checksum_correct_status_and_reason_forgery(self):
        def mutate(packet):
            finding = packet["findings"][0]
            finding["status"] = "HOLD"
            finding["verification_reason"] = "forged hold"
            packet["counts"] = {"pass": 0, "hold": 1}

        self.assert_forgery_rejected(mutate)

    def test_rejects_checksum_correct_support_score_forgery(self):
        self.assert_forgery_rejected(
            lambda packet: packet["findings"][0].__setitem__("support_score", 0.123)
        )

    def test_rejects_checksum_correct_negative_zero_score(self):
        def mutate(packet):
            finding = packet["findings"][0]
            finding["citations"] = ["E9999"]
            finding["support_score"] = -0.0
            finding["status"] = "HOLD"
            finding["verification_reason"] = (
                "missing citations: E9999; lexical evidence support 0.00 below 0.16"
            )
            packet["counts"] = {"pass": 0, "hold": 1}

        self.assert_forgery_rejected(mutate)

    def test_rejects_checksum_correct_invalid_severity(self):
        self.assert_forgery_rejected(
            lambda packet: packet["findings"][0].__setitem__("severity", "urgent")
        )

    def test_rejects_checksum_correct_duplicate_citations(self):
        self.assert_forgery_rejected(
            lambda packet: packet["findings"][0].__setitem__(
                "citations", ["E0001", "E0001"]
            )
        )

    def test_rejects_checksum_correct_non_normalized_text(self):
        self.assert_forgery_rejected(
            lambda packet: packet.__setitem__("summary", f" {packet['summary']} ")
        )

    def test_rejects_checksum_correct_nul_in_evidence_line(self):
        def mutate(packet):
            text = packet["evidence"]["lines"][0]["text"] + "\x00"
            packet["evidence"]["lines"][0]["text"] = text
            canonical = (text + "\n").encode("utf-8")
            packet["evidence"]["byte_count"] = len(canonical)
            packet["evidence"]["sha256"] = hashlib.sha256(canonical).hexdigest()

        self.assert_forgery_rejected(mutate)

    def test_rejects_checksum_correct_duplicate_finding_ids(self):
        def mutate(packet):
            second = copy.deepcopy(packet["findings"][0])
            packet["findings"].append(second)
            packet["counts"] = {"pass": 2, "hold": 0}

        self.assert_forgery_rejected(mutate)

    def test_rejects_nonfinite_score_without_raising(self):
        packet = valid_packet()
        packet["findings"][0]["support_score"] = math.inf
        # A non-finite JSON number cannot be emitted by analyze; direct callers
        # must still receive a clean False rather than an exception.
        self.assertFalse(verify_receipt(packet))


if __name__ == "__main__":
    unittest.main()
