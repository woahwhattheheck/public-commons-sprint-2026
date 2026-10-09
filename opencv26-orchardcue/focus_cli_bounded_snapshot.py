#!/usr/bin/env python3
"""One offline regression for CLI image-size checks, including a stale stat."""
import io
import sys
import tempfile
import types
import unittest
from pathlib import Path

# The image-byte reader has no image/vision dependency; isolate this focused check.
fake_engine = types.ModuleType('engine')
fake_engine.save_review = lambda *args, **kwargs: None
sys.modules['engine'] = fake_engine
from cli import MAX_INPUT_BYTES, _read_image_bounded  # noqa: E402


class ImageReadLimit(unittest.TestCase):
    def test_true_on_disk_boundary(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'sample'
            file.write_bytes(b'x' * MAX_INPUT_BYTES)
            self.assertEqual(len(_read_image_bounded(file)), MAX_INPUT_BYTES)
            with file.open('ab') as stream:
                stream.write(b'y')
            with self.assertRaisesRegex(ValueError, '8,000,000-byte limit'):
                _read_image_bounded(file)

    def test_file_growth_after_a_small_stat(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'growable'
            file.write_bytes(b'x')
            prior_size = file.stat().st_size
            with file.open('ab') as stream:
                stream.write(b'y' * (MAX_INPUT_BYTES + 31))
            self.assertEqual(prior_size, 1)
            with self.assertRaisesRegex(ValueError, '8,000,000-byte limit'):
                _read_image_bounded(file)

    def test_reader_must_request_no_more_than_limit_plus_one(self):
        class GuardedStream(io.BytesIO):
            requested = None

            def read(self, size=-1):
                self.requested = size
                if size != MAX_INPUT_BYTES + 1:
                    raise AssertionError('unbounded read requested')
                return super().read(size)

        class Image:
            def __init__(self, stream):
                self.stream = stream

            def open(self, mode):
                if mode != 'rb':
                    raise AssertionError('unexpected file mode')
                return self.stream

        stream = GuardedStream(b'x' * (MAX_INPUT_BYTES + 100))
        with self.assertRaisesRegex(ValueError, '8,000,000-byte limit'):
            _read_image_bounded(Image(stream))
        self.assertEqual(stream.requested, MAX_INPUT_BYTES + 1)


if __name__ == '__main__':
    unittest.main()
