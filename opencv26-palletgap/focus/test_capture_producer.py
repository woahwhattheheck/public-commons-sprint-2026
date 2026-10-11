from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest

from palletgap.capture import CapturePublisher


class FakeS3:
    def __init__(self, fail_key=None, omit_version_key=None):
        self.fail_key = fail_key
        self.omit_version_key = omit_version_key
        self.objects = {}
        self.order = []

    def put_object(self, **request):
        key = request["Key"]
        self.order.append(key)
        if key == self.fail_key:
            raise RuntimeError("injected upload failure")
        if key in self.objects:
            raise RuntimeError("precondition failed")
        version = f"v-{len(self.order)}"
        self.objects[key] = {
            "raw": bytes(request["Body"]),
            "version": version,
            "metadata": request["Metadata"],
        }
        return {} if key == self.omit_version_key else {"VersionId": version}

    def get_object(self, **request):
        value = self.objects[request["Key"]]
        if request["VersionId"] != value["version"]:
            raise RuntimeError("version mismatch")
        return {
            "VersionId": value["version"],
            "Metadata": value["metadata"],
            "Body": io.BytesIO(value["raw"]),
        }


class CaptureProducerTest(unittest.TestCase):
    def inputs(self, root: Path):
        paths = {}
        payloads = {
            "camera.json": json.dumps({"aisle_polygon": [[1, 1], [10, 1], [10, 10]]}).encode(),
            "reference.png": b"reference-exact-bytes",
            "first.jpg": b"first-exact-bytes",
            "second.jpeg": b"second-exact-bytes",
        }
        for name, raw in payloads.items():
            path = root / name
            path.write_bytes(raw)
            paths[name] = path
        return paths, payloads

    def test_manifest_is_last_and_binds_verified_versions_and_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            paths, payloads = self.inputs(Path(directory))
            s3 = FakeS3()
            receipt = CapturePublisher(s3, "bucket").publish(
                site="site-a", capture_id="capture-7", camera_id="cam-2",
                camera_config=paths["camera.json"], reference=paths["reference.png"],
                first=paths["first.jpg"], second=paths["second.jpeg"],
            )
        self.assertEqual(s3.order[-1], "requests/site-a/capture-7.json")
        self.assertEqual(s3.order[:-1], [
            "frames/site-a/capture-7-reference.png",
            "frames/site-a/capture-7-first.jpg",
            "frames/site-a/capture-7-second.jpeg",
            "config/site-a/cam-2.json",
        ])
        manifest = json.loads(s3.objects[s3.order[-1]]["raw"])
        self.assertEqual(manifest["schema"], 2)
        self.assertEqual(manifest["first_version_id"], "v-2")
        self.assertEqual(manifest["second_version_id"], "v-3")
        config = json.loads(s3.objects[manifest["camera_key"]]["raw"])
        self.assertEqual(config["reference_version_id"], "v-1")
        self.assertEqual(
            receipt["inputs"]["first"]["sha256"],
            hashlib.sha256(payloads["first.jpg"]).hexdigest(),
        )

    def test_failed_input_upload_never_publishes_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            paths, _ = self.inputs(Path(directory))
            s3 = FakeS3(fail_key="frames/site-a/capture-7-first.jpg")
            with self.assertRaises(RuntimeError):
                CapturePublisher(s3, "bucket").publish(
                    site="site-a", capture_id="capture-7", camera_id="cam-2",
                    camera_config=paths["camera.json"], reference=paths["reference.png"],
                    first=paths["first.jpg"],
                )
        self.assertFalse(any(key.startswith("requests/") for key in s3.order))

    def test_missing_s3_version_fails_closed_before_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            paths, _ = self.inputs(Path(directory))
            s3 = FakeS3(omit_version_key="frames/site-a/capture-7-reference.png")
            with self.assertRaisesRegex(ValueError, "real VersionId"):
                CapturePublisher(s3, "bucket").publish(
                    site="site-a", capture_id="capture-7", camera_id="cam-2",
                    camera_config=paths["camera.json"], reference=paths["reference.png"],
                    first=paths["first.jpg"],
                )
        self.assertFalse(any(key.startswith("requests/") for key in s3.order))


if __name__ == "__main__":
    unittest.main()
