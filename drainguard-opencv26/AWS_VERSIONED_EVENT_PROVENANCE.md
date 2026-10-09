# DrainGuard S3 event version and evidence provenance

This follow-on fixes the delayed-S3-notification race in the original 21-file
integrated source: an ObjectCreated event for version *A* could previously
load the latest version *B* at the same key, then attribute *B* to *A*.

- This deployment enables S3 bucket versioning; therefore input notifications
  must include `s3.object.versionId`. Missing/null/unreasonable versions reject
  rather than guessing which capture was assessed.
- A capture read sends `VersionId` to `get_object` and requires the same
  returned `VersionId`. An event ETag, when supplied, must match the pinned
  object. Baseline and slot config are read as the actual current bytes and
  SHA-256 hashed so their exact versions remain identifiable in the report.
- `assessment_id` binds bucket + key + capture version + SHA256 of all three
  read inputs + a pipeline binding schema; multipart or SSE ETags are **not**
  treated as cryptographic hashes. Exact event replay yields the same ID and
  event versions remain distinct, including a post-overwrite delayed event.
- Reports and review queue continue to require human review; no automated
  road maintenance action is authorized. The SAM template grants
  `s3:GetObjectVersion` narrowly to `captures/*`, separately from the
  existing `s3:GetObject` scope.

**Proof scope:** `PYTHONPATH=. python test/test_s3_version_receipt.py`, one offline
version overwrite/replay regression with synthetic OpenCV imagery and faked AWS
clients. This is NOT an AWS deployment, official OpenCV 5 runtime, or contest
submission. Retain the integrated-source original alongside this derivative.
