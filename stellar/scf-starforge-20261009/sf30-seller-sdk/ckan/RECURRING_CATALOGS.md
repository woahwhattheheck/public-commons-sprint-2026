# Recurring catalogue acquisition and accepted editions

Use the existing **Catalogue migration** workspace to receive a publisher's
current DCAT-US document, retain its complete source and HTTP history, and
review the next edition against an explicitly selected accepted release.
Source configuration, acquired documents, conversion reports, operator
corrections and release history travel together in the complete workspace.

This is the following-edition workflow in the original DCAT application.
The source acquisition keeps publisher documents; the migration engine makes
the review; the existing release operation selects the accepted candidate.
Each step keeps its original identity so another operator can reopen the
whole project and continue it.

## Open the installed workspace

Install and open the project using [Migration operation](MIGRATION_OPERATING.md).
Use **DCAT catalog migration** in the original Applications console, or:

~~~sh
starforge dcat serve --workspace /absolute/private/catalogue-project
~~~

Use the same configured Python runtime as the existing migration project.
[DCAT_ENGINE.md](DCAT_ENGINE.md) describes the original runtime, and
[PORTABLE_RUNTIME.md](PORTABLE_RUNTIME.md) describes the explicitly selected
portable profile. Acquisition and review use the same saved workspace and
operation owner as uploads, corrections, cutover and rollback.

## Add the original publisher source

In **Catalogue migration → Recurring catalogue sources**, choose **Add source**.
Enter a useful label, the publisher's document URL and its declared profile:

| Field | Meaning |
| --- | --- |
| Original publication URL | The actual document to retrieve, for example the publisher's complete data.json. |
| Document profile | auto detects the retained document; 1.1 and 3.0 are explicit declarations checked by the existing engine. |
| Private token environment name | Optional name of a token already configured in the private application environment. Save its name in the source. |
| Check interval | Whole minutes from 1 to 525,600; default 60. It determines when a source is due. |
| Request timeout | Whole milliseconds from 100 to 300,000; default 30,000. |
| Maximum response bytes | Whole bytes from 1,024 to 134,217,728; default 134,217,728. |
| Include this source in due checks | Enabled by default. Clear it to pause scheduled due selection while preserving manual acquisition. |

For a public example, the official
[data.gov GSA JSON record](https://catalog.data.gov/dataset/gsa-json)
identifies [https://gsa.gov/data.json](https://gsa.gov/data.json) as GSA's
published catalogue source. Acquire its actual current document. Its contents,
record counts and HTTP result are recorded when the operation runs.

Save the source and follow the original workspace operation. A newly allocated
source identity stays selected while its save finishes. Its saved source
configuration includes a sourceSha256, version history and the latest acquired
catalogue binding. The browser keeps the original draft available when an
unsuccessful save has not replaced it.

To change a source, choose **Edit selected source**. The editor binds the
configuration SHA inspected when it opened. If another operator changed that
configuration, retain the draft and reopen the current source before saving.
An actual configuration change starts a new version and clears that version's
current catalogue and conditional-request binding. Acquire the new version
before preparing a source review. All prior configuration versions, HTTP
attempts, documents and reviews remain retained.

The private token belongs in the same host or private Applications environment
used to launch the saved project. The browser accepts an environment-variable
name, not a token value. A receiving operator supplies that environment on the
destination host; the saved source retains the reference.

## Acquire and inspect the current document

Choose **Acquire current source edition**. The request binds both the current
sourceSha256 and expectedLatestCatalogId, including null before the first
document. Follow the shared operation progress above the migration view.

Public-source acquisition uses the retained HTTP conditional-request information
when it applies to the same source configuration. Credential-referenced sources
receive complete HTTP entities on each check, so a changed private credential
cannot inherit a previous credential's conditional result. **Request the current
document without conditional cache headers** explicitly requests a fresh
response. Every request still respects the retained publisher retry time.

Inspect the original acquisition history:

| Outcome | Operator continuation |
| --- | --- |
| FETCHING | Follow the active operation until the saved attempt completes. |
| ACQUIRED | A downloaded edition is retained and selected as the source's latest catalogue. Review it before cutover. |
| UNCHANGED | The received bytes match the retained catalogue. Inspect the original attempt and keep the linked catalogue. |
| NOT_MODIFIED | The publisher returned a conditional unchanged response linked to a verified retained catalogue. |
| FAILED | Inspect the saved error, HTTP receipt and any retained response; correct the cause and retry when allowed. |
| INTERRUPTED | Inspect the retained attempt and continue with its retry identity after the current operation has ended. |

The table shows started and completed times, HTTP status, response byte count
and completeness, the linked catalogue and the complete saved attempt.
Search by URL, attempt identity, catalogue or error; filter by outcome and page
through the complete history. **HTTP receipt** downloads the original request
and response history. **Original response** downloads its exact saved bytes.
A partial body is labeled **Retained incomplete response** and stays distinct
from a received catalogue.

The source shows lastCheckedAt, nextCheckAt and retryNotBefore. A Retry-After
response remains part of the source and attempt history. Acquisition and retry
controls are unavailable until that time; refresh the workspace when due.
For an unsuccessful attempt under the same configuration, **Retry this
acquisition** records retryOf rather than concealing the previous attempt.
Changing the source configuration preserves the old attempt and uses the new
configuration's own acquisition history.

**Download source configuration and history** includes the selected source,
all of its retained acquisitions and its saved review descriptors. The original
HTTP receipt and response files remain separately downloadable.

## Review against an accepted predecessor

The source panel reviews its latest acquired document. Its label, received
time and SHA-256 stay visible. Older documents remain available through the
ordinary retained catalogue and migration review controls below.

1. Choose an **Accepted predecessor release**, or explicitly leave
   **No accepted predecessor** for an initial review.
2. Read the selected release and its original review. **Open accepted
   predecessor review** displays that saved report; its candidate download
   retains the exact previously accepted bytes.
3. If that accepted report contains explicit identity mappings, select the
   decisions to carry into this edition. The complete typed identifiers and
   original JSON pointers are shown for each decision. The list is searchable
   and paged; selection uses each original zero-based mapping index.
4. If you have corrected the newly received document, upload that complete
   edited candidate through **Receive catalogue** and select it explicitly in
   **This edition's corrected candidate**. Otherwise the automatic candidate
   comes from the current acquired source.
5. Leave 3.0 normalization unchecked to preserve an already-3.0 document.
   Select it only for the existing explicit flat-3.0 normalization operation.
6. Choose **Prepare source edition review**, then follow the original
   operation. Its allocated review opens in the existing complete viewer.

The browser binds the accepted release's candidate SHA-256 and intrinsic
review SHA-256. Its mapping choices come from that release's complete
report.identity_mappings. With an automatic candidate, selected accepted
identifier decisions apply to the newly converted current source while its
other fresh fields remain intact. With an explicitly uploaded corrected
candidate, the engine preserves its bytes and resolves each selected decision
against the current source and candidate by exact typed identifier, catalog
scope and record role. Record paths may have moved. Missing or ambiguous
identities, overlapping choices and stale baseline hashes require a corrected
selection. Each review retains the newly resolved exact mapping pairs.

**Additional explicit identity mappings** accepts an optional JSON array for
this edition. Each row uses source_path, target_path, source_identifier and
target_identifier. Preserve actual typed JSON values: a string identifier
stays a string, and a structured identifier keeps its complete object. The
ordinary review viewer can build mappings from actual retained record rows.
Its exact JSON reader and writer preserve numeric tokens used in the source.

Changing the source version or latest catalogue opens a separate review
selection draft for that edition. Changing the accepted predecessor clears
the previous baseline's selected mapping indexes. **Download this review
selection** retains the chosen source, baseline and explicit decisions for the
operator's working record.

## Resolve findings and select the release

The prepared review uses the original GSA conversion and schema validation,
record conservation, full field changes, catalogue changes and successive
edition comparisons. Read all validation scopes and the complete source and
candidate identities. A corrections-needed review remains saved and readable;
a failed conversion can retain a full report without candidate bytes.

Correct an edited candidate or explicit identity mapping using
[MIGRATION_OPERATING.md](MIGRATION_OPERATING.md), then prepare a separate review.
The original acquisition, prior report and prior release remain inspectable.
A successful acquisition alone does not change the active release.

Use the existing **Select reviewed catalogue** operation after inspecting the
complete accepted candidate. It checks expectedActiveReleaseId and the selected
review/candidate hashes and records an immutable release. Download that exact
candidate for the customer's catalogue deployment process and record the actual
deployment context in the release note.

For rollback, choose the original historical release in the existing release
panel, inspect its original review and candidate hashes, and record the reason.
Rollback creates a new history entry selecting the prior candidate. It does not
remove the following acquisition, review or release. The selected active
catalogue is available through **Download active candidate** and the original
current-download endpoint.

## Run due checks through the existing scheduler

The saved interval supplies due information. The browser does not create a
background scheduler. Use the host's existing scheduled operation and the
original owner of the saved project.

### While the browser or managed application is running

Start the original server with a private startup record outside the portable
project:

~~~sh
starforge dcat serve \
  --workspace /absolute/private/catalogue-project \
  --startup-file /absolute/private/launch/catalogue-startup.json
~~~

The startup file's directory must belong to the operator and allow access only
to that owner. The record contains the original bearer URL; keep it in private
host configuration. The same original startup record may be selected from the
existing managed application's private output.

Invoke due checks through that running owner:

~~~sh
starforge dcat acquire-due \
  --workspace /absolute/private/catalogue-project \
  --startup-file /absolute/private/launch/catalogue-startup.json
~~~

The client verifies the original authenticated /api/launch instance, process
and project binding, dispatches only sources actually due through that server,
and follows each retained acquisition ID. A busy owner defers the check to the
next existing host invocation, preserving the operator's in-progress work.
The source interval and retained publisher retry limit remain effective.

### When the workspace is closed

The command can acquire the existing project lease itself:

~~~sh
starforge dcat acquire-due \
  --workspace /absolute/private/catalogue-project
~~~

Use this form only when the browser or managed application is not holding the
project. It selects enabled sources whose next-check and retained retry limits
allow a request and follows each original acquisition operation.

Pausing a source excludes it from due checks; its source and earlier editions
remain available, and an operator can still explicitly acquire it. A newly
configured or changed source is independently acquired and reviewed before a
new release is selected.

## Installed command workflow

Use the actual IDs and hashes returned by the saved project:

~~~sh
starforge dcat save-source \
  --workspace /absolute/private/catalogue-project \
  --label "GSA published catalogue" \
  --url https://gsa.gov/data.json \
  --profile auto \
  --interval-minutes 60

starforge dcat status --workspace /absolute/private/catalogue-project
starforge dcat source --workspace /absolute/private/catalogue-project --source SOURCE_ID

starforge dcat acquire \
  --workspace /absolute/private/catalogue-project \
  --source SOURCE_ID \
  --expected-source SOURCE_SHA256 \
  --expected-latest none
~~~

For a later acquisition, replace none with the inspected current catalogue ID.
To request the document without conditional headers, add --unconditional true.
To preserve an unsuccessful attempt's relationship, add --retry-of ACQUISITION_ID.

Updating a source requires --source and --expected-source together. The
required --label and --url state the complete current selection. Omitted
--profile and --token-env preserve those existing fields. Use
--token-env NAME to select a configured private environment variable;
--token-env none clears its reference. Set --enabled false to pause due checks.

Prepare the following-edition review with an accepted predecessor:

~~~sh
starforge dcat review-source \
  --workspace /absolute/private/catalogue-project \
  --source SOURCE_ID \
  --expected-source SOURCE_SHA256 \
  --expected-latest LATEST_CATALOG_ID \
  --baseline-release ACCEPTED_RELEASE_ID \
  --baseline-sha256 ACCEPTED_CANDIDATE_SHA256 \
  --baseline-review-sha256 ACCEPTED_REVIEW_SHA256 \
  --reuse-mappings 0,2 \
  --label "Following publisher edition"
~~~

Select only indexes actually present in the inspected accepted report.
Omit --reuse-mappings when carrying no prior decisions. Omit the three baseline
arguments for an initial review. Optional --candidate CATALOG_ID selects an
independently uploaded edited candidate; --mappings /absolute/decisions.json
supplies the exact typed mapping array; --normalize-v3 true selects explicit
normalization.

Download the original acquisition files:

~~~sh
starforge dcat export \
  --workspace /absolute/private/catalogue-project \
  --kind receipt --acquisition ACQUISITION_ID \
  --out /absolute/private/delivery/http-receipt.json

starforge dcat export \
  --workspace /absolute/private/catalogue-project \
  --kind response --acquisition ACQUISITION_ID \
  --out /absolute/private/delivery/original-response.bin
~~~

The existing inspect, cutover, rollback and original/candidate/report/current
export commands continue unchanged. Keep the intrinsic reviewSha256 distinct
from the SHA-256 of the full retained report file.

## Merchant agent continuation

Use the existing named CKAN workspace alias and original service lease.

| Tool | Original operation |
| --- | --- |
| merchant_ckan_dcat_status | Paged catalogues, reviews, releases, sources and acquisitions plus current operation. |
| merchant_ckan_dcat_source | Inspect sourceId, its current sourceSha256, history and original acquisition/review pages. |
| merchant_ckan_dcat_source_save | Save label, url, profile and acquisition settings; updates bind sourceId and expectedSourceSha256. |
| merchant_ckan_dcat_source_acquire | Bind sourceId, expectedSourceSha256 and expectedLatestCatalogId; optionally unconditional or retryOf. |
| merchant_ckan_dcat_source_review_prepare | Bind current source and latest catalogue, the chosen baseline release and its two hashes, optional exact reuseMappingIndexes and this edition's candidate/mappings. |
| merchant_ckan_dcat_files | Select acquisition-receipt or acquisition-response with itemId set to the original acquisition ID. |
| merchant_ckan_dcat_file_read | Read the selected complete file with expectedSha256, readId and the returned nextOffset. |

Mutations also bind expectedOperationId from merchant_ckan_status. Follow the
original operation and returned sourceId, acquisitionId or reviewId before
using its results. The existing review section reader, file release, cutover,
rollback and complete workspace archive/receive tools remain the continuation.

For large explicit mapping documents, use the original mappingsInput alias of
kind dcat-mappings with expectedMappingsSha256, or provide identityMappings
directly. Carry the complete original JSON values through the exact parser.
Page each collection to its returned terminal marker; the original full file
download remains available when a displayed row exceeds its response page.

## Hand over and reopen the complete project

Choose **Open complete workspace handover** in Catalogue migration. Workspace
shows the DCAT source, acquisition, catalogue, review and release counts, even
when they are part of a mixed CKAN project. Export the original complete .ckanw
archive and retain its actual SHA-256. It includes source configuration
versions, the acquired original files and receipts, independent reviews,
corrected candidates and the complete release/rollback history.

Receive it through the existing Workspace control or:

~~~sh
starforge dcat archive \
  --workspace /absolute/private/catalogue-project \
  --out /absolute/private/delivery/catalogue-project.ckanw

starforge dcat receive \
  --file /absolute/private/delivery/catalogue-project.ckanw \
  --sha256 COMPLETE_ARCHIVE_SHA256 \
  --workspace /absolute/private/received-catalogue

starforge dcat serve --workspace /absolute/private/received-catalogue
~~~

On the receiving host, select the same explicit Python runtime profile and
configure any referenced private token environment. Open the received source,
its previous configuration versions and HTTP history, the selected accepted
review and active release. Download an original acquired document and its
receipt from that same received project, then continue with a new acquisition
against the retained latest-catalogue identity.

Reopening the project preserves the original source and document lineage.
Receiving the same complete archive continues its original operation and saved
destination according to the existing workspace receiver.

## HTTP reference

All endpoints use the original authenticated server and shared operation owner.

| Route | Body or result |
| --- | --- |
| POST /api/dcat/sources/save | id and expectedSourceSha256 on update; label, url, profile, authTokenEnv, intervalMinutes, timeoutMs, maxResponseBytes and enabled. |
| GET /api/dcat/sources/:id | Complete source, acquisitions and associated saved review descriptors. |
| POST /api/dcat/sources/acquire | sourceId, expectedSourceSha256, expectedLatestCatalogId, optional unconditional and retryOf. |
| GET /api/dcat/acquisitions/:id/receipt | Exact retained HTTP receipt. |
| GET /api/dcat/acquisitions/:id/response | Exact retained response bytes, with complete or partial status in the attempt. |
| POST /api/dcat/sources/review | sourceId, expectedSourceSha256, expectedLatestCatalogId, baselineReleaseId; selected baseline's expectedBaselineSha256 and expectedBaselineReviewSha256; optional reuseMappingIndexes, candidateId, identityMappings, normalizeV3 and label. |
| GET /api/dcat/sources-guide | This complete operating guide. |

Save, acquire and review responses expose the original operationId and the
allocated sourceId, acquisitionId or reviewId. GET /api/status retains the
existing operation and complete DCAT inventories. The original upload, complete
review, exact document/report download, cutover, rollback and archive routes
remain the rest of this same customer workflow.
