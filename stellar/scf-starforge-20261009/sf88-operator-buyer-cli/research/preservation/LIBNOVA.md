# LIBNOVA reviewed research receiving

## What this workflow delivers

This application takes a saved, reviewed bibliographic collection from the existing research preservation workspace and prepares it for one existing LIBSAFE Advanced or LABDRIVE container. It preserves the original source pages, record identifiers, review decisions, rights notes and all original BagIt members. The receiving operation uploads the unpacked bag, waits for the platform's own File index, applies the explicitly selected descriptor values, invokes an existing BagIt Function once and records its original job and reports.

A completed receiving state includes actual downloaded content lengths and SHA256 values for every original object, the platform File IDs and paths, the complete indexed folder, and a comparison of each mapped metadata value. Job completion and content verification are separate observations. A job that reports success cannot by itself establish that all source records arrived.

The initial supported workshare is one source profile, one existing container, one existing metadata schema, its associated storage and one existing BagIt Function. Its supplied-sample acceptance envelope is up to 1,000 bibliographic metadata records and 1 GiB of source/export material. This is a reviewed metadata collection; article texts, images and media described by the records retain their own rights and are not implicitly included or licensed.

The maintained application source is complete. The original 169-record public-source receiving journey and tenant acceptance must be identified by their actual receipts. Do not describe a prepared command, a successful source review or a local fixture as acceptance by a customer's live tenant.

## Start with the existing workspace

Use the installed research preservation application and its original source example. The complete source example is the 169-record OpenAlex metadata archive identified by SHA256 948c5c85a3ec88cf26ab9bae2ebcda284ea429dfa3c8240ac2565e30b278f77b. Its declared source closure retains the original source pages and full original manifest as provenance. It does not substitute another customer's export or the later paid research collection.

The original preservation engine provides the review history and BagIt producer. LIBNOVA adds a destination package and a receiving operation. It does not replace the source collection, infer new rights, create a tenant, create a container or install a remote Function.

Use Python 3.11 or later. The producer and offline source review use the standard library. Actual S3 receiving additionally uses the declared boto3 dependency and its compatible botocore implementation. Install from the supplied requirements file in your existing application environment:

~~~sh
python3 -m pip install -r research/preservation/libnova-requirements.txt
~~~

The S3 dependency is imported only when that destination's client runs. Existing RODA and Preservica workflows remain available without importing it. The client checks that the installed S3 model supports conditional PutObject before it dispatches any upload. The native receiving report should record the actual Python, boto3 and botocore versions used; the requirements range is not a claim that a particular installation has already passed.

## Review and freeze the source

In the browser Workbench, open the existing reviewed collection, inspect the saved inclusion decisions and select its published review before preparing LIBNOVA. The original source remains visible. A correction produces another saved review, and its transfer has its own revision-bound identity.

The equivalent original commands are:

~~~sh
python3 research/preservation/preservation.py init \
  --source /absolute/OpenAlex_CIIM_Source_Example_20261012.zip \
  --workspace /absolute/research-review \
  --organization "Receiving institution" \
  --contact "Receiving team"

python3 research/preservation/preservation.py review-template \
  --workspace /absolute/research-review > /absolute/review.json

python3 research/preservation/preservation.py review-save \
  --workspace /absolute/research-review \
  --input /absolute/review.json --expected-revision 0

python3 research/preservation/preservation.py build \
  --workspace /absolute/research-review \
  --output /absolute/reviewed-transfer.zip \
  --expected-revision 1 --zip
~~~

The revision numbers above illustrate a fresh workspace. Use the actual current revision returned by the original application. Do not force an old revision over a later saved review. If the collection is already initialized and reviewed, continue that workspace and omit the initialization step.

The transfer preserves one JSON content file for each included work, the reviewed Dublin Core values and the original source/review evidence. Excluded records remain explained in the source and decision history. Contact and organization fields are part of the frozen transfer identity, rather than mutable decorations on an already published bag.

## Map existing metadata descriptors

Generate the destination mapping:

~~~sh
python3 research/preservation/libnova.py mapping-template > /absolute/libnova-mapping.json
~~~

Its schema is `stellar-forge.libnova-research-mapping.v1`:

~~~json
{
  "schema": "stellar-forge.libnova-research-mapping.v1",
  "fields": [
    {"dcField": "title", "iecode": "dc.title", "dataType": "LONGSTRING"},
    {"dcField": "creator", "iecode": "dc.creator", "dataType": "LONGSTRING"}
  ],
  "note": "Codes and types confirmed against the receiving container's existing schema."
}
~~~

The example descriptor codes are placeholders. Enter the codes already deployed in the selected metadata schema. The receiving client checks each code, schema ID and data type against the current provider response before making the first upload.

| Mapping field | Meaning |
| --- | --- |
| dcField | The reviewed Dublin Core field from the original record. |
| iecode | An existing LIBNOVA descriptor code. |
| dataType | STRING, LONGSTRING, NUMBER, DATE or BOOL, matching the existing descriptor. |
| note | The agreed mapping basis and any intentionally unmapped fields. |

A Dublin Core field can have repeated values. The mapping preserves those values and their multiplicity. NUMBER, DATE and BOOL inputs must be accepted by the explicit type conversion rules; ambiguous conversion is an input error. Unmapped Dublin Core fields remain in the original source and bag metadata. They are not silently discarded.

Remote metadata writes use additive ADD operations. The client captures the original metadata before the first ADD, compares the complete mapped value multiset and checks that original unmapped values remain present. If mapped descriptors already contain different values, it stops for reconciliation instead of replacing them.

Prepare and verify the complete destination package:

~~~sh
python3 research/preservation/libnova.py prepare \
  --bag /absolute/reviewed-transfer.zip \
  --mapping /absolute/libnova-mapping.json \
  --out /absolute/libnova-package

python3 research/preservation/libnova.py verify \
  --workspace /absolute/libnova-package

python3 research/preservation/libnova.py show \
  --workspace /absolute/libnova-package
~~~

Preparation freezes the mapping, retains the complete original ZIP when supplied, reproduces every original bag member, derives the mapped record metadata and writes a human review. The package identifier binds the original review/transfer identity, exact bag inventory and normalized mapping. Changing any of those inputs requires a different prepared package.

## Configure an existing receiving destination

Generate the client configuration:

~~~sh
python3 research/preservation/libnova_client.py configuration-template \
  > /absolute/libnova-configuration.json
~~~

| Required input | Receiving meaning |
| --- | --- |
| baseUrl | The existing platform HTTPS origin, without an API path or embedded credentials. |
| containerId | The selected existing container. |
| storageId | That container's existing S3 storage. |
| metadataSchemaId | That container's existing metadata schema. |
| functionId | The existing Function that accepts the bag folder. |
| objectPrefix | The agreed relative parent path; the client adds package and operation identity beneath it. |
| tokenEnv | Name of the environment variable holding the authorized API token. |
| s3.endpointUrl, bucket, region | The actual endpoint and bucket for the selected storage. |
| s3.accessKeyEnv, secretKeyEnv | Environment variable names for authorized S3 credentials. |
| s3.sessionTokenEnv | Optional environment variable name for a temporary S3 session token. |
| s3.addressingStyle | The existing endpoint's path or virtual addressing mode. |

Credentials are environment references. Do not place token or secret values in the JSON, source repository, review notes or screenshots. The client uses the platform's original Bearer token and boto3's standard SigV4 implementation. TLS verification remains enabled; an optional CA file can be supplied for an existing private certificate authority.

The initial example contains no real tenant IDs or credentials. Obtain the existing destination IDs, storage agreement, descriptor mapping and authorized access from the receiving owner. The client validates the container-to-storage and container-to-schema relationships, the Function identity and its folder-capable source type, the storage endpoint and bucket, and every mapped descriptor.

`allowLoopback:true` permits HTTP only for explicitly entered localhost, 127.0.0.1 or ::1 receiving fixtures. It does not relax production HTTPS. The supplied native receiving runner uses this option with its own local fixture and harmless fixture credentials.

## Plan once, then run the original operation

Choose an operation ID that remains stable throughout this receiving attempt and its recovery:

~~~sh
python3 research/preservation/libnova_client.py plan \
  --workspace /absolute/libnova-package \
  --configuration /absolute/libnova-configuration.json \
  --operation-id research-collection-original-001

python3 research/preservation/libnova_client.py run \
  --workspace /absolute/libnova-package \
  --operation-id research-collection-original-001
~~~

Planning is offline. It freezes the package, configuration and operation namespace and creates no remote object or job. Repeating the same plan reopens that saved identity. A different configuration under the same operation ID is rejected.

Actual receiving follows these stages:

1. Validate the current existing destination and mapped descriptors.
2. Admit the empty operation namespace and retain that original admission.
3. Upload the actual unpacked bag and required directory markers with conditional object creation.
4. Read back every uploaded object's size and SHA256, then wait for the platform's native File index.
5. Freeze the original File IDs, paths and parent relationships and compare the complete S3 and native folder inventories.
6. Apply the selected descriptor values with the retained additive metadata actions.
7. Invoke the chosen existing BagIt Function on the original bag folder once, retain its response and follow that job.
8. Receive the original job messages and report assets, then independently recheck all source bytes and mapped values before recording VERIFIED.

The maintained Function endpoint is the container/File event endpoint, not a standalone job-record creation endpoint. The Function receives the unpacked native folder; uploading a ZIP alone does not produce the equivalent receiving input.

Every writer holds the prepared workspace's original lock. If another original operation still holds it, a second writer reports WORKSPACE_BUSY. The browser can continue to show the last saved atomic progress: `show` makes no provider request and does not wait for the remote writer.

## Read progress and recover without duplicate writes

~~~sh
python3 research/preservation/libnova_client.py show \
  --workspace /absolute/libnova-package \
  --operation-id research-collection-original-001

python3 research/preservation/libnova_client.py refresh \
  --workspace /absolute/libnova-package \
  --operation-id research-collection-original-001
~~~

`show` is an offline saved-state read. `refresh` makes provider reads and records new observations but does not dispatch another PUT, metadata ADD or Function invocation. A waiting or reconciliation result is a meaningful retained state, not a reason to invent another operation ID.

| State or condition | Operator action |
| --- | --- |
| PLANNED | Review the saved inputs, then run the original operation. |
| WAITING_INDEX | Keep the existing objects and use refresh after indexing progresses. |
| WAITING_JOB or WAITING_JOB_ASSETS | Follow the original saved job and receive its output. |
| REQUIRES_RUN | No original write exists yet; use run after reviewing the saved plan. |
| RECONCILE_REQUIRED | Inspect retained request/response evidence and reconcile that original action. |
| REMOTE_*_MISMATCH | Preserve the observation and correct the receiving conflict with its owner. |
| ORIGINAL_JOB_FAILED | Inspect the original job and reports. A new job is a deliberate subsequent operation. |
| VERIFIED | Export the complete workspace and retain its full receiving proof. |

Each provider write has an immutable request record published before dispatch. If a process stops after dispatch but before the response is retained, the next invocation reopens that request. It does not repeat an uncertain object write or metadata ADD. Exact content or metadata readback can complete the original recorded action. If an uncertain Function lacks a retained response, the operator must provide the original response or an existing job ID whose server-side binding establishes the selected folder.

Generate the appropriate evidence form from the provider client:

~~~sh
python3 research/preservation/libnova_client.py reconciliation-template \
  --kind original-function-response > /absolute/reconcile.json

python3 research/preservation/libnova_client.py reconciliation-template \
  --kind original-job-id > /absolute/reconcile-job.json
~~~

The first form contains `response` with the original container_id, file_id, job_id, file_path and event_key. The second contains a positive integer `jobId`. Both require a note identifying the original evidence. Do not copy a different job ID or fabricate a successful response.

~~~sh
python3 research/preservation/libnova_client.py reconcile \
  --workspace /absolute/libnova-package \
  --operation-id research-collection-original-001 \
  --evidence /absolute/reconcile.json
~~~

Reconciliation verifies the original Function request, container, Function and folder. It saves the accepted evidence and original result. Follow with refresh to receive the original job's current outputs and complete the full byte and metadata proof.

Provider transport errors, limits and unsupported pagination remain visible. A response with an unconsumed continuation cannot establish a complete job-message, asset or metadata collection. The client retains sanitized provider observations and original raw-response hashes. Credential-bearing fields and configured secret values are excluded from saved text.

## Export, receive and reopen the complete application

~~~sh
python3 research/preservation/libnova.py export \
  --workspace /absolute/libnova-package \
  --out /absolute/LIBNOVA_Research_Receiving_001.zip

python3 research/preservation/libnova.py receive \
  --source /absolute/LIBNOVA_Research_Receiving_001.zip \
  --out /absolute/libnova-received
~~~

The snapshot includes the original bag, mapping, review, source ZIP where supplied, complete operation journals, provider observations, native IDs, job reports and receiving proof. It also includes the producer, client, requirements and original preservation/OAI application dependencies. The complete Workbench export additionally preserves its original source workspace and operator history.

Receiving hashes and extracts the same held archive descriptor. It validates the exact ZIP inventory and every member hash, then publishes the complete receiving directory atomically. A stopped extraction can continue its own bound staging files. An empty stage or interrupted binding write is recovered without accepting unrelated bytes.

Reopening the same archive at the same received destination preserves later legitimate progress and observations. It revalidates the original immutable application and operation members, including the operation/configuration identity. Deleting an original operation record does not turn into a successful reuse. Only the saved atomic state is allowed to advance under that original history.

After receiving, continue with the received application and its received workspace. Supply the same authorized environment references if a new remote observation is needed. Local verification and show require no tenant credentials. Do not discard the original receiving ZIP until the chosen durable destination has returned its actual file receipt.

## Acceptance and handoff

For one agreed deployment, retain the entered source/mapping agreement, original review revision, package ID, operation ID, container/storage/schema/Function IDs, native File index, original job ID, all job assets, source/content/metadata proofs and complete exported workspace.

Acceptance should demonstrate that every included record and original member is accounted for, original unmapped metadata remains present, the receiving reports describe the actual observation and the portable workspace reopens without another upload or job. A local fixture establishes the application's behavior against its pinned protocol; the receiving institution's acceptance establishes its deployed configuration.

This module implements the protocol independently. It does not redistribute the entire upstream LIBNOVA SDK as if all files shared one license. See LIBNOVA_PROVIDER_CONTRACT.md for the exact upstream source revisions, API shapes and limitations used in the implementation.
