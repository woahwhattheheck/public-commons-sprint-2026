# DrainGuard AWS SAM template — integrated source repair

**Scope:** this canonical integration includes the source-level repaired `infra/template.yaml`, with the original 20-file source archive preserved separately and unchanged. No AWS mutation occurred.

## Issue found

The predecessor SAM `CaptureUploaded` event binds S3 bucket notifications to the generated Lambda permission, but the Lambda execution role policy refers back to `${DrainGuardBucket.Arn}` and the Lambda environment uses `!Ref DrainGuardBucket`. Together these form a plausible generated dependency cycle `bucket notification → Lambda permission → Lambda/role → bucket`. This must be confirmed with the actual SAM transform before any deployment.

## Repaired template

- Adds a required DNS-safe **unique** `DrainGuardBucketName` parameter (3–63 chars). The bucket resource uses that exact parameter as its physical name.
- Uses only that same parameter for the function `DRAINGUARD_BUCKET` environment value and for the narrow `reference/*`, `captures/*`, and `reports/*` S3 permissions via partition-aware ARNs. The execution role therefore no longer depends on the generated bucket resource.
- Preserves the legitimate `CaptureUploaded` event reference to the actual bucket, DynamoDB review-queue policy, default-private encryption, versioning and human-review boundaries.

## Focused source check

One offline PyYAML CloudFormation-tag parse and structural check passed: generated S3 event still refers to `DrainGuardBucket`; execution function role/environment/metadata have **zero** `DrainGuardBucket` resource references and use `DrainGuardBucketName` instead; review-table dependency and private versioned S3 guards retained. This is **not** `sam validate`, not a CloudFormation transform proof and not an AWS integration test.

## Operational gates still open

1. Run `sam validate --lint --template-file infra/template.yaml` with a compatible genuine SAM CLI; inspect the **transformed** template graph, not just this source-level check. If transform introduces any cycle, fix before deployment.
2. Provide a globally available S3 bucket name with `--parameter-overrides DrainGuardBucketName=<globally-unique-name>`; this name is a deployment choice, not embedded in source.
3. Obtain explicit authorization for an actual AWS account/environment and bounded cost; deploy and capture first-party response only after authorization.
4. Confirm OpenCV 5 runtime separately and retain original entrant identity/rights for any competition submission.

No provider calls, user sessions, credentials, payment, prize, or submission are inferred.
