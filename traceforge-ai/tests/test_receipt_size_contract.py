from __future__ import annotations

import io
import json
import tempfile
import threading
import unittest
import urllib.request
from contextlib import redirect_stderr, redirect_stdout
from http.server import ThreadingHTTPServer
from pathlib import Path

from traceforge.cli import main as cli_main
from traceforge.core import TraceForgeError
from traceforge.receipt_io import MAX_RECEIPT_BYTES, render_analysis_packet
from traceforge.server import Handler


class ReceiptSizeContractTests(unittest.TestCase):
    def test_cli_max_control_expansion_round_trips_through_both_verifiers(self):
        hostile = "\x01" * 255_999 + "\n"
        with tempfile.TemporaryDirectory() as td:
            source = Path(td) / "hostile.txt"
            receipt = Path(td) / "receipt.json"
            source.write_text(hostile, encoding="utf-8")

            stdout = io.StringIO()
            stderr = io.StringIO()
            with redirect_stdout(stdout), redirect_stderr(stderr):
                self.assertEqual(
                    cli_main(["analyze", str(source), "--mode", "demo", "--json-out", str(receipt)]),
                    0,
                )
            self.assertEqual(stderr.getvalue(), "")
            raw = receipt.read_bytes()
            self.assertGreater(len(raw), 1_000_000)
            self.assertLessEqual(len(raw), MAX_RECEIPT_BYTES)

            stdout = io.StringIO()
            stderr = io.StringIO()
            with redirect_stdout(stdout), redirect_stderr(stderr):
                self.assertEqual(cli_main(["verify", str(receipt)]), 0)
            self.assertEqual(stderr.getvalue(), "")
            self.assertEqual(json.loads(stdout.getvalue()), {"valid": True})

            server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                req = urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}/api/verify",
                    data=raw,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=5) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(json.loads(response.read()), {"valid": True})
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_renderer_fails_before_emitting_packet_above_verifier_ceiling(self):
        packet = {"payload": "\x01" * (MAX_RECEIPT_BYTES // 6 + 1)}
        with self.assertRaisesRegex(TraceForgeError, "exceeds verifier ceiling"):
            render_analysis_packet(packet)


if __name__ == "__main__":
    unittest.main()
