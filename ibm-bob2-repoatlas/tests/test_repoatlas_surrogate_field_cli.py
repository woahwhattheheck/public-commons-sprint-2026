from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).parents[1]


def fixture():
    return json.loads((ROOT / "fixtures" / "synthetic-repo.json").read_text())


class SurrogateFieldCliTests(unittest.TestCase):
    def test_escaped_surrogate_field_name_fails_closed_without_traceback(self):
        raw = fixture()
        # Keep root field count at the strict-schema maximum so this reaches the
        # UTF-8 field-name fence instead of the cardinality fence.
        raw.pop("runbooks")
        raw["\ud800"] = []
        payload = json.dumps(raw, ensure_ascii=True, separators=(",", ":")).encode("ascii")

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = root / "input.json"
            packet = root / "packet.json"
            receipt = root / "receipt.json"
            source.write_bytes(payload)

            command = [sys.executable]
            if sys.flags.optimize:
                command.append("-O")
            command.extend(
                [
                    "-m",
                    "repoatlas.cli",
                    "compile",
                    "--input",
                    str(source),
                    "--packet",
                    str(packet),
                    "--receipt",
                    str(receipt),
                ]
            )
            env = dict(os.environ)
            env["PYTHONIOENCODING"] = "utf-8:strict"
            completed = subprocess.run(
                command,
                cwd=ROOT,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=20,
                check=False,
            )

            self.assertEqual(
                completed.returncode,
                2,
                msg=(
                    f"stdout={completed.stdout!r}\n"
                    f"stderr={completed.stderr!r}"
                ),
            )
            self.assertIn(b"ERROR:root:field_name", completed.stdout)
            self.assertNotIn(b"Traceback", completed.stdout)
            self.assertNotIn(b"Traceback", completed.stderr)
            self.assertFalse(packet.exists())
            self.assertFalse(receipt.exists())


if __name__ == "__main__":
    unittest.main()
