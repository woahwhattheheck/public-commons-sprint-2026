"""Focused offline lifecycle checks; no socket, credentials, or provider spend."""
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import assemblyai_stream as adapter
from incident_core import IncidentError, verify_packet


class Clock:
    now = 0.0

    def monotonic(self):
        return self.now


class Socket:
    def __init__(self, clock, *, complete=True, problem=None):
        self.clock, self.complete = clock, complete
        self.timeout, self.closed = 30, False
        self.events = [(0.0, '{"type":"Begin"}')]
        if problem is not None:
            self.events.append((0.01, problem))
        self.audio, self.commands = [], []

    def settimeout(self, timeout):
        self.timeout = timeout

    def send_binary(self, chunk):
        self.audio.append((self.clock.now, self.timeout, chunk))

    def send(self, command):
        self.commands.append((self.clock.now, self.timeout, command))
        if self.complete:
            self.events += [
                (self.clock.now + 0.02, json.dumps({
                    "type": "Turn", "turn_order": 0, "end_of_turn": True,
                    "transcript": "OBS: queue recovered", "end_of_turn_confidence": 0.99,
                })),
                (self.clock.now + 0.03, '{"type":"Termination"}'),
            ]

    def recv(self):
        if self.events and self.events[0][0] <= self.clock.now + self.timeout:
            when, message = self.events.pop(0)
            self.clock.now = max(self.clock.now, when)
            return message
        self.clock.now += self.timeout
        raise TimeoutError()

    def close(self):
        self.closed = True


def write_wav(path, frames):
    with wave.open(str(path), "wb") as wav:
        wav.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        wav.writeframes(frames)


class StreamLifecycleTests(unittest.TestCase):
    def run_stream(self, path, output, socket):
        module = types.SimpleNamespace(
            create_connection=lambda *args, **kwargs: socket,
            WebSocketTimeoutException=TimeoutError,
        )
        with patch.dict(sys.modules, {"websocket": module}), \
                patch.object(adapter.time, "monotonic", socket.clock.monotonic):
            adapter.stream_wav(path, output, "offline-placeholder")

    def test_paces_original_audio_and_restores_send_timeout(self):
        with tempfile.TemporaryDirectory() as directory:
            path, output = Path(directory) / "in.wav", Path(directory) / "out.json"
            pcm = bytes(range(256)) * 26  # 3328 frames; the 8ms tail must be merged.
            write_wav(path, pcm)
            socket = Socket(Clock())
            self.run_stream(path, output, socket)
            self.assertEqual(b"".join(entry[2] for entry in socket.audio), pcm)
            for index, (when, timeout, chunk) in enumerate(socket.audio):
                duration = len(chunk) / 32000
                self.assertGreaterEqual(duration, 0.05)
                self.assertLessEqual(duration, 1)
                self.assertEqual(timeout, 30)
                if index:
                    prior = socket.audio[index - 1]
                    self.assertGreaterEqual(when + 1e-9, prior[0] + len(prior[2]) / 32000)
            self.assertGreaterEqual(socket.commands[0][0], len(pcm) / 32000)
            self.assertEqual(socket.commands[0][1], 30)
            self.assertEqual(len(socket.commands), 1)
            self.assertTrue(socket.closed)
            packet = json.loads(output.read_text())
            self.assertTrue(verify_packet(packet))
            self.assertEqual(packet["incident"]["event_count"], 1)

    def test_incomplete_sessions_preserve_existing_output_and_close(self):
        for problem in (None, "", '{"error":"sensitive provider detail"}',
                        '{"type":"Termination"}', '{"type":"Begin","type":"Turn"}'):
            with self.subTest(problem=problem), tempfile.TemporaryDirectory() as directory:
                path, output = Path(directory) / "in.wav", Path(directory) / "out.json"
                write_wav(path, b"\0\0" * 3200)
                output.write_text("previous completed packet")
                socket = Socket(Clock(), complete=False, problem=problem)
                with self.assertRaises(IncidentError) as caught:
                    self.run_stream(path, output, socket)
                self.assertNotIn("sensitive provider detail", str(caught.exception))
                self.assertEqual(output.read_text(), "previous completed packet")
                self.assertEqual(len(socket.commands), 1)
                self.assertTrue(socket.closed)
                self.assertLessEqual(socket.clock.now, 10.2 + 1e-9)
                self.assertEqual(list(Path(directory).glob("*.tmp")), [])

    def test_short_and_truncated_wavs_do_not_become_complete_packets(self):
        with tempfile.TemporaryDirectory() as directory:
            path, output = Path(directory) / "in.wav", Path(directory) / "out.json"
            write_wav(path, b"\0\0" * 799)
            socket = Socket(Clock())
            with self.assertRaisesRegex(IncidentError, "50ms"):
                self.run_stream(path, output, socket)
            self.assertFalse(socket.audio)
            self.assertFalse(output.exists())
            write_wav(path, b"\0\0" * 3200)
            path.write_bytes(path.read_bytes()[:-2])
            with self.assertRaisesRegex(IncidentError, "truncated"):
                self.run_stream(path, output, socket)
            self.assertFalse(output.exists())
            self.assertTrue(socket.closed)


if __name__ == "__main__":
    unittest.main()
