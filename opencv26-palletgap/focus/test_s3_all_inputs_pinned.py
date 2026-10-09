"""Focused offline schema-2 immutable-input S3 source/receipt checks."""
import hashlib
import json
import unittest
from focus import test_s3_snapshot as legacy


def versioned_fixture():
    objects = legacy.fixture(frame=b"old first frame")
    config = json.loads(objects[legacy.CONFIG_KEY])
    config["reference_version_id"] = "v-reference-1"
    objects[legacy.CONFIG_KEY] = json.dumps(config, sort_keys=True).encode()
    manifest = json.loads(objects[legacy.MANIFEST_KEY])
    manifest.update({"schema": 2, "camera_version_id": "v-config-1", "first_version_id": "v-frame-1"})
    objects[legacy.MANIFEST_KEY] = json.dumps(manifest, sort_keys=True).encode()
    versions = {
        (legacy.MANIFEST_KEY, "v-manifest-1"): objects[legacy.MANIFEST_KEY],
        (legacy.CONFIG_KEY, "v-config-1"): objects[legacy.CONFIG_KEY],
        (legacy.FIRST_KEY, "v-frame-1"): objects[legacy.FIRST_KEY],
        (legacy.REFERENCE_KEY, "v-reference-1"): objects[legacy.REFERENCE_KEY],
    }
    event = legacy.event(versionId="v-manifest-1", eTag=legacy.md5_etag(objects[legacy.MANIFEST_KEY]))
    return objects, versions, event


class AllInputsVersionPinned(unittest.TestCase):
    def test_event_replay_remains_identical_when_every_current_object_changes(self):
        original, versions, event = versioned_fixture()
        latest = {key: b"replaced current " + key.encode() for key in original}
        s3 = legacy.FakeS3(latest, versions=versions)
        first, db, queue = legacy.execute(s3, event)
        self.assertEqual(first["status"], "PROCESSED")
        self.assertEqual(first["evidence_versions"], {
            "manifest": "v-manifest-1", "config": "v-config-1",
            "reference": "v-reference-1", "first": "v-frame-1", "second": None})
        self.assertEqual(first["evidence_sha256"]["first"], hashlib.sha256(original[legacy.FIRST_KEY]).hexdigest())
        self.assertEqual([entry[1] for entry in s3.calls],
                         ["v-manifest-1", "v-config-1", "v-frame-1", "v-reference-1"])
        second, _, _ = legacy.execute(legacy.FakeS3(original, versions=versions), event)
        self.assertEqual(first["inspection_id"], second["inspection_id"])
        self.assertEqual(json.loads(queue.messages[0]["MessageBody"])["evidence_versions"],
                         db.items[0]["evidence_versions"])

    def test_rejects_unversioned_or_missing_referenced_snapshot(self):
        source, versions, event = versioned_fixture()
        failures = [
            ("manifest-event", source, legacy.event(eTag=legacy.md5_etag(source[legacy.MANIFEST_KEY])), "versioned request manifest"),
            ("missing-config", {**source, legacy.MANIFEST_KEY: json.dumps({"schema": 2, "site": "site", "camera_key": legacy.CONFIG_KEY, "first_key": legacy.FIRST_KEY, "first_version_id": "v-frame-1"}).encode()}, event, "camera_version_id"),
            ("missing-first", {**source, legacy.MANIFEST_KEY: json.dumps({"schema": 2, "site": "site", "camera_key": legacy.CONFIG_KEY, "first_key": legacy.FIRST_KEY, "camera_version_id": "v-config-1"}).encode()}, event, "first_version_id"),
        ]
        # Versioned manifest event always returns manifest from versions; for row
        # variations, rebind the same manifest version to the intended bytes.
        for name, modified, notice, expected in failures:
            with self.subTest(name=name):
                v = dict(versions)
                v[(legacy.MANIFEST_KEY, "v-manifest-1")] = modified[legacy.MANIFEST_KEY]
                e = notice if name == "manifest-event" else legacy.event(versionId="v-manifest-1", eTag=legacy.md5_etag(modified[legacy.MANIFEST_KEY]))
                with self.assertRaisesRegex(ValueError, expected):
                    legacy.execute(legacy.FakeS3(modified, versions=v), e)
        # Config version read succeeds, but the reference's source version is absent.
        bad = dict(source)
        config = json.loads(source[legacy.CONFIG_KEY]); config.pop("reference_version_id")
        bad[legacy.CONFIG_KEY] = json.dumps(config).encode()
        altered = dict(versions); altered[(legacy.CONFIG_KEY, "v-config-1")] = bad[legacy.CONFIG_KEY]
        with self.assertRaisesRegex(ValueError, "reference_version_id"):
            legacy.execute(legacy.FakeS3(bad, versions=altered), event)

    def test_mismatched_returned_object_version_fails_closed(self):
        source, versions, event = versioned_fixture()
        class WrongVersion(legacy.FakeS3):
            def get_object(self, **kwargs):
                response = super().get_object(**kwargs)
                if kwargs.get("Key") == legacy.FIRST_KEY:
                    response["VersionId"] = "v-wrong"
                return response
        with self.assertRaisesRegex(ValueError, "version does not match"):
            legacy.execute(WrongVersion(source, versions=versions), event)

    def test_new_version_with_same_bytes_gets_new_identity(self):
        source, versions, event = versioned_fixture()
        first, _, _ = legacy.execute(legacy.FakeS3(source, versions=versions), event)
        change_manifest = json.loads(source[legacy.MANIFEST_KEY]); change_manifest["first_version_id"] = "v-frame-2"
        changed = json.dumps(change_manifest, sort_keys=True).encode()
        other_versions = dict(versions)
        other_versions[(legacy.MANIFEST_KEY, "v-manifest-2")] = changed
        other_versions[(legacy.FIRST_KEY, "v-frame-2")] = source[legacy.FIRST_KEY]
        later, _, _ = legacy.execute(legacy.FakeS3(source, versions=other_versions),
                legacy.event(versionId="v-manifest-2", eTag=legacy.md5_etag(changed)))
        self.assertEqual(first["evidence_sha256"]["first"], later["evidence_sha256"]["first"])
        self.assertNotEqual(first["inspection_id"], later["inspection_id"])


if __name__ == "__main__":
    unittest.main()
