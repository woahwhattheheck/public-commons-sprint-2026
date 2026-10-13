# Catalogue migration and operating handover

Receive a complete DCAT-US catalogue, keep the publisher's original bytes, review
the candidate produced by the original GSA converter, and select the accepted
catalogue release. The saved workspace retains source editions, independent
reviews, corrected candidates, release decisions and rollback history together.

The same project opens in the existing CKAN data-product application. Its
**Catalogue migration** section operates on explicitly declared DCAT-US
documents. The other catalogue, capture, publication, merchant, refresh and
workspace sections keep their original functions. A DCAT-US project opens the
migration section first.

## Install and open the project

Use the existing CKAN product installation described in
[the product operating guide](../../../../products/ckan/OPERATING.md).
The installed source contribution includes the additional **dcat** command.
Its migration engine uses the selected Python runtime and the original pinned
GSA converter and schema dependencies. Set **SCF_DCAT_PYTHON** to the prepared
Python executable when it is installed at a specific path; the default is
**python3.13**. An actual Python 3.12 host can explicitly select
**SCF_DCAT_RUNTIME_PROFILE=portable-python312** with the same prepared interpreter.
[The portable setup guide](PORTABLE_RUNTIME.md) includes the complete original locked
package selection and native runtime check. Setting only **SCF_DCAT_PYTHON** keeps
the **original** Python 3.13 profile. Keep that runtime with the immutable installed application
revision used for the customer delivery. The complete
[engine setup guide](DCAT_ENGINE.md) gives the exact original dependency
selection and Python preparation commands.

Initialize a private workspace with its actual publisher origin:

~~~sh
starforge dcat init \
  --workspace /absolute/private/catalogue-project \
  --origin https://open.gsa.gov

starforge dcat serve \
  --workspace /absolute/private/catalogue-project
~~~

Open the authenticated local URL returned by the running application.
The project declares its source kind as **dcat-us**. Its publisher origin
identifies the source of the documents; receiving and reviewing those documents
uses the migration workflow below.

The checkout form of an installed command is
**node stellar/scf-starforge-20261009/distribution/cli.mjs dcat …**.
Use the same installed source revision and private workspace throughout an
operation. The browser shares the original workspace owner. Stop that owning
application before using a separate standalone CLI process to mutate the same
project.

## Open through managed Applications

Prepare the installed native runtime and the original Python dependencies using
[DCAT_ENGINE.md](DCAT_ENGINE.md), then initialize the private project with
**starforge dcat init** as above. In the existing Applications console, select
**DCAT catalog migration** and the same installed runtime.

| Application field | Selected value |
| --- | --- |
| Catalogue workspace | The absolute directory of the initialized DCAT-US project. |
| Port | Use 0 for an available local port, or the specific local port required by the operator. |
| Private environment file | The existing private JSON environment file, when the selected Python executable or other host settings need explicit values. |

A private environment file can select the prepared interpreter:

~~~json
{
  "SCF_DCAT_PYTHON": "/absolute/private/dcat-python/bin/python"
}
~~~

Keep that file private to the operating account. The original Applications
environment loader reads it at preparation and launch. A bare default
**python3.13** is resolved through that same environment's PATH; use an absolute
**SCF_DCAT_PYTHON** path when the customer delivery needs a particular prepared
interpreter. For prepared Python 3.12, add
**"SCF_DCAT_RUNTIME_PROFILE": "portable-python312"** to that same private JSON
object. The interpreter path and profile are both bound into the application
selection and checked again against the authenticated running workspace.

Use the ordinary **Review → Save → Start → Open** flow. The preparation binds the
project's original directory, creation time, publisher origin and DCAT-US source
kind; it also retains the selected source files, managed runtime and executable.
The workspace's changing catalogue, review and release history stays inside that
same project. Opening it on a later day continues that history.

The saved URL appears when the original authenticated application confirms its
process, instance and project identity. The **Open** action reaches the existing
browser with **Catalogue migration** selected. Use **Stop** before opening the
same project through a separate standalone command that changes its contents.
After replacing the installed source, Python runtime or selected environment,
review and save the current application selection before starting it again.

The neighbouring **CKAN data merchant** entry keeps its original merchant
configuration and project-alias workflow. Choose **DCAT catalog migration** for
a document-migration workspace initialized with **starforge dcat init**.

## Acquire following publisher editions

The same migration section includes **Recurring catalogue sources**. Save the
publisher's original document URL, profile, private token environment reference
when needed, request limits and due-check interval. Acquire the current complete
document, inspect its original HTTP history, and review its latest edition
against an explicitly selected accepted release. Choose each accepted identity
decision to carry forward; newly edited candidates remain explicit inputs.
Source configuration versions, acquisition receipts and responses, reviews and
release decisions travel together in the complete workspace.

Use [Recurring catalogues](RECURRING_CATALOGS.md) for the complete source editor,
conditional acquisition, publisher retry handling, exact baseline mapping
selection, installed commands, agent interfaces and receiving continuation.
The controls below continue to receive documents supplied directly as files.

## Receive the original catalogue

Open **Catalogue migration → Receive an original catalogue document**.

1. Give the document a meaningful label, such as the publisher and acquisition
   date.
2. Select the source profile: detect from the retained document, DCAT-US 1.1, or
   DCAT-US 3.0.
3. Record the actual publisher URL or source reference associated with this
   acquisition.
4. Choose the complete original JSON file.
5. Select its intended use: source for a new review, preceding catalogue
   edition, or operator-corrected candidate.
6. Choose **Receive catalogue document** and follow the original operation
   shown above the workspace.

The received document has its own catalogue ID, byte count, SHA-256, label,
profile, origin and received time. The original bytes remain available through
the saved review's download controls. Repeated publisher acquisitions become
separate retained documents, so a later review can name the exact edition it
compares.

The equivalent import command is:

~~~sh
starforge dcat import \
  --workspace /absolute/private/catalogue-project \
  --file /absolute/private/source/publisher-catalogue.json \
  --profile auto \
  --label "Publisher catalogue — acquisition date" \
  --origin https://open.gsa.gov/data.json
~~~

Use the catalogue ID returned by that actual operation in subsequent commands.
Preserve the original acquisition file and its source reference alongside the
workspace handover.

## Prepare an independent review

Under **Prepare a complete migration review**, choose:

| Selection | Purpose |
| --- | --- |
| Original source | The complete publisher document being migrated or accepted. |
| Preceding catalogue edition | An optional, separately retained document used to inspect changes across publisher editions. |
| Candidate source | The original converter or preserved 3.0 source by default; select another received document when reviewing an operator correction. |
| Normalize a flat DCAT-US 3.0 catalogue | An explicit request for the original 3.0 normalization. Leave it off for the default preserved-source review. |
| Review label | A useful name for this exact selection and review. |
| Explicit identity changes | Optional verified mappings for deliberately changed dataset or series identifiers. |

Choose **Prepare migration review**. Each preparation records a new saved
review with its own source, comparison, candidate and review identities.
Preparing a correction leaves the earlier review available in **Saved review**.

The engine converts a selected 1.1 catalogue through the original converter.
An already 3.0 document follows its corresponding preserved-source review by
default. To request the original normalization of a flat 3.0 catalogue, select
**Normalize a flat DCAT-US 3.0 catalogue** and prepare a separate review. The
review retains this explicit selection and every resulting change. A supplied
operator-corrected candidate follows its own review of the retained bytes.
The returned conversion state, messages and original exception explain the
actual result. The source, candidate and comparison each have their own
validation result.

A conversion that cannot produce a candidate still becomes a saved review with
its original error and validation results. **Download complete review** and the
original-source download remain available. Receive a corrected complete document
and prepare another review to continue; candidate download, identity mapping
against that candidate, and cutover become available when candidate bytes exist.

For a source-only review:

~~~sh
starforge dcat review \
  --workspace /absolute/private/catalogue-project \
  --source RECEIVED_SOURCE_ID
~~~

For a following edition with a retained predecessor:

~~~sh
starforge dcat review \
  --workspace /absolute/private/catalogue-project \
  --source FOLLOWING_SOURCE_ID \
  --comparison PRECEDING_SOURCE_ID
~~~

Use the saved review ID returned by the operation. The complete original
engine report carries a **review_sha256** binding its selected inputs and
result.


For explicit 3.0 normalization:

~~~sh
starforge dcat review \
  --workspace /absolute/private/catalogue-project \
  --source RECEIVED_3_0_SOURCE_ID \
  --normalize-v3 true
~~~

The default is false. Inspect the returned **normalize_3_0** or
**preserve_3_0** mode with the complete validation and field changes.
Changing this choice changes the automatic candidate, so identity-mapping drafts
remain bound to the original source, candidate and normalization selection.

## Read the review in a useful order

### Overview

Overview shows the saved review, original conversion result, issues, declared
source identities and candidate identity. It retains the full engine report
behind **Complete original engine report**.

The source and candidate SHA-256 values identify different artifacts whenever
conversion or correction changes the bytes. Candidate origin records whether
the engine converted the source, preserved it, or reviewed an operator-selected
candidate. The source label and declared origin remain visible beside those
identities.

**Engine review SHA-256** binds the engine's reviewed result. The saved review's
**reviewSha256** and **summary.reviewSha256** both contain that same intrinsic
**review_sha256**. **Saved report file SHA-256**, retained as **reportSha256**,
identifies the complete downloaded report bytes. Check downloads against the
file hash; use the intrinsic review hash when recording a release decision.
The browser retains original numeric values, including large integers and long
decimals, throughout report display and typed identifier mapping. New reviews
identify their exact decimal comparison as **numeric_comparison: exact-decimal.v1**.
They compare the values from the retained source and candidate independently of
the unchanged GSA converter. If conversion rounds a decimal value, its before
and after values appear as a field change for the original record. Existing
saved reviews keep their original report bytes, hashes and release associations;
prepare a new review of the same retained sources to obtain the corrected comparison.
Catalogue, review and release lists show local dates; complete saved identities
and downloaded files retain their exact recorded timestamps.

The engine's **can_receive** result controls candidate selection. If the
candidate needs correction, use its validation and conservation results to
prepare that correction and run a new review. A review that is ready for
receiving still needs an operator's actual cutover decision.

### Validation

Read **Original source validation**, **Candidate validation**, and, when
selected, **Preceding edition validation** separately.

Each result retains the original schema ID, validator state, record results and
exception. The view shows actual checked, valid and invalid record counts.
Catalogue, individual-record and nested-catalogue errors share one searchable
issue browser; equivalent path/rule/message occurrences are grouped while their
original schema paths and contexts remain available. Every reported error includes its document path, schema path,
validator name, message and full context. The interface filters by path or
message and by validation rule. It pages through the complete retained error
array, 25 issues at a time.

A path points into the original document associated with that result. Correct
the selected candidate's actual value or structure, then receive that complete
candidate and create a new review. Preserve the source report so the operator
can explain the correction later.

### Record conservation

**Record conservation** shows how each dataset or dataset series travels from
the source to the candidate. Its counts include source records, candidate
records, matched identities, missing identities and added identities.

Open the complete identity mappings to inspect:

- Source and target record pointers.
- Original and target identifiers.
- Dataset or series roles and catalogue locations.
- Whether the engine matched the original identity or used an explicit mapping.
- Relocation and changed-field information.

Missing records, added records, duplicate identities and unidentified records
remain visible with their original descriptors. Duplicate and unidentified
results keep their source and candidate sides separate.

**Review converted fields** filters the complete records by identifier, field
path, record type and change type. Every row retains its source and candidate
paths, classification and complete values. Expand a record to inspect its
fields. The view pages through records without removing them from the saved
report.

The value display distinguishes an absent property, JSON null, an empty
string, arrays and nested objects. These values can carry different meaning in
a catalogue. Review the actual change and the converter's classification before
making a correction.

### Successive editions

This section keeps publisher-edition changes separate from conversion changes.
It provides two views when the comparison is available:

| Comparison | Left-hand document | Right-hand document |
| --- | --- | --- |
| Original source and preceding edition | The selected source being reviewed | Its separately supplied preceding catalogue edition |
| Reviewed candidate and preceding edition | The candidate from this review | That same preceding catalogue edition |

The labels follow the original engine's comparison direction. **Only in
source** and **Only in comparison** refer to those exact sides. Use the retained
identifiers and source dates when deciding whether the publisher added,
removed or changed a dataset over time.

Each view retains full conservation, field changes and catalogue-level changes.
Filter by an actual identifier or nested field path to inspect, for example,
publisher, licence, access-rights or distribution changes without losing the
complete other records. Download the full report when a receiving operator
needs every comparison value in one file.

## Correct a candidate without losing its history

When the saved review contains a candidate, use **Download candidate** to obtain
its exact bytes and keep that file. Make the intended correction in another
complete JSON document. If the original conversion failed before producing a
candidate, keep its complete review and original source, and prepare the
corrected full document from that source and its reported conversion errors.

Receive the corrected document through the same upload form:

1. Give the correction its own label and source reference.
2. Choose its declared profile.
3. Select **Operator-corrected candidate** as its intended use.
4. Complete receiving.
5. Keep the original publisher document selected as **Original source**.
6. Select the new received document as **Candidate source**.
7. Keep the same predecessor when that comparison remains relevant.
8. Add only the explicit identity mappings needed for intended identifier
   changes.
9. Prepare a new review and inspect its validation, conservation and field
   changes.

The source, original converter output, corrected candidate and each review
remain separately addressable. A later operator can reconstruct what changed
and why.

### Deliberately change an identifier

The mapping editor has four fields for each intended identity change:

| Field | Required original value |
| --- | --- |
| source_path | Exact JSON pointer of the source record. |
| target_path | Exact JSON pointer of the candidate record. |
| source_identifier | Identifier actually present at the source pointer. |
| target_identifier | Identifier actually present at the target pointer. |

Select actual source and candidate records from a conservation review that
matches the current source and candidate selection, or enter their exact values.
Prepare a candidate-producing review or select a separately received corrected
candidate before adding mappings. A draft remains associated with its selected
source, candidate and normalization mode; return to that selection or use **Clear draft mappings**
before entering mappings for different documents. Identifier fields accept JSON: a plain
identifier is a quoted JSON string, while a structured Identifier retains its
complete object, including every original property. The field editor displays
an @id or notation label when available and retains the full typed value.
Record-pointer fields remain exact text JSON pointers.

The engine verifies the selected paths and values. A mapping records intended
identity continuity while preserving the original identifiers and locations.

For a CLI review, save the actual mappings as a JSON array in a private file:

~~~json
[
  {
    "source_path": "/dataset/0",
    "target_path": "/dataset/0",
    "source_identifier": "the-actual-original-identifier",
    "target_identifier": "the-actual-corrected-identifier"
  }
]
~~~

The illustrative values above must be replaced with the original document's
values. Then run the same review selection:

~~~sh
starforge dcat review \
  --workspace /absolute/private/catalogue-project \
  --source RECEIVED_SOURCE_ID \
  --comparison PRECEDING_SOURCE_ID \
  --candidate CORRECTED_CANDIDATE_ID \
  --mappings /absolute/private/source/identity-mappings.json
~~~

An ordinary field correction that preserves identity uses the same corrected
candidate flow with no mapping file.

## Select the reviewed catalogue release

Open **Cutover & rollback** on the exact saved review.

Read the current selected release and the candidate's receiving result. Record
the operator, reviewed exceptions, intended scope and cutover decision in the
note. Choose **Select this reviewed candidate**.

The workspace requires the expected current active-release ID. Its first
cutover uses null; following decisions name the currently active release. The
browser also supplies the selected review's intrinsic **reviewSha256** and
**candidateSha256**. If another operator changes that selection, refresh the
workspace and review the current release before saving the next decision.

A completed cutover creates an immutable release entry containing the review,
preceding release, candidate SHA-256, time and operator note. Its reviewed
candidate becomes the active downloadable catalogue.

The equivalent first selection is:

~~~sh
starforge dcat cutover \
  --workspace /absolute/private/catalogue-project \
  --review REVIEW_ID \
  --expected-active none \
  --review-sha256 ENGINE_REVIEW_SHA256 \
  --candidate-sha256 CANDIDATE_FILE_SHA256 \
  --note "Operator and actual reviewed cutover decision"
~~~

For a following cutover, replace **none** with the actual active release ID
returned by the current project. Supply the selected saved review's actual
**reviewSha256** and **candidateSha256** for the optional CLI hash flags shown
above, and preserve the returned release and candidate identities.

The browser's active-release download is bound to that saved release's review.
The authenticated **/api/dcat/current/download** endpoint serves the workspace's
currently active catalogue. Complete release history keeps the preceding
candidate accessible for restoration.

### Apply the release to the customer's catalogue service

Use the saved candidate's exact bytes as the input to the customer's existing
catalogue deployment process. The useful handover sequence is:

1. Retain the currently deployed catalogue artifact and the deployment
   configuration needed to restore it.
2. Download the selected review's exact candidate and keep its SHA-256 and
   release identity.
3. Apply that candidate through the existing catalogue service's normal
   deployment path.
4. Read the deployed catalogue back through its ordinary public or authenticated
   endpoint and compare it with the selected candidate and service behavior.
5. Record the deployed URL, deployment operation, operator and actual result
   with the customer handover.

The workspace selection and customer deployment have separate operating
identities. Keeping them together in the handover makes the selected release
and its actual service deployment easy to follow.

## Restore a prior release

Choose the prior release in **Restore a prior catalogue release**. Record the
operator and rollback reason, then choose **Restore selected prior release**.

The operation checks the expected active-release ID and creates a new history
entry selecting the prior candidate. It retains the release being replaced and
its original review. The complete history links each review and allows the
operator to open it directly.

The CLI uses the same original saved releases:

~~~sh
starforge dcat rollback \
  --workspace /absolute/private/catalogue-project \
  --release PRIOR_RELEASE_ID \
  --expected-active CURRENT_RELEASE_ID \
  --review-sha256 PRIOR_RELEASE_REVIEW_SHA256 \
  --candidate-sha256 PRIOR_RELEASE_CANDIDATE_SHA256 \
  --note "Operator and actual rollback reason"
~~~

For the restored target, use that historical release's **reviewSha256** and
**sha256** as the review and candidate hashes. Its ID and hashes identify the
selected prior artifact; **expectedActiveReleaseId** identifies the current
release being replaced.

After restoring the workspace selection, apply the selected prior artifact
through the customer's deployment process. Verify that the service is serving
the intended prior catalogue and keep that deployment result with the rollback
entry.

## Export the review and complete workspace

The review's download controls provide the original source, candidate, complete
report, predecessor and operator-candidate original when present.

Use the same saved review through the CLI:

~~~sh
starforge dcat export \
  --workspace /absolute/private/catalogue-project \
  --review REVIEW_ID \
  --kind candidate \
  --out /absolute/private/delivery/catalogue-candidate.json

starforge dcat export \
  --workspace /absolute/private/catalogue-project \
  --review REVIEW_ID \
  --kind report \
  --out /absolute/private/delivery/catalogue-review.json
~~~

For a complete handover, choose **Open complete workspace handover** in the
migration section. The existing **Workspace** section creates the original
whole-project archive, including the DCAT documents, reviews and release
history with the project's other retained operations.

Follow the current workspace operation to completion before exporting. Keep
the returned archive, exact byte count, SHA-256 and manifest identity. The
native CLI follows the same archive engine:

~~~sh
starforge dcat archive \
  --workspace /absolute/private/catalogue-project \
  --out /absolute/private/delivery/catalogue-project.ckanw
~~~

Include these original materials with a customer delivery:

| Material | What the next operator receives |
| --- | --- |
| Installed application package, manifest and source revision | Editable application and its original dependency selection. |
| Prepared migration runtime | The selected Python executable and pinned converter/schema dependencies. |
| Complete .ckanw archive and its SHA-256 | Original catalogue documents, reviews, corrected candidates, active selection and complete release history. |
| Selected candidate and complete review | A directly usable catalogue artifact and its full source/conversion/comparison record. |
| Deployment and rollback instructions | The customer's actual service entrypoint, retained prior artifact and deployment operation. |
| Operator decisions | The scope, exceptions, cutover and rollback rationale already associated with the saved releases. |

## Receive and reopen as the next operator

Receive the exact archive into a new private destination:

~~~sh
starforge dcat receive \
  --file /absolute/private/delivery/catalogue-project.ckanw \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --workspace /absolute/private/received-catalogue-project

starforge dcat serve \
  --workspace /absolute/private/received-catalogue-project
~~~

Use the archive's complete SHA-256 from its actual export. The receiver
continues the original archive operation for the same archive and destination.
It preserves the saved source, review and release identities while relocating
the project through the existing whole-workspace receiver.

In the reopened browser, inspect the active release, open its review, download
its candidate and inspect the preceding release. Continue with a following
publisher edition or an intended correction in this same project. The complete
earlier history remains available for the next cutover or restoration.

The existing [workspace operating guide](../../../../products/ckan/OPERATING.md)
describes the surrounding capture, publication, merchant and buyer workflows.
Use them when the customer's project also includes retained CKAN resources and
native data products.

## Operate through the merchant agent

The DCAT tools use the existing merchant CKAN workspace alias and lease. Select
the same initialized catalogue project in the host's private configuration.
Declare original catalogue documents as **dcat-catalog** input aliases and, when
needed, a complete mapping JSON file as a **dcat-mappings** alias. Use
**merchant_ckan_inputs** to inspect their actual file identities.

| Tool | Saved-project operation |
| --- | --- |
| merchant_ckan_dcat_status | Read the current operation and retained catalogue, review and release inventories through their original pages. |
| merchant_ckan_dcat_import | Receive an input alias with its expected SHA-256, label, profile and origin. |
| merchant_ckan_dcat_review_prepare | Prepare a separate review of source, comparison, candidate, typed identity mappings and optional 3.0 normalization. |
| merchant_ckan_dcat_review | Read a saved review's summary and all selected report sections. |
| merchant_ckan_dcat_files | Select an original catalogue, report, candidate or current release file. |
| merchant_ckan_dcat_file_read | Read the selected exact bytes through the original retained-file reader. |
| merchant_ckan_dcat_cutover | Select the exact reviewed candidate as the active release. |
| merchant_ckan_dcat_rollback | Restore a previous candidate through another release-history entry. |

Read **merchant_ckan_status** before each mutation and supply its current
**expectedOperationId**, together with the selected **workspace** alias. Follow
the returned native operation to completion, then refresh before the next
mutation. Browser, CLI and agent retain the same catalogue, review and release
IDs.

Import uses **input** for the declared alias and **expectedSha256** for its
selected complete file. Optional **profile**, **label** and **origin** describe
that document. Review preparation uses the resulting **sourceId**, optional
**comparisonId** and **candidateId**, and **normalizeV3**. Supply either complete
typed **identityMappings** or the original **mappingsInput** alias and
**expectedMappingsSha256**. Keep structured identifiers as their complete JSON
objects and string identifiers as strings.

The review summary returns **reviewId**, intrinsic **reviewSha256**, **status**,
**report**, and **summary.sections**. Section pages retain **section**, **edition**,
**rows** and **page**. Each row carries its exact **reportPath**, **value** and
optional **owner**. Continue **page.nextOffset** until it is null; keep the same
review and section selection. An oversized row is explicitly identified and
remains available in the complete raw report. Corrections-needed reviews remain
saved results: receive the corrected document separately and prepare a new
review.

File selection takes **kind** as **catalog**, **report**, **candidate** or
**current**, with **itemId** except for current. The result's **file** contains
the stable kind/itemId, name, byte count, SHA-256 and original **read** arguments.
A current-release request resolves to the actual retained candidate before
reading. Use the returned **expectedSha256**, then retain **readId** and
**nextOffset** for the subsequent **offset**/**limit** reads. Assemble the bytes
in order, verify the complete file hash and release the reader through
**merchant_ckan_file_release**. The report file hash is distinct from its
intrinsic review hash. These byte reads preserve catalogue encoding and any
byte-order mark.

Cutover takes **reviewId**; rollback takes the selected historical **releaseId**.
Both require the current **expectedActiveReleaseId** (UUID or null), exact
**expectedReviewSha256**, **expectedCandidateSha256** and the operator's **note**.
For cutover, use the saved review's intrinsic **reviewSha256** and
**candidateSha256**. For rollback, use the target release's **reviewSha256** and
**sha256**. Refresh the current active release before recording either decision.

Complete handover continues through the existing
**merchant_ckan_workspace_archive**, **merchant_ckan_workspace_inspect**,
**merchant_ckan_workspace_read** and **merchant_ckan_workspace_receive** tools.
Keep the complete archive hash, receive into the declared new target alias, and
reopen that same received project. These tools retain the original archive and
relocation engine used by Workspace and **starforge dcat**.

## HTTP workflow reference

The browser and CLI use the same saved workspace and original operation owner.

| Route | Operation |
| --- | --- |
| GET /api/status | Current original operation and complete DCAT catalogue/review/release inventories. |
| POST /api/dcat/catalogs/upload | Receive exact JSON bytes with label, profile and origin query fields. |
| POST /api/dcat/review | Prepare a separate review from sourceId, optional comparisonId/candidateId, typed identityMappings, normalizeV3 and label. |
| GET /api/dcat/reviews/:id | Read the full original engine report. |
| GET /api/dcat/catalogs/:id/download | Download an exact received original. |
| GET /api/dcat/reviews/:id/candidate | Download that review's exact candidate. |
| GET /api/dcat/reviews/:id/download | Download the complete saved report. |
| POST /api/dcat/cutover | Select reviewId against expectedActiveReleaseId, optional expectedReviewSha256/expectedCandidateSha256, and its note. |
| POST /api/dcat/rollback | Restore releaseId against expectedActiveReleaseId, optional target expectedReviewSha256/expectedCandidateSha256, and its note. |
| GET /api/dcat/current/download | Read the workspace's currently selected catalogue. |
| GET /api/dcat/guide | Download this complete operating guide. |

Upload and review starts return their original operation ID and allocated
catalogue or review ID. Follow the shared operation status. Keep those IDs
through interruption and recovery instead of constructing replacement
identities. Complete source and report downloads retain the original bytes and
all records.
