# S3 notification deployment dependency repair

The original SAM template used `S3ReadPolicy.BucketName: !Ref EvidenceBucket`
while that bucket's object-create events targeted `VisionWorker`. SAM generates
a Lambda permission and execution role, forming:

`EvidenceBucket -> VisionWorkerImageCreatedPermission -> VisionWorker -> VisionWorkerRole -> EvidenceBucket`

AWS documents this pattern and resolves it by removing the execution role's
direct reference to the bucket resource:
https://repost.aws/knowledge-center/cloudformation-circular-dependency-sam

The repaired template takes a required `EvidenceBucketName` parameter. Both the
bucket's physical name and the read-policy name use that same parameter. The
S3 event retains its required reference to the actual `EvidenceBucket` resource.
No wildcard bucket access, separate notification function or deployment-time
custom resource is introduced. Versioning, encryption, retained-record HMAC,
DynamoDB keys, image architecture, memory, timeout and concurrency are unchanged.

## Deployment input

For a **new stack**, choose an available, globally unique S3 bucket name using
lowercase letters, numbers and hyphens, and supply `EvidenceBucketName` alongside
the existing immutable image URI and privately provided HMAC key. The parameter
pattern is a restricted naming syntax, not a guarantee that a name is available
or accepted under every S3 reserved-name rule. Do not place a real key in source,
a command transcript, a published artifact or a demo.

For an existing stack, adding a physical bucket name can entail resource
replacement. Inspect the CloudFormation change set and plan data preservation
before updating; this patch does not assert that any existing bucket is migrated
or that simply repeating its current name guarantees a no-replacement update.
No stack was created or updated by this source repair.

## One targeted offline regression

```sh
python -m pip install -r infra/validation-requirements.txt
python infra/check_sam_dependencies.py
```

The pinned AWS SAM translator expands the real template with synthetic deployment
values and a fixed managed-policy ARN lookup. The check restores the previous
resource-reference pattern and requires that its translated graph contains a
cycle. It then transforms the repaired template and requires an acyclic graph,
reporting its resource dependencies and valid creation order. Graph edges include
`Ref`, `GetAtt`, `Sub` and explicit `DependsOn` references to template resources.
The checker is specific to this template, not a general replacement for
CloudFormation validation, IAM analysis or a real deployment.

The path-scoped GitHub check has read-only repository permission and no AWS
credentials. It performs this one regression, prints its receipt, and uploads
that receipt. It is not scheduled and creates no AWS resources. Successful
translation does not prove image availability, IAM authorization, S3 name
availability, OpenCV 5 execution, runtime processing, contest submission or prize.
