import unittest

from proofline.aws_contract import AwsContractError, parse_s3_events


def record(key="inspection%2Fone.png", version="v1", sequencer="001"):
    return {
        "eventSource": "aws:s3",
        "eventName": "ObjectCreated:Put",
        "s3": {
            "bucket": {"name": "proofline-inspection"},
            "object": {"key": key, "versionId": version, "sequencer": sequencer},
        },
    }


class AwsContractTests(unittest.TestCase):
    def test_parse_decode_and_idempotency(self):
        parsed = parse_s3_events({"Records": [record(), record()]})
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0].key, "inspection/one.png")
        self.assertEqual(len(parsed[0].idempotency_key), 64)

    def test_distinct_versions_have_distinct_keys(self):
        parsed = parse_s3_events({"Records": [record(version="v1"), record(version="v2")]})
        self.assertEqual(len(parsed), 2)
        self.assertNotEqual(parsed[0].idempotency_key, parsed[1].idempotency_key)

    def test_non_s3_and_delete_rejected(self):
        bad = record()
        bad["eventSource"] = "aws:sqs"
        with self.assertRaises(AwsContractError):
            parse_s3_events({"Records": [bad]})
        bad2 = record()
        bad2["eventName"] = "ObjectRemoved:Delete"
        with self.assertRaises(AwsContractError):
            parse_s3_events({"Records": [bad2]})


if __name__ == "__main__":
    unittest.main()
