# VisualLedger architecture

## Perception -> decision -> action

```text
versioned image bytes
      |
      v
OpenCV vision pipeline
  decode -> boundary contours -> perspective warp
  -> blur / contrast / glare / edges / Hough text structure
  -> dHash duplicate fingerprint
      |
      v
receipt-bound measurements
      |
      v
bounded decision router
  duplicate? ---------> QUARANTINE_DUPLICATE_REVIEW
  quality failure? ---> REQUEST_RECAPTURE
  geometry ambiguous? -> REQUEST_HUMAN_CROP
  sparse structure? --> REQUEST_HUMAN_CROP
  otherwise ----------> REQUEST_FIELD_EXTRACTION
      |
      v
human review remains required
```

The trace binds source SHA-256, normalized PNG SHA-256, exact OpenCV version, policy thresholds, perception measurements, decision/reasons, and hard-false authority fields. Verification recomputes the complete trace from the original bytes and compares canonical JSON.

## AWS blueprint

```text
S3 (versioning on)
  ObjectCreated event + VersionId
          |
          v
Lambda container (OpenCV 5)
  event-id = SHA256(bucket,key,version,eTag,pipeline-generation)
          |
          +---- consistent DynamoDB GetItem -> idempotent replay
          |
          +---- version-pinned S3 GetObject
          |
          +---- VisualLedger perception/decision
          |
          +---- conditional DynamoDB PutItem
```

The pure handler receives I/O functions, which lets tests prove the exact event/idempotency/decision contract without credentials. The production wrapper uses boto3 only inside `lambda_handler`.

### Known AWS gap before final submission

The included wrapper currently supplies an empty prior-fingerprint set. Before claiming duplicate detection on deployed AWS, add a bounded DynamoDB scope index/query that supplies recent retained fingerprints to `load_prior_fingerprints(scope)` and prove it with deployment evidence. Until then, AWS can claim quality/geometry routing and event idempotency, not cross-object duplicate detection.

## Security / responsibility

- S3 object version is mandatory; unversioned evidence is rejected.
- Object key traversal forms are rejected.
- Inputs are bounded by bytes and pixels.
- Trace and record hashes detect accidental/malicious rewriting but do not authenticate the original issuer/vendor.
- No autonomous financial disposition exists.
- No external communications or funds movement exist in the vision carrier.
