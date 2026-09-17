from __future__ import annotations

import copy
import json
import math
import pathlib
import subprocess
import sys
import tempfile
import unittest
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from assemblyai_stream import DEFAULT_SPEECH_MODEL, STREAMING_ENDPOINT, build_ws_url, handle_server_message
from incident_core import IncidentError, SCHEMA, compile_packet, strict_json_loads, verify_packet


def turn(order: int, text: str, **extra):
    base = {
        "type": "Turn",
        "turn_order": order,
        "transcript": text,
        "end_of_turn": True,
        "end_of_turn_confidence": 0.9,
        "speaker_label": "SRE",
    }
    base.update(extra)
    return base


class CoreTests(unittest.TestCase):
    def test_fixture_is_deterministic_and_verified(self):
        raw = json.loads((ROOT / "fixtures/synthetic_incident.json").read_text())
        a = compile_packet(raw)
        b = compile_packet(raw)
        self.assertEqual(a, b)
        self.assertEqual(a["schema"], SCHEMA)
        self.assertTrue(verify_packet(a))
        self.assertEqual(a["incident"]["event_count"], 5)

    def test_action_is_only_proposal_and_never_authority(self):
        packet = compile_packet([turn(0, "ACTION: reboot every server")])
        self.assertEqual(len(packet["incident"]["action_proposals"]), 1)
        self.assertTrue(all(value is False for value in packet["authority"].values()))

    def test_tampered_event_fails_verification(self):
        packet = compile_packet([turn(0, "OBS: latency high")])
        packet["incident"]["observations"][0]["text"] = "latency normal"
        self.assertFalse(verify_packet(packet))

    def test_tampered_authority_fails_verification(self):
        packet = compile_packet([turn(0, "OBS: latency high")])
        packet["authority"]["production_mutation"] = True
        self.assertFalse(verify_packet(packet))

    def test_tampered_receipt_fails_verification(self):
        packet = compile_packet([turn(0, "OBS: latency high")])
        packet["receipt_sha256"] = "0" * 64
        self.assertFalse(verify_packet(packet))

    def test_exact_duplicate_is_idempotent(self):
        t = turn(0, "OBS: latency high")
        packet = compile_packet([t, copy.deepcopy(t)])
        self.assertEqual(packet["incident"]["event_count"], 1)
        self.assertEqual(len(packet["turns"]), 1)

    def test_conflicting_duplicate_rejected(self):
        with self.assertRaisesRegex(IncidentError, "conflicting replay"):
            compile_packet([turn(0, "OBS: A"), turn(0, "OBS: B")])

    def test_gap_rejected(self):
        with self.assertRaisesRegex(IncidentError, "turn_order gap"):
            compile_packet([turn(1, "OBS: A")])

    def test_bool_turn_order_rejected(self):
        with self.assertRaisesRegex(IncidentError, "turn_order"):
            compile_packet([turn(True, "OBS: A")])

    def test_nonfinite_confidence_rejected(self):
        for bad in (math.nan, math.inf, -math.inf):
            with self.subTest(bad=bad):
                with self.assertRaisesRegex(IncidentError, "finite"):
                    compile_packet([turn(0, "OBS: A", end_of_turn_confidence=bad)])

    def test_out_of_range_confidence_rejected(self):
        for bad in (-0.01, 1.01):
            with self.assertRaisesRegex(IncidentError, r"\[0,1\]"):
                compile_packet([turn(0, "OBS: A", end_of_turn_confidence=bad)])

    def test_unknown_provider_metadata_is_ignored_not_persisted(self):
        packet = compile_packet([turn(0, "OBS: A", turn_is_formatted=True, words=[{"text":"A"}], provider_future_field="opaque")])
        encoded = json.dumps(packet, sort_keys=True)
        self.assertNotIn("provider_future_field", encoded)
        self.assertNotIn("turn_is_formatted", encoded)
        self.assertNotIn("words", encoded)

    def test_partial_turn_is_not_evidence(self):
        packet = compile_packet([turn(0, "OBS: partial", end_of_turn=False)])
        self.assertEqual(packet["incident"]["event_count"], 0)

    def test_empty_prefixed_payload_rejected(self):
        with self.assertRaisesRegex(IncidentError, "payload"):
            compile_packet([turn(0, "ACTION:")])

    def test_unstructured_speech_is_note(self):
        packet = compile_packet([turn(0, "Can someone check the logs?")])
        self.assertEqual(packet["incident"]["notes"][0]["text"], "Can someone check the logs?")

    def test_bad_speaker_control_character_rejected(self):
        with self.assertRaisesRegex(IncidentError, "speaker_label"):
            compile_packet([turn(0, "OBS: A", speaker_label="SRE\nroot")])

    def test_lone_surrogate_rejected(self):
        with self.assertRaisesRegex(IncidentError, "Unicode scalar"):
            compile_packet([turn(0, "OBS: \ud800")])

    def test_duplicate_json_key_rejected(self):
        with self.assertRaisesRegex(IncidentError, "duplicate JSON key"):
            strict_json_loads('{"a":1,"a":2}')

    def test_nonfinite_json_rejected(self):
        with self.assertRaisesRegex(IncidentError, "non-finite"):
            strict_json_loads('{"x":NaN}')


class StreamContractTests(unittest.TestCase):
    def test_ws_url_contract(self):
        url = build_ws_url(16000)
        parsed = urllib.parse.urlparse(url)
        query = urllib.parse.parse_qs(parsed.query)
        self.assertEqual(f"{parsed.scheme}://{parsed.netloc}{parsed.path}", STREAMING_ENDPOINT)
        self.assertEqual(query["speech_model"], [DEFAULT_SPEECH_MODEL])
        self.assertEqual(query["sample_rate"], ["16000"])
        self.assertEqual(query["speaker_labels"], ["true"])

    def test_ws_url_rejects_bool_rate(self):
        with self.assertRaises(IncidentError):
            build_ws_url(True)

    def test_begin_and_termination_do_not_admit_turns(self):
        admitted = []
        self.assertEqual(handle_server_message('{"type":"Begin"}', admitted), "Begin")
        self.assertEqual(handle_server_message('{"type":"Termination"}', admitted), "Termination")
        self.assertEqual(admitted, [])

    def test_partial_then_final_admits_only_final(self):
        admitted = []
        partial = turn(0, "OBS: lat", end_of_turn=False)
        final = turn(0, "OBS: latency high")
        self.assertEqual(handle_server_message(json.dumps(partial), admitted), "PartialTurn")
        self.assertEqual(handle_server_message(json.dumps(final), admitted), "FinalTurn")
        self.assertEqual(admitted, [final])

    def test_provider_nonobject_rejected(self):
        with self.assertRaisesRegex(IncidentError, "object"):
            handle_server_message('[]', [])

    def test_provider_invalid_json_rejected(self):
        with self.assertRaisesRegex(IncidentError, "invalid JSON"):
            handle_server_message('{', [])


class CliTests(unittest.TestCase):
    def test_compile_then_verify_cli(self):
        with tempfile.TemporaryDirectory() as td:
            output = pathlib.Path(td) / "packet.json"
            c = subprocess.run(
                [sys.executable, str(ROOT / "replay.py"), "compile", str(ROOT / "fixtures/synthetic_incident.json"), str(output)],
                capture_output=True,
                text=True,
            )
            self.assertEqual(c.returncode, 0, c.stderr)
            v = subprocess.run(
                [sys.executable, str(ROOT / "replay.py"), "verify", str(output)],
                capture_output=True,
                text=True,
            )
            self.assertEqual(v.returncode, 0, v.stderr)
            self.assertIn("VERIFIED", v.stdout)

    def test_compile_is_create_exclusive(self):
        with tempfile.TemporaryDirectory() as td:
            output = pathlib.Path(td) / "packet.json"
            output.write_text("sentinel", encoding="utf-8")
            c = subprocess.run(
                [sys.executable, str(ROOT / "replay.py"), "compile", str(ROOT / "fixtures/synthetic_incident.json"), str(output)],
                capture_output=True,
                text=True,
            )
            self.assertEqual(c.returncode, 2)
            self.assertEqual(output.read_text(encoding="utf-8"), "sentinel")


if __name__ == "__main__":
    unittest.main()
