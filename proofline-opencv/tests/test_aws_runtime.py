import copy
import unittest
from unittest import mock

from proofline import aws_runtime
from proofline.codec import digest_json
from proofline.vision import PIPELINE_GENERATION


class Body:
    def __init__(self, raw): self.raw = raw
    def read(self): return self.raw


class FakeS3:
    def __init__(self): self.calls = []
    def get_object(self, **kwargs):
        self.calls.append(kwargs)
        return {"Body": Body(b"image")}


class Conditional(Exception):
    def __init__(self):
        self.response = {"Error": {"Code": "ConditionalCheckFailedException"}}


class FakeTable:
    def __init__(self): self.items = {}
    def get_item(self, **kwargs):
        item = self.items.get(kwargs["Key"]["pk"])
        return {} if item is None else {"Item": copy.deepcopy(item)}
    def put_item(self, **kwargs):
        item = kwargs["Item"]
        if item["pk"] in self.items:
            raise Conditional()
        self.items[item["pk"]] = copy.deepcopy(item)


def event():
    return {"Records": [{"eventSource":"aws:s3","eventName":"ObjectCreated:Put","s3":{"bucket":{"name":"inspection"},"object":{"key":"x.png","versionId":"1","sequencer":"A"}}}]}


def evidence(source_binding=None):
    packet = {
        "schema":"proofline.evidence.v1","pipeline_generation":PIPELINE_GENERATION,"opencv_version":"5.0.0",
        "reference_sha256":"a"*64,"inspection_sha256":"b"*64,"dimensions_wh":[1,1],
        "registration":{"method":"ECC_AFFINE","score":1.0,"inspection_to_reference":[[1,0,0],[0,1,0]]},
        "segmentation":{"method":"ABSDIFF_OTSU_MORPH_CC","threshold":24,"mask_sha256":"c"*64},
        "regions":[],"summary":{"region_count":0,"total_region_area_px":0,"max_region_area_px":0},
        "authority":{"quality_disposition":False,"production_mutation":False,"vendor_contact":False,"purchase_or_payment":False,"external_send":False},
    }
    if source_binding is not None:
        packet["source_binding"] = copy.deepcopy(source_binding)
    packet["receipt_sha256"] = digest_json(packet)
    return packet


def inspect_fake(a, b, **kwargs):
    return evidence(kwargs.get("source_binding"))


class AwsRuntimeTests(unittest.TestCase):
    @mock.patch("proofline.aws_runtime.inspect_pair", side_effect=inspect_fake)
    def test_records_pinned_reference_generation(self, _inspect):
        s3, table = FakeS3(), FakeTable()
        result = aws_runtime.process_event(
            event(), s3=s3, table=table,
            reference_bucket="ref", reference_key="gold.png", reference_version_id="R1",
        )
        self.assertEqual(result["results"][0]["status"], "RECORDED")
        self.assertEqual(len(table.items), 1)
        stored = next(iter(table.items.values()))
        self.assertEqual(stored["reference_version_id"], "R1")
        self.assertEqual(s3.calls[0], {"Bucket":"ref","Key":"gold.png","VersionId":"R1"})
        self.assertEqual(s3.calls[1], {"Bucket":"inspection","Key":"x.png","VersionId":"1"})
        self.assertIn('"reference":{"bucket":"ref","key":"gold.png","provider":"AWS_S3","version_id":"R1"}', stored["evidence_json"])

    @mock.patch("proofline.aws_runtime.inspect_pair", side_effect=inspect_fake)
    def test_duplicate_returns_stored_receipts_without_refetch_or_recompute(self, inspect):
        table = FakeTable()
        first = aws_runtime.process_event(
            event(), s3=FakeS3(), table=table,
            reference_bucket="ref", reference_key="gold.png", reference_version_id="R1",
        )
        second_s3 = FakeS3()
        second = aws_runtime.process_event(
            event(), s3=second_s3, table=table,
            reference_bucket="ref", reference_key="gold.png", reference_version_id="R1",
        )
        self.assertEqual(second["results"][0]["status"], "DUPLICATE_REPLAY")
        self.assertEqual(second["results"][0]["evidence_receipt_sha256"], first["results"][0]["evidence_receipt_sha256"])
        self.assertEqual(second["results"][0]["proposal_receipt_sha256"], first["results"][0]["proposal_receipt_sha256"])
        self.assertEqual(second_s3.calls, [])
        self.assertEqual(inspect.call_count, 1)

    @mock.patch("proofline.aws_runtime.inspect_pair", side_effect=inspect_fake)
    def test_reference_rotation_creates_distinct_bound_ledger_identity(self, _inspect):
        table = FakeTable()
        first = aws_runtime.process_event(
            event(), s3=FakeS3(), table=table,
            reference_bucket="ref", reference_key="gold.png", reference_version_id="R1",
        )
        second = aws_runtime.process_event(
            event(), s3=FakeS3(), table=table,
            reference_bucket="ref", reference_key="gold.png", reference_version_id="R2",
        )
        self.assertNotEqual(first["results"][0]["event_key"], second["results"][0]["event_key"])
        self.assertEqual(len(table.items), 2)

    def test_reference_version_is_required(self):
        with self.assertRaises(aws_runtime.RuntimeErrorProofLine):
            aws_runtime.process_event(
                event(), s3=FakeS3(), table=FakeTable(),
                reference_bucket="ref", reference_key="gold.png", reference_version_id="",
            )

    @mock.patch("proofline.aws_runtime.inspect_pair", return_value=evidence())
    def test_missing_source_binding_from_inspector_fails_closed(self, _inspect):
        with self.assertRaises(aws_runtime.RuntimeErrorProofLine):
            aws_runtime.process_event(
                event(), s3=FakeS3(), table=FakeTable(),
                reference_bucket="ref", reference_key="gold.png", reference_version_id="R1",
            )


if __name__ == "__main__":
    unittest.main()
