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
    def __init__(self, duplicate=False): self.items=[]; self.duplicate=duplicate
    def put_item(self, **kwargs):
        if self.duplicate: raise Conditional()
        self.items.append(kwargs)


def event():
    return {"Records": [{"eventSource":"aws:s3","eventName":"ObjectCreated:Put","s3":{"bucket":{"name":"inspection"},"object":{"key":"x.png","versionId":"1","sequencer":"A"}}}]}


def evidence():
    packet = {
        "schema":"proofline.evidence.v1","pipeline_generation":PIPELINE_GENERATION,"opencv_version":"5.0.0",
        "reference_sha256":"a"*64,"inspection_sha256":"b"*64,"dimensions_wh":[1,1],
        "registration":{"method":"ECC_AFFINE","score":1.0,"inspection_to_reference":[[1,0,0],[0,1,0]]},
        "segmentation":{"method":"ABSDIFF_OTSU_MORPH_CC","threshold":24,"mask_sha256":"c"*64},
        "regions":[],"summary":{"region_count":0,"total_region_area_px":0,"max_region_area_px":0},
        "authority":{"quality_disposition":False,"production_mutation":False,"vendor_contact":False,"purchase_or_payment":False,"external_send":False},
    }
    packet["receipt_sha256"] = digest_json(packet)
    return packet


class AwsRuntimeTests(unittest.TestCase):
    @mock.patch("proofline.aws_runtime.inspect_pair", side_effect=lambda a,b: evidence())
    def test_records_idempotent_ledger_item(self, _inspect):
        s3, table = FakeS3(), FakeTable()
        result = aws_runtime.process_event(event(), s3=s3, table=table, reference_bucket="ref", reference_key="gold.png")
        self.assertEqual(result["results"][0]["status"], "RECORDED")
        self.assertEqual(len(table.items), 1)
        kwargs = table.items[0]
        self.assertEqual(kwargs["ConditionExpression"], "attribute_not_exists(pk)")
        self.assertIn("evidence_json", kwargs["Item"])
        self.assertEqual(s3.calls[0]["Bucket"], "ref")

    @mock.patch("proofline.aws_runtime.inspect_pair", side_effect=lambda a,b: evidence())
    def test_duplicate_is_not_reprocessed_as_successful_insert(self, _inspect):
        result = aws_runtime.process_event(event(), s3=FakeS3(), table=FakeTable(duplicate=True), reference_bucket="ref", reference_key="gold.png")
        self.assertEqual(result["results"][0]["status"], "DUPLICATE_IGNORED")


if __name__ == "__main__":
    unittest.main()
