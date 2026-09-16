# ProofLine architecture

ProofLine separates **measurement**, **evidence custody**, and **review proposals**. The OpenCV pipeline is the measurement authority for this source generation; the agent is deliberately not.

1. A versioned S3 object-created event identifies an inspection frame. A configured, versioned reference object is read separately.
2. `vision.inspect_pair` decodes both images, registers the inspection to the reference with OpenCV ECC affine registration, computes an OpenCV absolute-difference field, thresholds/morphologically cleans it, and measures connected regions.
3. The evidence packet binds the raw frame hashes, OpenCV version, pipeline generation, registration matrix/score, segmentation-mask digest, each region geometry/measurement/crop digest, and an all-false mutation/financial/outbound authority map.
4. `agent.build_review_proposal` accepts only a verified evidence packet. It can rank **review** priority, but cannot approve/reject a product or mutate anything.
5. The AWS runtime writes evidence + proposal into DynamoDB with a conditional idempotency key derived from S3 bucket/key/version/sequencer + pipeline generation. Duplicate delivery is visible and non-destructive.

## Trust boundaries

- `receipt_sha256` is deterministic integrity evidence, not a digital signature or proof of who ran the pipeline.
- ECC registration must clear a score floor; failure is a hard error rather than silently measuring misregistered images.
- Region count is bounded. Too many components is a review/configuration failure, not a truncated success.
- Production CLI/runtime requires OpenCV 5.x. The `--allow-opencv4-dev` switch exists only so source tests can run in development environments before the competition runtime is provisioned. It changes no packet authority.
- AWS credentials are ambient runtime credentials. They are never serialized into evidence packets.
- The code never sends email/chat, contacts vendors, changes product disposition, purchases anything, or marks revenue.

## AWS significance

AWS is the event and custody plane, not just hosting: versioned S3 events define inspection inputs, Lambda performs OpenCV measurement, and DynamoDB provides idempotent evidence-ledger insertion. That contract is independently testable with fakes before any live deployment.
