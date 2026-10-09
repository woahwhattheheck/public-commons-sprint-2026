"""Focused object-ingress checks; no AWS service or OpenCV execution."""
import importlib.util
import io
from pathlib import Path
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "proofline" / "s3_input.py"
SPEC = importlib.util.spec_from_file_location("proofline_s3_input", SOURCE)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
read_image_object = module.read_image_object
S3ImageInputError = module.S3ImageInputError


class Body(io.BytesIO):
    def __init__(self, payload, *, short_reads=False, failure=None, close_failure=False):
        super().__init__(payload)
        self.calls = []
        self.close_count = 0
        self.short_reads = short_reads
        self.failure = failure
        self.close_failure = close_failure
        self.consumed = 0

    def read(self, size=-1):
        self.calls.append(size)
        if self.failure:
            raise self.failure
        chunk = super().read(min(size, 3) if self.short_reads else size)
        self.consumed += len(chunk)
        return chunk

    def close(self):
        self.close_count += 1
        super().close()
        if self.close_failure:
            raise OSError("cleanup failed")


class S3:
    def __init__(self, body, **metadata):
        self.response = {"Body": body, **metadata}
        self.calls = []

    def get_object(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


class S3InputTests(unittest.TestCase):
    def test_exact_limit_partial_reads_and_pinned_generation(self):
        payload = b"0123456789abcdef"
        body = Body(payload, short_reads=True)
        s3 = S3(body, ContentLength=len(payload))
        self.assertEqual(read_image_object(s3, "bucket", "a b.png", "version-7", max_bytes=16), payload)
        self.assertEqual(s3.calls, [{"Bucket": "bucket", "Key": "a b.png", "VersionId": "version-7"}])
        self.assertTrue(all(0 < n <= 17 for n in body.calls))
        self.assertEqual(body.consumed, 16)
        self.assertEqual(body.close_count, 1)
        self.assertTrue(body.closed)

    def test_oversize_is_bounded_even_without_usable_size_metadata(self):
        for metadata, expected_read in (({"ContentLength": 1_000_000}, 0), ({}, 17), ({"ContentLength": 16}, 17)):
            with self.subTest(metadata=metadata):
                body = Body(b"x" * 100)
                with self.assertRaisesRegex(S3ImageInputError, "byte limit"):
                    read_image_object(S3(body, **metadata), "bucket", "key", max_bytes=16)
                self.assertEqual(body.consumed, expected_read)
                self.assertEqual(body.close_count, 1)
                self.assertTrue(body.closed)

    def test_failures_close_without_converting_bad_input_to_a_result(self):
        cases = [
            (Body(b"abc"), {"ContentLength": 4}, "ContentLength"),
            (Body(b"abc"), {"ContentLength": True}, "ContentLength"),
            (Body(b""), {}, "empty"),
        ]
        for body, metadata, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(S3ImageInputError, message):
                    read_image_object(S3(body, **metadata), "bucket", "key", max_bytes=16)
                self.assertEqual(body.close_count, 1)
                self.assertTrue(body.closed)
        original = TimeoutError("read deadline")
        body = Body(b"abc", failure=original, close_failure=True)
        with self.assertRaises(TimeoutError) as caught:
            read_image_object(S3(body), "bucket", "key", max_bytes=16)
        self.assertIs(caught.exception, original)
        self.assertEqual(body.close_count, 1)
        self.assertTrue(body.closed)


if __name__ == "__main__":
    unittest.main()
