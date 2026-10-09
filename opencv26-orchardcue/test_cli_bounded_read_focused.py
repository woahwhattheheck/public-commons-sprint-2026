"""Focused, offline CLI intake check; no OpenCV, network, or field data needed."""
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import importlib.util
import json
import sys
import types
import unittest

# Stub only the engine boundary: this tests the CLI, not image recognition.
engine = types.ModuleType('engine')
engine.save_review = lambda *args, **kwargs: None
with patch.dict(sys.modules, {'engine': engine}):
    spec = importlib.util.spec_from_file_location('orchardcue_cli', Path(__file__).with_name('cli.py'))
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)


class BoundedInputTest(unittest.TestCase):
    def test_byte_limit_is_enforced_at_boundary(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / 'capture.png'
            path.write_bytes(b'a' * cli.MAX_IMAGE_BYTES)
            self.assertEqual(len(cli.read_image_bounded(path)), cli.MAX_IMAGE_BYTES)
            with path.open('ab') as output:
                output.write(b'b')
            with self.assertRaisesRegex(ValueError, '8,000,000-byte limit'):
                cli.read_image_bounded(path)

    def test_one_extra_byte_is_requested_not_unbounded_read(self):
        # Detect accidental regression to Path.read_bytes or read() without a cap.
        class Probe:
            requested = None
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, amount):
                self.requested = amount
                return b'abc'
        probe = Probe()
        with patch.object(Path, 'open', return_value=probe):
            self.assertEqual(cli.read_image_bounded(Path('unused.png')), b'abc')
        self.assertEqual(probe.requested, cli.MAX_IMAGE_BYTES + 1)

    def test_oversized_cli_does_not_run_analysis_or_create_review(self):
        with TemporaryDirectory() as tmp:
            inp = Path(tmp) / 'oversize.png'
            out = Path(tmp) / 'review'
            inp.write_bytes(b'x' * (cli.MAX_IMAGE_BYTES + 1))
            with patch.object(sys, 'argv', ['cli.py', str(inp), '--output', str(out)]), \
                 patch.object(cli, 'save_review') as analyze, redirect_stderr(StringIO()) as errors:
                with self.assertRaises(SystemExit) as result:
                    cli.main()
            self.assertEqual(result.exception.code, 2)
            self.assertIn('8,000,000-byte limit', errors.getvalue())
            analyze.assert_not_called()
            self.assertFalse(out.exists())

    def test_small_input_preserves_cli_report_shape(self):
        with TemporaryDirectory() as tmp:
            inp = Path(tmp) / 'small.png'
            out = Path(tmp) / 'review'
            inp.write_bytes(b'synthetic input')
            def fake_review(raw, folder, marker_side_mm):
                self.assertEqual(raw, b'synthetic input')
                self.assertEqual(marker_side_mm, 75.0)
                folder.mkdir(parents=True)
                return {
                    'decision': {'action': 'HUMAN_REVIEW_REQUIRED', 'reason_codes': ['SCALE_MARKER_MISSING']},
                    'candidate_count': 1, 'ambiguous_regions': 0,
                    'input_sha256': 'abc123',
                }
            with patch.object(sys, 'argv', ['cli.py', str(inp), '--output', str(out), '--marker-mm', '75']), \
                 patch.object(cli, 'save_review', side_effect=fake_review), redirect_stdout(StringIO()) as output:
                cli.main()
            doc = json.loads(output.getvalue())
            self.assertEqual(doc['action'], 'HUMAN_REVIEW_REQUIRED')
            self.assertEqual(doc['red_candidates'], 1)
            self.assertEqual(doc['reasons'], ['SCALE_MARKER_MISSING'])
            self.assertIn('OrchardCue operator review', (out / 'index.html').read_text())


if __name__ == '__main__':
    unittest.main()
