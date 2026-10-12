# LIBNOVA provider and portable receiving contract

## Scope and evidence

This contract describes the independently implemented LIBNOVA destination in the existing research preservation application. The provider source was retrieved on 12 October 2026 from LIBNOVA's maintained repositories. The implementation uses the deployed container, metadata schema, storage, native File index and existing BagIt Function. It does not create an account, container, schema, Function or substitute a declared checksum for actual content receiving.

Two source revisions govern the integration:

| Source | Exact revision | Purpose |
| --- | --- | --- |
| LIBNOVA SDK, repository project 79 | 2e03d8ba3d10afe19f1bed450c68e77a188ad695 | Current API objects, File iteration, metadata ADD, S3 path/index behavior and Function call. |
| BagIt validator, repository project 131 | f61b3e09d670f4a8fd49c415e5b628a335294870 | Actual unpacked-folder validation workflow and its job report. |

The captured source is a protocol reference. The application does not copy the complete upstream SDK under an assumed common license. In particular, an MIT notice on an individual file is not evidence that every upstream module has that license.

Primary source references:

- [SDK API driver](https://repo.libnova.com/api/v4/projects/79/repository/files/libnova%2Fcommon%2Fapi%2FDriver.py/raw?ref=2e03d8ba3d10afe19f1bed450c68e77a188ad695).
- [Native File API and iteration](https://repo.libnova.com/api/v4/projects/79/repository/files/libnova%2Fcommon%2Fapi%2FFile.py/raw?ref=2e03d8ba3d10afe19f1bed450c68e77a188ad695).
- [Existing Function invocation](https://repo.libnova.com/api/v4/projects/79/repository/files/libnova%2Fcommon%2Fapi%2FFunction.py/raw?ref=2e03d8ba3d10afe19f1bed450c68e77a188ad695).
- [Original Function request structure](https://repo.libnova.com/api/v4/projects/79/repository/files/libnova%2Fcommon%2Fnuclio%2FRequest.py/raw?ref=2e03d8ba3d10afe19f1bed450c68e77a188ad695).
- [S3 File implementation](https://repo.libnova.com/api/v4/projects/79/repository/files/libnova%2Fcommon%2Ffilesystem%2FS3%2FFile.py/raw?ref=2e03d8ba3d10afe19f1bed450c68e77a188ad695).
- [S3 storage implementation](https://repo.libnova.com/api/v4/projects/79/repository/files/libnova%2Fcommon%2Ffilesystem%2FS3%2FStorage.py/raw?ref=2e03d8ba3d10afe19f1bed450c68e77a188ad695).
- [Maintained BagIt Function](https://repo.libnova.com/api/v4/projects/131/repository/files/main.py/raw?ref=f61b3e09d670f4a8fd49c415e5b628a335294870).
- [LABDRIVE Function operation and job output](https://docs.libnova.com/labdrive/get-started/execute-lambda-functions).
- [LIBSAFE Advanced Function operation](https://docs.libnova.com/libsafe-advanced-manual/get-started/functions).
- [AWS-maintained Boto3 documentation](https://docs.aws.amazon.com/boto3/latest/).

| Captured module | Bytes | SHA256 |
| --- | ---: | --- |
| Driver.py | 15793 | 9773f0536d3c7cc2662b5affa66999cd153699ab6931d64c35711870c4db7ca5 |
| File.py | 23839 | 9167e484bb9ad4872cfe7e3f84eff38e7180c0b57bf136c1fc1f9847e0477669 |
| Function.py | 2933 | 2b5a0a8c9c44a7dc55db45c49501bc50c560e7d8067ae20b81bddc5267eb3e09 |
| Request.py | 14459 | 60023cce0b846b456518858058e42ac030f0294a415912ebe1bfada95064d775 |
| S3/File.py | 14515 | 97a6d92753b67ef2f71bc225fd4e3ab1f82ffd485f538561ce8af25838176034 |
| S3/Storage.py | 7023 | bad60d3525a6e087e0d8922b49795c86167b7217dc012de2a6f8e62f7b54efd5 |
| BagIt main.py | 14832 | 2d940829e128f5c5e761365ab7811c1dfd1ccc59fc0451562d4b040de3c646f8 |

These are captured-source identities. A customer's present destination is separately checked at receiving time and recorded in its original operation.

## Application modules and supported inputs

The original `preservation.py` owns the source collection, review revisions and BagIt transfer. The new `libnova.py` owns the destination mapping, frozen package and standalone portable snapshot. The new `libnova_client.py` owns the receiving plan, original remote actions, observations and recovery.

A prepared package retains:

| Member | Role |
| --- | --- |
| package.json | Immutable package identity, original transfer binding, summary and exact inventory. |
| bag/ | Every unchanged original BagIt member. |
| original-bag.zip | Exact supplied original archive, when preparation received a ZIP. |
| mapping.json | Normalized selected descriptor mapping. |
| record-metadata.json | Source-bound included record IDs, mapped values and unmapped/source rights context. |
| report.html | Deterministic human review of this frozen package. |
| operations/ | Original client plans, requests, results, provider observations, reports and progress. |

The package schema is `stellar-forge.libnova-research-package.v1`. Its ID is derived from the canonical binding containing original bag identity, original manifest SHA256, every bag member's path/length/SHA256 and normalized mapping. The package's own canonical SHA256 additionally identifies the complete prepared descriptor used by each operation.

Limits for this initial profile are 1,000 included bibliographic metadata records and 1 GiB of original bag material. A portable snapshot has an 8 GiB total receiving limit, 30,000 members and bounded JSON members. These are format/input limits, not a promise of constant memory usage: the original preservation foundation reads some source and archive evidence into memory. Resource sizing must use the agreed supplied sample.

Mapping schema: `stellar-forge.libnova-research-mapping.v1`.

~~~json
{
  "schema": "stellar-forge.libnova-research-mapping.v1",
  "fields": [
    {"dcField": "title", "iecode": "dc.title", "dataType": "LONGSTRING"}
  ],
  "note": "Confirmed existing descriptor mapping."
}
~~~

Supported explicit descriptor types are STRING, LONGSTRING, NUMBER, DATE and BOOL, corresponding to the source enum values 1 through 5. Complex linked fields, enumerations and provider-specific relationships require a separately agreed mapping profile. The original source and Dublin Core values remain available regardless of which fields are mapped.

## Receiving configuration

Configuration schema: `stellar-forge.libnova-client.v1`.

~~~json
{
  "schema": "stellar-forge.libnova-client.v1",
  "baseUrl": "https://existing-platform.example",
  "tokenEnv": "LIBNOVA_API_TOKEN",
  "containerId": 101,
  "storageId": 201,
  "metadataSchemaId": 301,
  "functionId": 401,
  "objectPrefix": "reviewed-research",
  "s3": {
    "endpointUrl": "https://existing-object-endpoint.example",
    "bucket": "existing-bucket",
    "region": "us-east-1",
    "accessKeyEnv": "LIBNOVA_S3_ACCESS_KEY",
    "secretKeyEnv": "LIBNOVA_S3_SECRET_KEY",
    "addressingStyle": "path"
  },
  "timeoutSeconds": 60,
  "indexWaitSeconds": 60,
  "jobWaitSeconds": 60,
  "pollSeconds": 1,
  "note": "Illustrative IDs; replace with the receiving owner's existing IDs."
}
~~~

The IDs above are examples, not a deployed destination. Optional fields are functionKey, caFile, allowLoopback and s3.sessionTokenEnv/s3.caFile. All literal credentials are excluded from configuration. The endpoint must be an origin without embedded credentials, query, fragment or API path. A custom CA file preserves verification.

The platform receives Bearer authorization. Boto3 and botocore perform the original S3 signing. The application does not implement another signer or invoke the upstream convenience storage wrapper that prints credential values. Boto3 is an explicit lazy dependency, currently constrained by the application to `boto3>=1.36,<2`. Before receiving, its service model must expose conditional PutObject.

Preflight reads the existing container, storage, schema, Function and every selected descriptor. It compares the actual provider relationships to the frozen configuration and retains a compact provider-binding.json. Subsequent receiving rejects a changed binding. For MINIO/CEPH, the configured endpoint must match the original storage's endpoint and secure flag. For AWS-style storage, the region and approved endpoint are checked along with the bucket.

HTTP is permitted only with allowLoopback:true and an explicitly entered localhost/127.0.0.1/::1 origin. The original native fixture uses ports 18083 and 18084 by convention; the application does not hardcode those ports.

## Exact native API surfaces

All paths below are relative to the saved HTTPS origin followed by `/api/`. The original API driver uses JSON conditions for GET collections. The client retains status, selected response headers, original byte length and SHA256, and sanitized JSON for every response.

| Method and path | Use and accepted evidence |
| --- | --- |
| GET container/{id} | id, storage_id and metadata_schema_id must match the saved configuration. |
| GET storage/{id} | id, S3 type and parsed extra bind provider/bucket/region/endpoint. |
| GET objects/metadata/schema/{id} | The existing schema object, allowing its native one-element wrapper. |
| GET objects/metadata/schema/descriptor | Conditions select metadata_schema_id and iecode; id/type/code/schema must match. |
| GET functions/{id} | Existing Function id/key and folder-capable source type. |
| GET file | Exact fullpath lookup or the maintained keyset folder traversal. |
| GET file/{id} | Original native identity, container, path, type and file byte size. |
| GET file/{id}/metadata | Complete repeated descriptor values. |
| PUT file/{id}/metadata | Only the explicit additive ADD body below. |
| POST container/{cid}/file/{fid}/event/{functionId} | Invoke the existing Function on the original native bag folder. |
| GET job/{id} | Original job identity, Function/container/folder binding and status/result. |
| GET job/{id}/messages | Original job messages with continuation completeness checks. |
| GET job/{id}/assets | Original report references with continuation completeness checks. |

A typical native File object contains id, container_id, parent, fullpath, type, size and deleted. File type 1 is a file, 2 a folder and 3 a journal; this receiving profile accepts only the original files and folders. Paths start with a slash; folders end with one.

Exact path lookup uses:

~~~json
{
  "conditions": [
    {"container_id": 101},
    {"fullpath": "/reviewed-research/package/operation/data/example.json"},
    {"deleted": 0}
  ],
  "limit": 2
}
~~~

Recursive folder traversal preserves the maintained File.iterate_files keyset form:

~~~json
{
  "conditions": [
    {"container_id": 101},
    {"parent": 501},
    {"deleted": 0},
    {"id": {"operator": "gt", "value": 0}}
  ],
  "limit": 1000
}
~~~

The client advances from the maximum returned native ID, rejects nonprogress, repeated IDs, foreign parents or containers, and continues until an actual empty response. An observed short page does not imply that the entire folder was read. The final recursive native ID/path closure must match the complete received bag and directories.

API success envelopes may use result or data, including the captured nested data wrapper. Explicit success:false, malformed JSON, unsupported response shapes and retained pagination indicators remain failures or receiving pauses. An unfinished collection is never reported as a complete metadata or job-output read.

## S3 bytes and File indexing

The upstream storage convention places container objects under `{containerId}/{relativePath}` in the selected bucket. This client derives an operation namespace from the configured prefix, immutable package ID and a stable hash of the original operation ID.

Before the first write, the original operation verifies that its namespace is empty both in S3 and the native File index, then durably records that admission. A new plan cannot adopt an occupied namespace. Reopening the original saved plan continues its retained admission.

Each actual bag member is uploaded from its original held file descriptor. The client checks that descriptor's bytes and SHA256 before dispatch, passes ContentLength and ContentMD5 through the maintained S3 transport, and uses IfNoneMatch:* to prevent overwriting a pre-existing object. Required folder markers are empty objects under the same namespace. No throwaway upload is used as acceptance evidence.

An immutable local action request precedes each PUT. The client disables automatic S3 write retries. If an outcome is lost, it retains the original request and reads the actual object. Matching length and SHA256 can complete the original action. An absent or different object after an uncertain original dispatch is not a reason to repeat that write automatically.

After content receiving, the client waits for the platform's own File index and freezes the returned File IDs, parent relationships, paths and original byte identities. It compares both the full S3 prefix and recursive native File tree. A database File record without its real S3 bytes cannot pass. An S3 object without its expected native File identity cannot pass.

The final read repeats actual content hashing and native identity checks. It does not treat an ETag, a hash declaration API or an upload response as content verification.

## Metadata preservation

The actual supported additive form is:

~~~json
{
  "metadata": [
    {"iecode": "dc.title", "value": "Reviewed title", "action": "ADD"},
    {"iecode": "dc.creator", "value": "First creator", "action": "ADD"},
    {"iecode": "dc.creator", "value": "Second creator", "action": "ADD"}
  ]
}
~~~

The original metadata is retained before any ADD. Mapped values are compared as multisets, preserving repeated values; original unmapped values must remain present with at least their original multiplicities. New unrelated metadata is allowed.

An already matching mapped set requires no write. A conflicting mapped set stops receiving. If a process loses an ADD response, current metadata can establish the original result. If the complete expected values are not observed, the client retains the uncertain original action and does not send another ADD. It never substitutes the upstream replacement-style metadata setter.

## Existing Function and original job

The current SDK's Function call uses:

~~~json
{
  "extra": {
    "research_package_id": "the-original-package-id",
    "research_operation_id": "the-original-operation-id"
  }
}
~~~

This body is POSTed to the container/File event endpoint for the selected Function ID. The original response carries container_id, file_id, job_id, file_path and event_key. These identities are bound to the immutable started Function action.

The client does not use Job.create as an execution shortcut. That method creates a job record and does not establish that the selected original folder was passed through the required Function call.

Original job status values are 1 RUNNING, 2 COMPLETED, 3 WAITING and 4 FAILED. Result values are 1 OK, 2 OK_WITH_WARNING and 3 ERROR. A completed warning remains visible in the final result. Unknown states are retained, not guessed to be successful.

The job must match the saved job ID, container and Function. An explicitly entered job ID additionally requires server-side file_id or a matching single-file Function input binding. A response that points at another folder or input set is rejected.

Job assets are resolved back to original native File objects, checked for container and path, and downloaded from the actual S3 key. Each observed report version is retained separately with size and SHA256. The local report path never substitutes for the original job/asset IDs.

The maintained BagIt Function operates on unpacked folders. Source review also found that its own checks are not a sufficient complete-record proof: particular missing-member paths can continue, and its extra-file traversal does not itself establish this application's full recursive closure. Therefore the application independently validates the original BagIt before upload and repeats full source/content/index/metadata receiving after the original job completes. These are implementation conclusions from the pinned Function source, not a claim about every LIBNOVA deployment.

## Durable operation and reconciliation schema

Operation schema: `stellar-forge.libnova-operation.v1`. The immutable operation.json binds id, packageId, packageSha256, normalized configuration, configurationSha256, objectPrefix and the two primary source revisions.

The on-disk operation retains provider-binding.json, namespace-admission.json, indexed-files.json, metadata-baselines, immutable observations, original action request/result pairs, downloaded job assets, receiving proofs/reports and atomic state.json.

| API | Side effects |
| --- | --- |
| plan(workspace, configuration, operation_id) | Offline local immutable plan and initial state. |
| load_operation(workspace, operation_id) | Pure package/configuration binding read. |
| show(workspace, operation_id) | Pure atomic saved-state read; no writer lock or provider request. |
| run(workspace, operation_id) | Original planned provider writes plus receiving observations. |
| refresh(workspace, operation_id) | Provider reads and local observations; no new PUT/ADD/Function. |
| reconciliation_template(kind) | Pure provider-owned evidence template. |
| reconcile(workspace, operation_id, evidence) | Read-only provider validation plus original local result recording. |

Every operation writer and package export holds `libnova.lock(prepared)`. It is nonblocking: a concurrent writer gets WORKSPACE_BUSY. The observer can read the current atomic state while the original remote request is in progress.

Every action result must match the SHA256 of its immutable original request and the operation/package identity. The action directory name is derived from the action key. Unknown outcomes remain recorded; there is no automatic switch to another operation ID.

Evidence schema: `stellar-forge.libnova-operation.v1.reconciliation`.

~~~json
{
  "schema": "stellar-forge.libnova-operation.v1.reconciliation",
  "kind": "original-function-response",
  "response": {
    "container_id": 101,
    "file_id": 501,
    "job_id": 601,
    "file_path": "/original/bag/folder/",
    "event_key": "original-returned-key"
  },
  "note": "Location and origin of the original returned response."
}
~~~

The other supported form replaces response with `kind:original-job-id` and a positive integer jobId. Both require a nonempty source note. The client supplies both templates; the Workbench consumes them rather than defining a competing evidence schema.

Saved state schema is `stellar-forge.libnova-operation.v1.state`, with operationId, state, updatedAt and phase-specific data. show returns {operation,state,networkRequests:0,mutation:false,stateRead}; run, refresh and reconcile return the state record directly. A later failed observation preserves its prior verified observation as historical evidence rather than implying that the old result is current.

VERIFIED includes the complete receiving proof path/length/SHA256, report path, source/included/excluded counts, object/byte counts, native container/schema/job IDs and explicit allOriginalBytesVerified/allMappedMetadataVerified flags. The proof contains every included original identifier, source SHA256, native File ID, content length/SHA256 and mapped values.

## Portable receiving and interruption behavior

Standalone export includes all frozen package files and original operation history, plus the mandatory application closure: preservation.py, libnova.py, libnova_client.py, libnova-requirements.txt and research/oai/oai_feed.py. Operator/provider guides are included when present. The full Workbench export additionally includes its original source/review/operator context and managed entry.

The snapshot manifest lists the exact path, byte length and SHA256 of every member. Receiving refuses duplicate, encrypted, special, unsafe or unlisted ZIP members, validates all hashes and CRCs, and requires the mandatory application files.

The receiver holds the original regular archive descriptor for hashing, ZIP access and the final publication checks. It uses a deterministic output-bound staging directory and an immutable archive/manifest binding. Its own interrupted metadata temporary can be adopted only when the stage is empty or contains the expected incomplete binding prefix. Unrelated retained bytes are never removed or adopted.

Per-member extraction publishes only completed, fsynced bytes. A repeated original receive reuses verified completed files and its own bound staging state, then atomically publishes the whole directory. The binding remains present through that final rename so process loss at the boundary stays recoverable.

Reopening an already received directory verifies its original archive binding, immutable source/application and every original operation member. Atomic state may advance; new legitimate observations and operations may be added. All original/current operation identities are validated through the pure client read. A removed original operation.json or altered original request cannot be hidden by an otherwise valid bag.

## Native acceptance record

One owned original169 receiving journey should exercise the actual HTTP and boto3/S3 transport, delayed native indexing, descriptor validation and additive metadata, original Function response/job/report, all-record byte proof, interrupted original action reconciliation and complete export/cold receive. It should retain the exact fixture source, provider IDs, command, logs, source versions, response counts, no-duplicate-write assertions and final artifact hashes.

That fixture is an application/protocol observation. Live tenant acceptance requires the receiving institution's existing destination, explicit credentials and source/mapping agreement. Final handoff must state which of these actually completed and link its exact retained receipt.
