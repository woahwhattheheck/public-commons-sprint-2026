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
          +---- consistent DynamoDB GetItem
          |        -> validate source/generation + external HMAC record seal
          |        -> idempotent replay only after authentication
          |
          +---- version-pinned S3 GetObject
          |
          +---- VisualLedger perception/decision
          |
          +---- conditional DynamoDB PutItem
```

The pure handler receives I/O functions, which lets tests prove the exact event/idempotency/decision contract without credentials. The production wrapper uses boto3 only inside `lambda_handler`.

### Retained-record authenticity

Cross-object duplicate routing and idempotent replay consume retained Dynamo evidence only after the exact current schema/generation, source-derived scope/event identity, deterministic trace/record receipts, and an HMAC-SHA256 record seal verify. The HMAC key is deployment-held through `VISUALLEDGER_RECORD_HMAC_KEY` and is not stored inside the record, so rewriting the trace and recomputing its unkeyed receipts cannot remint trusted retained evidence.

## Security / responsibility

- S3 object version is mandatory; unversioned evidence is rejected.
- Object key traversal forms are rejected.
- Inputs are bounded by bytes and pixels.
- Trace and record hashes provide deterministic integrity receipts; retained AWS records additionally require a deployment-held HMAC seal before replay/fingerprint authority. This authenticates the service record generation, not an external issuer/vendor.
- No autonomous financial disposition exists.
- No external communications or funds movement exist in the vision carrier.
