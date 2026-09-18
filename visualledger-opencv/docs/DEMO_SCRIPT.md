# Five-minute demo script

1. **Problem (30s)** — finance teams receive receipts/invoices with blur, glare, multi-document captures, and duplicate submissions; poor evidence should alter workflow before extraction/accounting.
2. **Clear case (45s)** — show a clear synthetic invoice. Display OpenCV boundary/quality/structure measurements and resulting `REQUEST_FIELD_EXTRACTION`. Emphasize human verification remains mandatory.
3. **Quality branch (45s)** — blur/glare variants route to `REQUEST_RECAPTURE`; show which visual metric crossed policy.
4. **Ambiguity branch (45s)** — two documents route to `REQUEST_HUMAN_CROP`; sparse evidence takes the same human-control path.
5. **Duplicate branch (45s)** — retained dHash causes `QUARANTINE_DUPLICATE_REVIEW`; show Hamming distance and original evidence id.
6. **AWS flow (45s)** — versioned S3 event identity, Lambda container with OpenCV 5, conditional DynamoDB evidence write, idempotent replay.
7. **Tamper/failure evidence (30s)** — change trace/action or source image and show deterministic verifier rejection.
8. **Limitations (15s)** — no autonomous financial approval/payment, no claim that image hashes authenticate vendor truth, and only deployed evidence may support AWS/OpenCV-5 performance claims.
