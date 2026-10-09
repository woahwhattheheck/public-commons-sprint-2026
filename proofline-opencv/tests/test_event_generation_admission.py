"""Exact S3 notification parsing must not downgrade to latest-object reads."""
import unittest
from urllib.parse import quote_plus

from proofline.aws_contract import AwsContractError, parse_s3_events


def record(*, key="inspection%2Fone.png", version="v1", seq="001"):
    body = {"key": key, "sequencer": seq}
    if version is not ...:
        body["versionId"] = version
    return {"eventSource": "aws:s3", "eventName": "ObjectCreated:Put",
            "s3": {"bucket": {"name": "proofline-inspection"}, "object": body}}


class ExactVersionAdmissionTests(unittest.TestCase):
    def test_requires_immutable_inspection_generation(self):
        for version in (..., None, "", " ", "null"):
            with self.subTest(version=repr(version)):
                with self.assertRaisesRegex(AwsContractError, "non-null versionId"):
                    parse_s3_events({"Records": [record(version=version)]})

    def test_reference_null_generation_is_not_immutable(self):
        event = parse_s3_events({"Records": [record()]})[0]
        with self.assertRaisesRegex(AwsContractError, "immutable S3 version"):
            event.bound_idempotency_key(reference_bucket="ref", reference_key="gold.png",
                                        reference_version_id="null")

    def test_invalid_key_decoding_never_replaces_bytes_silently(self):
        for key in ("bad%FF.png", "bad%E2%28%A1.png", "bad%ZZ.png", "bad%.png", "%00.png"):
            with self.subTest(key=key):
                with self.assertRaises(AwsContractError):
                    parse_s3_events({"Records": [record(key=key)]})

    def test_good_urlencoded_key_version_and_dedupe_unchanged(self):
        original = "folder/red+flower 🧰.png"
        escaped = quote_plus(original)
        version = "3sL4kqtJ+rmSpXd3dIbrHY+MTRCxf3v="
        parsed = parse_s3_events({"Records": [record(key=escaped, version=version),
                                               record(key=escaped, version=version)]})
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0].key, original)
        self.assertEqual(parsed[0].version_id, version)
        self.assertEqual(len(parsed[0].idempotency_key), 64)
        other = parse_s3_events({"Records": [record(key=escaped, version="v2")]})[0]
        self.assertNotEqual(parsed[0].idempotency_key, other.idempotency_key)

    def test_version_byte_bound_from_s3_contract(self):
        self.assertEqual(parse_s3_events({"Records": [record(version="v" * 1024)]})[0].version_id,
                         "v" * 1024)
        with self.assertRaisesRegex(AwsContractError, "versionId exceeds byte limit"):
            parse_s3_events({"Records": [record(version="v" * 1025)]})
        with self.assertRaisesRegex(AwsContractError, "versionId must be valid UTF-8"):
            parse_s3_events({"Records": [record(version="\ud800")]})

    def test_event_batch_is_transactionally_rejected_on_bad_generation(self):
        # Parser returns no partial success when a later record cannot pin its data.
        with self.assertRaisesRegex(AwsContractError, "non-null versionId"):
            parse_s3_events({"Records": [record(version="v1"), record(version="null", seq="002")]})


if __name__ == "__main__":
    unittest.main()
