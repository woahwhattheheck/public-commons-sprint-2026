# Preservica research package and receiving guide

This workflow carries a saved bibliographic review into a native OPEX ingest
package, then keeps the original upload and repository verification together.
Use the common browser workbench for source review and saved operations, or the
Python commands below. Both routes call the same producer and client.

The original example contains 169 CC0 OpenAlex metadata records. Each included
record becomes one JSON content asset with reviewed Dublin Core. Paper full text
and publisher attachments are outside this source profile. The existing source
export, selected decisions, corrections, exclusions and complete review ancestry
remain in the final handoff.

Read [PRESERVICA_PROVIDER_CONTRACT.md](PRESERVICA_PROVIDER_CONTRACT.md) for exact
endpoint, response, source and version boundaries, and [WORKBENCH.md](WORKBENCH.md)
for the shared browser flow. The separate engagement proposal is not an API or
deployment-readiness guarantee.

## Before receiving

Use Python 3.11 or later on Linux with the complete application directory. The
producer and client use the standard library and the existing preservation
foundation. No vendor SDK installation, account creation or hosted CI is needed.

For an actual repository operation, select one existing tenant and its supported
major/minor API version. Obtain the original archival-parent UUID or deliberately
select the tenant root; confirm its standard zipped-OPEX ingest configuration and
security policy. Supply an authorized current access token through an
environment variable on the receiving host. Put only that variable's name in the
configuration and browser.

The documented zipped OPEX profile requires Preservica 6.2 or later. The actual
tenant version is checked before upload. A template containing an example origin
or tenant cannot be saved as a real operation.

## 1. Open the original source and save the review

Run commands from the directory containing `preservation.py`,
`preservica.py` and `preservica_client.py`.

```bash
python3 preservation.py init \
  --source /path/to/OpenAlex_CIIM_Source_Example_20261012.zip \
  --prefix source-export \
  --workspace /path/to/source-workspace

python3 preservation.py show --workspace /path/to/source-workspace

python3 preservation.py review-template \
  --workspace /path/to/source-workspace > /path/to/review.json
```

Edit the review document using the existing schema. Record a reason when
correcting metadata or excluding a work. The source record and original
metadata remain preserved. Then save against the revision you actually read:

```bash
python3 preservation.py review-save \
  --workspace /path/to/source-workspace \
  --input /path/to/review.json \
  --expected-revision 0
```

The command returns the new revision. A stale revision refuses the save; reload
the current review and retain the later user's changes. The browser uses the
same revision check.

A complete immutable review file can survive a crash before the current pointer
is updated. The Preservica producer follows the selected pointer and exact
previous-review hashes to freeze the committed chain. Other complete candidates
remain explicitly unpublished; their presence does not erase or block the
selected review.

## 2. Prepare a native package at that exact revision

```bash
python3 preservica.py settings-template > /path/to/preservica-settings.json
```

The normalized settings object is:

```json
{
  "schema": "stellar-forge.preservica-package-settings.v1",
  "title": "Reviewed research metadata",
  "description": "Original bibliographic metadata with source provenance and explicit review decisions.",
  "securityTag": null,
  "sourceIdNamespace": "urn:commons:research",
  "sourceIdPolicy": "edition-record",
  "opexNamespace": "http://www.openpreservationexchange.org/opex/v1.0",
  "targetPreservicaVersion": null
}
```

Use an existing security tag, or leave it null to preserve documented inheritance.
An optional target version binds the package to that selected major/minor; a
null version means the tenant has not yet been selected. Package verification
does not imply that a null-version package has been accepted by any deployment.

Prepare from the actual saved revision, for example revision 1:

```bash
python3 preservica.py prepare \
  --workspace /path/to/source-workspace \
  --out /path/to/preservica-package-r1 \
  --expected-revision 1 \
  --settings /path/to/preservica-settings.json

python3 preservica.py verify \
  --workspace /path/to/preservica-package-r1
```

The prepared directory includes:

| File or directory | Use |
| --- | --- |
| `transfer.zip` | Native zipped OPEX payload for the selected upload. |
| `original.zip` | Complete original reviewed-source transfer and provenance. |
| `source-workspace/` | Reopenable source, current review, committed history and retained unpublished candidates. |
| `catalog.json` / `catalog.csv` | All original records, review decisions, SourceIDs and exact native paths/byte identities. |
| `review.html` | Standalone readable source/package review. |
| `settings.json` | Normalized selected package settings. |
| `source-members.json` | Original evidence-member identities. |
| `handoff.json` / `MANIFEST.json` | Source/review/native-format identity and complete immutable prepared inventory. |
| `remote/` | Created later for saved upload, progress and readback operations. |

Verification regenerates the expected OPEX metadata from the retained source
and selected review, then checks every native member and its bytes. This is
package verification; the initial repository state is `NOT_SUBMITTED`.

Preparing again into the same destination with exactly the same source,
revision and settings reopens the original package. A changed selection requires
a new destination. To compare two prepared editions:

```bash
python3 preservica.py compare \
  --before /path/to/preservica-package-r1 \
  --after /path/to/preservica-package-r2
```

## 3. Save an explicit repository operation

Generate and edit the client configuration:

```bash
python3 preservica_client.py configuration-template \
  > /path/to/preservica-configuration.json
```

The complete field set is:

```json
{
  "schema": "stellar-forge.preservica-configuration.v1",
  "origin": "https://YOUR-TENANT.preservica.com",
  "tenant": "YOUR_TENANT",
  "targetVersion": "9.3",
  "accessTokenEnv": "PRESERVICA_ACCESS_TOKEN",
  "parentRef": null,
  "uploadMode": "auto",
  "partBytes": 8388608,
  "requestTimeoutSeconds": 60,
  "maxResponseBytes": 8388608,
  "readbackBatchSize": 25
}
```

Replace the example tenant, origin and version with the actual agreed deployment.
Choose the real parent. The template is deliberately rejected until the
placeholders are replaced. Unknown configuration fields and literal credentials
are rejected. The access token's value belongs only in the authorized runtime
environment.

Save one stable original operation ID:

```bash
python3 preservica_client.py plan \
  --workspace /path/to/preservica-package-r1 \
  --configuration /path/to/preservica-configuration.json \
  --operation-id research-ingest-20261012

python3 preservica_client.py show \
  --workspace /path/to/preservica-package-r1 \
  --operation-id research-ingest-20261012
```

Planning is offline. It binds the source, review, native archive, target, parent,
token-environment reference, upload mode and original object key. It does not
upload or sign in. Reusing the operation ID with different settings refuses the
change. Keep this same ID for normal run, refresh and reconciliation.

## 4. Run the original upload and complete receiving

Once the selected environment contains the authorized current token:

```bash
python3 preservica_client.py run \
  --workspace /path/to/preservica-package-r1 \
  --operation-id research-ingest-20261012
```

The client verifies the package, reads the selected tenant version and parent,
and checks the original unique upload key. It retains each original request
before dispatch and its response before interpreting the provider result.

A small ZIP uses one PUT in auto mode. Multipart mode retains its original
upload ID and each part's exact range, SHA and ETag. A part may resend the same
bytes to the same part number after transport loss. Initialization and completion
remain their original operations; a lost response does not cause a replacement
upload or another completion.

After upload, the same invocation observes progress and processes all repository
records that are ready. It saves progress every configured batch. A batch size
of 25 does not require seven manual submissions for the 169-record example.

For each included work, receiving verifies:

1. The exact SourceID returns one information object.
2. The object has the selected records-folder parent, expected title, retained
   original identifier and any explicitly selected security tag.
3. The returned metadata fragment contains the reviewed DC values with the same
   field/value multiplicity.
4. The original preservation content has the expected filename, byte size and
   SHA-256 fixity.
5. A full streamed content read produces the original source bytes' SHA-256.

The package and records folders are also verified against their original
SourceIDs and selected parent. A completed upload or successful process status
does not replace these checks.

The result is JSON containing `state`, `transfer`, `ingest`,
`readback`, `actions`, `retryAt`, safe target observations and next actions.
The workbench renders the same result. Local status reads remain available
while the background client holds its separate operation lock.

| Observed state | Meaning and normal next action |
| --- | --- |
| `PLANNED` | Saved offline selection; use run after the agreed access is ready. |
| `UPLOADING` | Original upload action is active or retained before dispatch completion. |
| `UPLOAD_UNCERTAIN` | Original response/dispatch needs reconciliation; do not create a replacement operation. |
| `INGESTING` | Upload/progress is pending or source entities are not yet available. |
| `VERIFYING` | Some original records are received; unresolved source or content checks remain. |
| `COOLDOWN` | Provider Retry-After is saved. Continue after that time using the same operation. |
| `AUTH_REQUIRED` | Supply a fresh authorized token in the same named environment variable. |
| `INTERRUPTED` | Cancellation was observed between/within requests; inspect the retained original action and continue. |
| `NEEDS_REVIEW` | Version, response or source contract needs a concrete operator/source decision. |
| `INGEST_FAILED` | Original progress reports failure or mixed outcome. Existing per-file evidence remains. |
| `VERIFIED` | Both source folders and every included record have complete retained receiving evidence. |

## 5. Observe or reconcile without repeating an unknown write

```bash
python3 preservica_client.py refresh \
  --workspace /path/to/preservica-package-r1 \
  --operation-id research-ingest-20261012
```

Refresh performs provider reads and local evidence updates. It does not issue
an upload PUT or multipart initialization/completion POST. It resumes unresolved
record verification and reuses previously verified immutable receiving receipts.
Those receipts describe when the content was observed; they do not claim
continuous monitoring of later repository changes.

A lost initialization/completion response can be recovered from the actual
original response retained by the operator or another authorized system:

```bash
python3 preservica_client.py reconciliation-template --kind original-response \
  > /path/to/original-response.json
```

Fill the template with the exact original operation ID, action and request SHA
shown in `show.actions`; the original HTTP status and safe headers; base64 of
the complete original response XML; its observation time; and a description of
its retained source. Do not include authentication headers or cookies. Do not
construct a successful response from guessed IDs.

```bash
python3 preservica_client.py reconcile \
  --workspace /path/to/preservica-package-r1 \
  --operation-id research-ingest-20261012 \
  --evidence /path/to/original-response.json
```

The XML still must name the original bucket/key and upload identity. Reconcile
retains the earlier uncertainty and new source receipt. It cannot change the
original package, parent, request, byte ranges or configuration.

Two additional templates are available:

```bash
python3 preservica_client.py reconciliation-template --kind progress-observation
python3 preservica_client.py reconciliation-template --kind process-observation
```

A progress observation binds a token from the original upload response to the
same original request and key. A process observation explicitly selects a
returned monitor ID and records its source. The client does not equate progress
tokens with process IDs or infer a process from matching titles/times. Monitor
IDs remain observed receipts; they may change across product releases.

A 404 for an old progress token or upload key does not prove that a prior upload
never happened. A missing or contradictory response stays visible while source
readback and the original provider evidence are reconciled.

## 6. Export the complete operation and reopen it

Stop the original writer before handing execution to another host. The export
can capture a consistent saved prefix during an active request, but two copied
workspaces do not share a filesystem lock.

Use a new filename for a later journal/review snapshot:

```bash
python3 preservica.py export \
  --workspace /path/to/preservica-package-r1 \
  --out /path/to/Research_Preservica_Receiving_20261012.zip

python3 preservica.py receive \
  --source /path/to/Research_Preservica_Receiving_20261012.zip \
  --out /path/to/received-research
```

The complete export contains the prepared package and original evidence, editable
source/review history, upload/progress/readback journals, all reports and the
complete receiving application. Every member is checked by name, length, CRC and
SHA-256. Runtime locks and private unfinished writes are omitted. Existing
exports are reused only if their exact original contents match; later state
needs a new filename.

The received package is under `received-research/workspace/`, with the
application under `received-research/application/research/preservation/`.
Supply the same authorized token environment reference on the receiving host,
then use its included client:

```bash
python3 /path/to/received-research/application/research/preservation/preservica_client.py show \
  --workspace /path/to/received-research/workspace \
  --operation-id research-ingest-20261012

python3 /path/to/received-research/application/research/preservation/preservica_client.py refresh \
  --workspace /path/to/received-research/workspace \
  --operation-id research-ingest-20261012
```

A retained unknown dispatch remains unknown in the received workspace. Refresh
and original-response evidence provide the same recovery paths. Restoring a
package does not silently submit it to a different tenant.

## Callable interface for integrations

```python
import preservica
import preservica_client

settings = preservica.validate_settings(selected_settings)
prepared = preservica.prepare(
    source_workspace, package_workspace, expected_revision,
    settings=settings,
)
preservica.verify_workspace(package_workspace)

configuration = preservica_client.validate_configuration(selected_configuration)
planned = preservica_client.plan(package_workspace, configuration, operation_id)
status = preservica_client.show(package_workspace, operation_id)

result = preservica_client.run(
    package_workspace, operation_id, cancelled=cancelled_callback,
)
observed = preservica_client.refresh(
    package_workspace, operation_id, cancelled=cancelled_callback,
)
reconciled = preservica_client.reconcile(
    package_workspace, operation_id, original_evidence,
    cancelled=cancelled_callback,
)
exported = preservica.export(package_workspace, output_zip)
received = preservica.receive(output_zip, receiving_directory)
```

Validators return normalized dictionaries. The source foundation's
`p.project_lock` protects review/package changes. Client run/reconcile has a
separate operation lock and takes the ordinary package lock only while
publishing journals/state. The browser's nonblocking status path is the same
`preservica_client.show` function.

## Limits and acceptance record

The native ZIP bound is 4 GiB and the portable snapshot bound is 8 GiB; these are
implementation limits, not throughput measurements. Some original-source
foundation paths still load members into memory. The proposed initial engagement
therefore uses a narrower envelope: up to 1,000 bibliographic metadata records
and 1 GiB source/export material, subject to the supplied sample and selected
deployment.

The full original 169-record native receiving operation records package
verification, actual local HTTP upload/recovery, source/entity/DC/file/fixity
checks and portable reopen. Its receipt must say explicitly whether the endpoint
was the local contract service or an agreed Preservica tenant. No local outcome
should be presented as a customer tenant ingest.

For an actual delivery retain the final source manifest, package and journal
snapshot, original operation ID, actual endpoint/version, target parent, complete
record/file counts, unresolved exceptions, all observed source/fixity receipts,
and the original provider/process IDs with their proper scopes. Preserve the
unchanged historical source alongside any later review or receiving edition.
