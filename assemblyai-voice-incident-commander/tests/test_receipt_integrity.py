"""Focused regressions for content-addressed packet validation."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from incident_core import IncidentError, compile_packet, project_final_turn, verify_packet


def final_turn(**overrides):
    return {"type": "Turn", "end_of_turn": True, "turn_order": 0,
            "transcript": "OBS: elevated error rate", **overrides}


class ReceiptIntegrityTests(unittest.TestCase):
    def test_valid_packet_roundtrip_and_identical_replay(self):
        turn = final_turn(speaker_label="Operator A")
        packet = compile_packet([turn, turn])
        self.assertEqual(packet["incident"]["event_count"], 1)
        self.assertTrue(verify_packet(json.loads(json.dumps(packet))))

    def test_numeric_aliases_do_not_preserve_receipt(self):
        packet = compile_packet([final_turn()])
        # Python equality equates each pair; canonical JSON does not.
        for group, key, alias in (
            ("authority", "payment_received", 0),
            ("source_contract", "live_provider_execution_verified", 0),
            ("incident", "event_count", True),
        ):
            with self.subTest(group=group, key=key):
                altered = deepcopy(packet)
                altered[group][key] = alias
                self.assertFalse(verify_packet(altered))
        altered = deepcopy(packet)
        altered["turns"][0]["end_of_turn_confidence"] = 1
        self.assertFalse(verify_packet(altered))

    def test_oversized_confidence_is_controlled_and_invalid_packet_rejected(self):
        with self.assertRaises(IncidentError):
            project_final_turn(final_turn(end_of_turn_confidence=10 ** 400))
        packet = compile_packet([final_turn()])
        packet["turns"][0]["end_of_turn_confidence"] = 10 ** 400
        self.assertFalse(verify_packet(packet))

    def test_lone_surrogate_speaker_is_controlled_and_invalid_packet_rejected(self):
        with self.assertRaises(IncidentError):
            project_final_turn(final_turn(speaker_label="\ud800"))
        packet = compile_packet([final_turn()])
        packet["turns"][0]["speaker_label"] = "\ud800"
        self.assertFalse(verify_packet(packet))


if __name__ == "__main__":
    unittest.main()
