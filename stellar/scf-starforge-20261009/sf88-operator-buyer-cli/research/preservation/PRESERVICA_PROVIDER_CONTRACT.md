# Preservica provider contract

This document describes the exact package and API contract implemented by
`preservica.py` and `preservica_client.py`. It separates source/package verification,
an upload receipt, an observed ingest process, and verified repository content.
An existing Preservica deployment, its supported API version, its active ingest
configuration, and the intended archival parent remain explicit receiving inputs.

The initial receiving dataset is the original 169-record CC0 bibliographic
metadata example. Every included work becomes one original JSON content file with
a reviewed Dublin Core sidecar. This profile does not fetch or license paper full
text, media, or publisher attachments.

## Authority and version scope

The package format comes from Preservica's official
[Open Preservation Exchange documentation](https://developers.preservica.com/documentation/open-preservation-exchange-opex).
Preservica describes OPEX as its principal import/export format and documents
folder sidecars, content sidecars, immediate manifests, SourceID, security tags,
Dublin Core fragments, and supported fixity algorithms. Its
[OPEX/PAX ingest article](https://developers.preservica.com/blog/using-opex-and-pax-for-ingesting-content)
documents ordinary zipped OPEX ingest from version 6.2. The selected profile is
`preservica-opex-1.0-standard-ingest`; it uses the namespace
`http://www.openpreservationexchange.org/opex/v1.0`.

The upload interface comes from the official
[S3-compatible upload API](https://developers.preservica.com/api-reference/3-upload-content-s3-compatible).
The API explicitly supports the `Preservica-Access-Token` header, ordinary PUT,
HEAD, multipart initialization, part PUT, and multipart completion. The client
does not assume the full Amazon S3 API is available. In particular, it does not
invent list-parts, list-multipart-uploads, or object-download recovery endpoints.

The official [progress-token](https://developers.preservica.com/api-reference/4-progress-token-api)
and [process-monitoring](https://developers.preservica.com/api-reference/5-process-monitoring-api)
pages link to deployment Swagger documentation. Public demo documentation returned
403 during source intake; no successful current tenant Swagger capture is
represented here. The implemented entity and monitor response parsing is also
bound to the inspected primary implementation:
[carj/pyPreservica at 5a53e7e219ac16d28a5c77640518a596c0e8c088](https://github.com/carj/pyPreservica/tree/5a53e7e219ac16d28a5c77640518a596c0e8c088).

| Inspected implementation | Exact Git blob |
| --- | --- |
| `pyPreservica/entityAPI.py` | `d5191013bd368bdd8195d1582031336a8ed5590b` |
| `pyPreservica/monitorAPI.py` | `8a14d098d0c24730bdd6d457b3a50e2943623195` |
| `pyPreservica/uploadAPI.py` | `7e5bee984184eecd234cf4aba63da302b4fa3a8b` |
| `pyPreservica/common.py` | `d73fe3f14c1767b99bccd7c8c94166c77b4beb00` |
| `docs/monitor.rst` | `e263de695fca13b613bd3104159bbd3fba535189` |

These sources were inspected on 12 October 2026. They are an explicit,
version-scoped implementation reference. They are not a claim that a particular
customer tenant has enabled the API, selected the required workflow, or accepted
this transfer. The standard-library client does not install or execute
pyPreservica.

Before upload, the client reads
`GET /api/entity/versiondetails/version` and compares the returned
`CurrentVersion` major/minor to the saved configuration. Entity/XIP namespaces
are derived from that explicit version, following the inspected implementation:
`http://preservica.com/EntityAPI/v<major.minor>` and
`http://preservica.com/XIP/v<major.minor>`. A different version stops the
operation for review. The template's 9.3 is an editable example, not a discovered
tenant property.

## Native package

The final upload is `transfer.zip`. It contains one top-level collection
directory, a `records` directory, and exactly one JSON content file plus OPEX
sidecar per included research record.

| Native member | Meaning |
| --- | --- |
| `research-opex-<id>/research-opex-<id>.opex` | Package title, description, SourceID, selected/inherited security and package Dublin Core; manifest names the immediate `records` folder. |
| `research-opex-<id>/records/records.opex` | Records-folder SourceID and immediate file manifest. Each content and metadata file has its actual byte size and type. |
| `research-opex-<id>/records/W<id>.json` | Exact original canonical work JSON retained by the source export. |
| `research-opex-<id>/records/W<id>.json.opex` | SourceID, reviewed title/description/DC, original research identifier, original filename and SHA-256 fixity. |

A sidecar is not listed as its own folder's child. Folder manifests list immediate
children, not recursive paths. File sizes and SHA-256 values are computed from
the actual bytes written to the ZIP. Verification regenerates expected sidecars
from the retained original source and saved review, then streams every native
ZIP member to compare its name, size, CRC and SHA-256.

The record SourceID includes the immutable package identity and original work ID:
`<namespace>:edition:<package-id>:record:W<id>`. Package and records-folder
SourceIDs use distinct names. A different source edition, saved review or package
setting produces a different package identity. The original full OpenAlex
identifier remains in the reviewed metadata and identifiers; it is not replaced
by the ingest identifier.

Preservica's documented duplicate settings can use SourceID globally or locally.
This tool neither changes those settings nor guesses them. Reuse the saved
original upload operation when continuing it. Creating another operation or
altering the archival parent is an explicit operator decision subject to the
deployment's deduplication policy.

A null security tag omits the security descriptor and permits the documented
inheritance behavior. A non-null value must name an existing security tag; the
client checks the returned explicit tag during readback. Unknown security tags
are not silently created.

`original.zip` is the maintained preservation foundation's complete reviewed
source/evidence transfer, retained beside the native ZIP. It is not substituted
for the OPEX upload. `source-workspace/` keeps the editable source and complete
committed review ancestry. Complete alternate immutable review candidates from
an interrupted save are retained and labeled unpublished; `current.json` and
its exact prior-review links determine the committed chain.

## Configuration and credentials

`validate_settings` and `validate_configuration` are public offline
validators. They return normalized dictionaries and reject unknown fields. The
browser must invoke them before saving a package or upload plan.

| Client field | Validation and effect |
| --- | --- |
| `schema` | `stellar-forge.preservica-configuration.v1`. |
| `origin` | One HTTPS origin with no path, credentials, query or fragment. Plain HTTP is accepted only for an explicitly selected literal loopback/local receiving service. |
| `tenant` | Existing tenant identifier. The upload bucket is derived as lower-case tenant plus `.package.upload`. |
| `targetVersion` | Entered major/minor, 6.2 or later; checked against the provider's version response. |
| `accessTokenEnv` | Environment variable name, never the access-token value. |
| `parentRef` | Explicit existing structural-object UUID, or null for the selected tenant root. |
| `uploadMode` | `auto`, `single`, or `multipart`. Auto uses a single PUT when the ZIP fits one configured part. |
| `partBytes` | 5 MiB–128 MiB; default 8 MiB. The final part may be smaller. |
| `requestTimeoutSeconds` | 1–300 seconds; default 60. |
| `maxResponseBytes` | 64 KiB–64 MiB; default 8 MiB for metadata/error responses. Original content downloads use their exact expected size. |
| `readbackBatchSize` | 1–250 records; default 25. All ready records are processed in the same run; the batch size controls saved progress. |

The current official [access-token documentation](https://developers.preservica.com/api-reference/6-access-token-api)
describes short-lived tokens and separate login/refresh endpoints. This client
uses an existing authorized token supplied by the receiving environment. A 401
returns `AUTH_REQUIRED`; after the environment is refreshed, the same operation
can continue. It does not retain passwords, token values, cookies or login
requests and does not create an account.

The object key is deterministic from the saved operation ID and transfer SHA-256.
It is not a free-form field. The parent is passed using the documented
`x-amz-meta-structuralobjectreference` header.

## HTTP and upload receipt semantics

The operation directory retains a request before dispatch and a response before
parsing it. Request records contain the exact method, safe selected URL, URL
digest, source-body digest/range and safe headers. Access-token values are
excluded. Responses retain status, safe headers, byte count, source digest,
completeness and any transport failure. Where a response contains a bearer token
or signed foreign URL, its retained text is redacted and its original byte
identity remains explicit. Original content is streamed and hashed; the upload
archive already retains the original bytes.

A final response name appears after its bytes have been written and synced.
Complete HTTP responses require a finished Content-Length/chunked body, not
merely HTTP 200. Conflicting ETag, progress-token, Content-Length, Location or
Retry-After values are rejected. A 200 response containing an S3 Error document
does not confirm a multipart completion.

| Action | Preserved identity | Receiving rule |
| --- | --- | --- |
| Initial HEAD | Original bucket/key | Records whether that unique key was absent before a first upload. HEAD 404 after an uncertain dispatch does not authorize a new upload. |
| Single PUT | Original ZIP digest and immutable key | Sent once unless the recorded response definitively rejected it before acceptance. A lost response remains uncertain. |
| Multipart initialization | Original key, request SHA and returned upload ID | A lost response requires the original response evidence. No undocumented upload listing is invented. |
| Part PUT | Upload ID, part number, exact byte range and SHA | May repeat the same part with the same bytes after a lost part response. Other parts keep their original receipts. |
| Completion POST | Same upload ID and ordered saved part ETags | A lost completion is not blindly repeated. Retained original response/progress or full source readback is reconciled. |
| HEAD progress observation | Same original key | A returned progress header/ETag may locate progress. Object presence is not a content/fixity acceptance result. |

ETags are opaque provider values. They are not assumed to be MD5 checksums.
The official API documents a progress-token response header and a
`-progressToken-<token>` suffix in completion ETags. If both occur they must
agree. The client preserves every earlier request and response when a later
observation resolves an uncertainty.

No automatic abort, delete, replacement upload or new operation is used to
clear an uncertain state. Incomplete multipart uploads are subject to the
provider's lifecycle; if the original upload has expired, its history remains
visible and a new, explicitly chosen operation needs a separately reviewed plan.

## Progress and process observation

The progress reader uses
`GET /api/entity/progress/{token}` and the
`{http://status.preservica.com}Status` element. The inspected implementation
enumerates ACTIVE, PENDING, COMPLETED, SUSPENDING, SUSPENDED, UNKNOWN, ABORTED,
FAILED, FINISHED_MIXED_OUTCOME and CANCELLED.

The process monitor is separate. The official
[Preservica 6.3 API summary](https://developers.preservica.com/blog/api-summary-in-preservica-6-3)
explicitly distinguished progress tokens and process identifiers in that release.
The inspected current SDK adds no progress-to-process mapping. Accordingly this
client does not infer one from a title, timestamp, queue order or successful
monitor status.

A supplied original process selection is observed through
`GET /api/processmonitor/monitors` and
`GET /api/processmonitor/messages?monitor=<id>&start=0&max=100`.
Every message must return the chosen `mappedMonitorId`. Pagination stays on
the same authenticated origin and endpoint and preserves the selected monitor.
The SDK's monitor documentation warns that mapped IDs can change between
releases. Saved process IDs are therefore observed receipts, not permanent
repository entity links. Absence from an unpaged monitor response is not claimed
as exhaustive absence.

A FAILED or mixed progress outcome remains `INGEST_FAILED` even if some files
are visible. Those files retain their individual readback receipts. A selected
process observation does not overwrite a stable SourceID/entity association.

## Full repository readback

The source-ID query is
`GET /api/entity/entities/by-identifier?type=SourceID&value=<exact-value>`.
It must return one entity of the expected type. The parser retains complete
paging when provided; it refuses changed query selection, inconsistent totals,
loops or ambiguous results.

The package and records folders are read as structural objects. Each work is
read as an information object. Original identifiers, title, parent and explicit
security are checked using the returned entity and identifier responses. Reviewed
DC is read through the exact metadata-fragment link in that entity and compared
by field/value multiplicity. An unrelated fragment is not accepted as a match.

The content route follows returned preservation representations, content-object
references, original generations and bitstreams. It checks the content-object
parent, exactly one original source filename, size and SHA-256 fixity. It then
streams the returned original content and verifies its actual byte count and
SHA-256 against the preserved JSON. Same-origin API links retain authentication;
a provider-issued cross-origin HTTPS content redirect receives no bearer token.
All final API/source links and source digests are retained.

`VERIFIED` requires both source folders and every included work to have
verified parent/SourceID/DC/content/fixity observations. A 200 upload, COMPLETED
token or Succeeded process does not by itself meet that condition. Excluded
records remain in the source catalog and review history but are not uploaded or
silently counted as received.

The client continues the entire ready cohort, saving progress after each batch.
A subsequent observation reuses already verified immutable receiving evidence
and works on the unresolved records. It does not present these historical
receipts as continuous monitoring of later repository edits.

## Recovery evidence

`reconciliation_template(kind)` exposes three exact JSON forms:

- `original-response`: original operation, action, request SHA, HTTP status,
  safe headers, base64 original response body, original observation time and
  source description. Init/complete XML must still name the original key and
  bucket. A confirmed response cannot be replaced with a different one.
- `progress-observation`: original single/complete request SHA, exact
  bucket/key and a token from the retained original response. This is labeled an
  explicit original-response association; source readback remains mandatory.
- `process-observation`: explicit original monitor ID and source
  description. Its scope remains an operator-selected process observation.

The client validates these inputs and retains their source descriptions and
hashes. Operator-supplied evidence is not represented as cryptographically
recovered signed provider material. Evidence cannot alter the original request,
configuration, source package, parent, upload key or part bytes.

## Concurrency and portable receiving

Producer/source changes use the foundation's `p.project_lock` / workspace.lock.
A running client holds one `remote/<operation>/operation.lock`. It takes the
ordinary package workspace lock only while publishing journal files or an atomic
current-state pointer. Network requests run outside that lock.

This permits the workbench to show local progress immediately and export a
consistent saved prefix. An export made during a request may correctly retain a
DISPATCHED/uncertain action; receiving that export does not turn it into an
unattempted action. Runtime lock files are excluded. Stop the original writer
before moving execution to another host; a filesystem lock is not a lock across
two independent copies.

Complete exports contain frozen source/review history, the original evidence
transfer, OPEX ZIP, all upload/readback journals, and the complete receiving
application. Export/receive verify every member's size, CRC and SHA. Existing
outputs are reconciled or refused if they represent a different revision; they
are not overwritten to hide later work.

The implementation's native ZIP limit is 4 GiB and portable snapshot limit is
8 GiB. The underlying research foundation still reads some original members in
memory. These are format/implementation bounds, not a measured throughput claim
or a 20 GB engagement promise. The initial commercial scope is limited to 1,000
bibliographic metadata records and 1 GiB source/export material, subject to the
agreed sample. Actual evidence for this source profile begins with the original
169-record example.

## What remains deployment-specific

The selected customer must provide an existing tenant, supported version,
authorized token reference, archival parent, security policy and an active
standard ingest configuration compatible with zipped OPEX. Actual tenant upload,
workflow acceptance and final repository readback must be recorded against that
deployment. The local native receiving journey demonstrates the complete
implemented package/HTTP/recovery/portable contract; it is labeled separately
from customer tenant acceptance.
