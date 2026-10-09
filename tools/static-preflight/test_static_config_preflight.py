"""Three focused contracts. Fixtures are inert bytes, never executable imports."""
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import static_config_preflight as guard


def suspicious_bytes():
    literals = ",".join(f"'{index:08x}'" for index in range(20))
    return ("fixture\n[" + literals + "]" + " " * 2100 + "eval(opaque);spawn(opaque);\n").encode()


class PreflightContracts(unittest.TestCase):
    def test_identity_and_benign_create_require(self):
        benign = b"import { createRequire } from 'module';\nconst require=createRequire(import.meta.url);\n"
        self.assertEqual(guard.inspect_bytes(benign, "config.js")["state"], "NO_MATCH")
        digest = guard.git_blob_sha1(benign)
        with patch.dict(guard.KNOWN_RISK_BLOBS, {digest: "inert-unit-fixture"}):
            result = guard.inspect_bytes(benign, "config.js")
            self.assertEqual(result["state"], "KNOWN_RISK")
            self.assertEqual(result["findings"][0]["reference"], "inert-unit-fixture")

    def test_combined_indicator_and_no_source_disclosure(self):
        result = guard.inspect_bytes(suspicious_bytes(), "fixture.txt")
        self.assertEqual(result["state"], "REVIEW")
        self.assertEqual(result["findings"][0]["line"], 2)
        self.assertEqual(result["findings"][0]["encoded_literal_count"], 20)
        self.assertNotIn("eval(opaque)", json.dumps(result))
        without_dynamic = suspicious_bytes().replace(b"eval(opaque);spawn(opaque);", b"plain data")
        self.assertEqual(guard.inspect_bytes(without_dynamic, "fixture.txt")["state"], "NO_MATCH")

    def test_cli_status_and_non_regular_or_oversized_input(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.txt"
            for content, expected in ((b"export default [];\n", 0), (suspicious_bytes(), 1), (b"\xff", 2)):
                path.write_bytes(content)
                output = io.StringIO()
                with redirect_stdout(output):
                    self.assertEqual(guard.main([str(path)]), expected)
                self.assertEqual(json.loads(output.getvalue())["schema"], 1)
            with self.assertRaises(ValueError):
                guard.inspect_file(directory)
            with self.assertRaises(ValueError):
                guard.inspect_bytes(b"x" * (guard.MAX_BYTES + 1), "large.txt")


if __name__ == "__main__":
    unittest.main()
