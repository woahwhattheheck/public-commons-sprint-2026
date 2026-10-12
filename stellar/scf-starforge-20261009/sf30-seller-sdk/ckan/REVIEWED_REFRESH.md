# Review a complete CKAN refresh

The publisher can retain a complete comparison between two original captured
editions, review its source terms and field meanings, and publish an accepted
successor. Every decision stays attached to the exact saved comparison. The
previous publication remains available through its original publication ID,
dataset snapshot and merchant package.

The same workbench owns the browser, CLI and merchant MCP operations. Its
existing Linux project lease serializes all changes. Workspace archives include
the comparison files, decisions, selected successor and earlier publications.

## Operator workflow

1. Open the existing project and choose **Reviewed refresh**.
2. Select the original saved source and its published predecessor. Capture the
   following selection through the original catalogue engine, or select an
   already complete retained edition.
3. Choose one or more source key fields. Prepare the full comparison and inspect
   its source selection, terms, definitions, row totals and change pages.
4. Review the successor's public aliases and types. The field editor preserves
   existing aliases, shows missing prior fields, and leaves new fields
   unselected until chosen. Preview validates every retained after-row and
   returns the exact projected semantic dictionary.
5. Enter the operator name and a source/change review note, then record one
   decision.

| Decision | Result |
| --- | --- |
| Accept | Creates a distinct saved source with the reviewed projection and semantic identities. Continue through the original candidate preparation, review and publication workflow. The new publication records its predecessor and exact refresh decision. |
| Keep current | Retains the original source and its published versions. The complete reviewed comparison and decision remain available. |
| Withdraw source | Ends future candidate preparation, candidate review and publication from that selected source. Existing published versions remain readable; a separately accepted successor remains usable. |

The page offers the full JSONL download and comparison/decision records. Each
change retains its key, complete before/after values and changed field names.
The existing quick edition comparison remains a 100-change preview; **Reviewed
refresh** retains every change.

A completed decision is immutable. **Start a new review of these editions**
links another explicit decision to the prior review. This lets an operator
reconsider the same original editions while ordinary repeated preparation
continues to reuse its original comparison and successor identity.

## Interpret source windows correctly

The comparison records the catalogue, package, resource, filters, query and
schema URL for both original captures. A changed date window or filter is shown
as a changed selection. Added and removed rows describe membership in those
retained selections; inspect the recorded interpretation before treating a
difference as a provider deletion or update.

Page size and pagination configuration are retained separately from the
membership selection. Source metadata changes contain the original package
and resource fields, including terms, descriptions and identifiers. Field
meaning changes use the original retained CSVW/definition engine.

Keys contain one to sixteen distinct source fields. Every selected key must be
present, non-null and unique in each capture, with scalar values. Composite
keys preserve their field order and value types. Numeric keys and row values
use the original exact CKAN number parser. Decimal spellings are compared
mathematically without JavaScript integer rounding; signed zero remains
distinct. Strings remain strings, and an absent field remains different from
a field containing null.

The full JSONL retains original numeric tokens. Browser and MCP JSON
presentations show exact numeric tokens as text so a downstream JavaScript
JSON parser cannot round them.

## CLI

All commands operate on the same private project directory:

    node ckan/cli.mjs refresh-prepare --project PROJECT --id SOURCE_ID --input refresh.json
    node ckan/cli.mjs refresh --project PROJECT --id REFRESH_ID
    node ckan/cli.mjs refresh-preview --project PROJECT --id REFRESH_ID --input projection.json
    node ckan/cli.mjs refresh-changes --project PROJECT --id REFRESH_ID --sha256 COMPARISON_SHA256 --offset 0 --limit 50
    node ckan/cli.mjs refresh-file --project PROJECT --id REFRESH_ID --sha256 COMPARISON_SHA256
    node ckan/cli.mjs refresh-review --project PROJECT --id REFRESH_ID --input decision.json

The preparation input selects the actual saved source and after-edition:

    {
      "afterEditionId": "ACTUAL_EDITION_UUID",
      "expectedSourceSha256": "ACTUAL_SAVED_SOURCE_SHA256",
      "expectedAfterCaptureSha256": "ACTUAL_CAPTURE_SHA256",
      "previousPublicationId": "ACTUAL_PUBLISHED_PREDECESSOR_UUID",
      "keys": ["_id"]
    }

The preview input includes the returned exact comparison SHA-256. Omit
projection/query/title to inspect the original selection on the following
edition; supply them to review a changed public projection.

    {
      "expectedComparisonSha256": "ACTUAL_COMPARISON_SHA256"
    }

For accept, copy the actual preview's normalized projection and query, its
projection SHA-256, and both nullable semantic identities into the decision:

    {
      "expectedComparisonSha256": "ACTUAL_COMPARISON_SHA256",
      "decision": "accept",
      "reviewer": "Operator name",
      "note": "Describe the source, terms, selection and field-meaning review.",
      "expectedProjectionSha256": "ACTUAL_PREVIEW_PROJECTION_SHA256",
      "expectedSemanticsSha256": "ACTUAL_PREVIEW_SEMANTIC_SHA256_OR_NULL",
      "expectedDefinitionSha256": "ACTUAL_PREVIEW_DEFINITION_SHA256_OR_NULL"
    }

The last two values are explicit JSON null when the original preview has no
semantic review. When editing aliases or query, also include the exact
previewed projection/query/title. For keep-current or withdraw-source, those
successor projection fields are unnecessary.

The returned acceptedSourceId continues through the existing commands:

    node ckan/cli.mjs prepare --project PROJECT --id ACCEPTED_SOURCE_ID --input publication.json
    node ckan/cli.mjs inspect --project PROJECT --id PUBLICATION_ID
    node ckan/cli.mjs review --project PROJECT --id PUBLICATION_ID --input candidate-review.json
    node ckan/cli.mjs publish --project PROJECT --id PUBLICATION_ID --review-id REVIEW_ID

Use the original candidate digest and review ID returned by those steps.
The refresh decision selects source data and meaning; the original publisher
still reviews its complete candidate and creates the dataset version.

## Agent tools

The managed merchant host registers forty CKAN tools, including these seven
reviewed-refresh operations:

| Tool | Original operation |
| --- | --- |
| merchant_ckan_refresh_prepare | Prepare or recover the exact comparison from source and after-edition identities. |
| merchant_ckan_refresh | Read full comparison metadata, source/meaning differences, preview and saved decision. |
| merchant_ckan_refresh_resume | Continue the original comparison or finish its already saved decision. |
| merchant_ckan_refresh_preview | Validate all after-rows and return the exact successor projection and dictionary identities. |
| merchant_ckan_refresh_changes | Page retained changes with the returned nextOffset. |
| merchant_ckan_refresh_read | Read the entire unchanged JSONL in SHA-256-pinned native chunks. |
| merchant_ckan_refresh_review | Save accept, keep-current or withdraw-source on the selected comparison. |

Each changing tool requires the current expectedOperationId, including explicit
null when the original project has no operation. Follow that returned original
operation to completion before the following mutation. Read tools operate on
the same owner. The normal file_release tool closes an abandoned chunk read.

For refresh_read, supply expectedComparisonSha256 and expectedSha256 from
comparison.changes.sha256. Continue with its readId and nextOffset until
nextOffset is null. The full change file uses the existing read-only retained
file reader; the browser download streams the same bytes with
x-content-sha256.

The native comparison page API accepts up to 200 requested rows; MCP accepts up
to 100. A four MiB presentation budget can shorten either response. Always use
nextOffset. An individual record exceeding that page budget returns
CKAN_REFRESH_CHANGE_REQUIRES_DOWNLOAD; its complete record remains in the
original JSONL download.

## Interruption and complete receiving

Each comparison directory contains input.json, the original append progress,
changes.jsonl, its sparse changes.idx and comparison.json. The comparison pins
both captures and complete output files. The index addresses every 128th change
and supports direct later-page reads.

A resumed build checks its saved prefixes and original inputs before
continuing. Completed comparisons retain their exact bytes. A decision is
saved before source creation; accepted source IDs are allocated during the
original preparation. If the process ends after decision storage, resume
finishes that same decision and source rather than issuing another one:

    node ckan/cli.mjs refresh-resume --project PROJECT --id REFRESH_ID

The original whole-workspace archive includes refreshes with all retained
capture, publication, merchant and buyer history:

    node ckan/cli.mjs archive-workspace --project PROJECT --out COMPLETE.ckanw
    node ckan/cli.mjs inspect-workspace --archive COMPLETE.ckanw --sha256 ARCHIVE_SHA256
    node ckan/cli.mjs receive-workspace --archive COMPLETE.ckanw --project NEW_PRIVATE_PROJECT --sha256 ARCHIVE_SHA256

Receiving rebinds original source locations while preserving comparison and
decision bytes. It checks comparison/capture/source relationships, accepted
projection/semantic identities and original publication history. Earlier
archives without refresh records remain supported. The existing browser and
five agent workspace-transfer tools carry the same complete workspace.

## Run the complete real-source receiving example

examples/reviewed_refresh.mjs continues a specific published project using its
actual retained data. Supply exact original IDs and either an original complete
capture.json or a live capture selection JSON:

    node ckan/examples/reviewed_refresh.mjs \
      --project ORIGINAL_PRIVATE_PROJECT \
      --source ORIGINAL_SOURCE_UUID \
      --previous-publication ORIGINAL_PUBLICATION_UUID \
      --after-capture ORIGINAL_AFTER_CAPTURE/capture.json \
      --out PRIVATE_OUTPUT \
      --received NEW_PRIVATE_RECEIVING_PROJECT \
      --keys _id \
      --reviewer "Receiving operator"

For live acquisition, replace --after-capture with --after-selection. The
selection uses the original capture engine's catalogue resource, query,
filters, schema and pagination fields. Capture progress and the original
edition ID are saved before its completion, so the same invocation resumes its
original acquisition.

The program completes the full publisher workflow, iterates every change,
downloads the complete authenticated JSONL, receives the whole project,
reopens it through the real managed MCP host, exercises all seven refresh
tools, and reopens the accepted decision through the installed CLI. Its second
operator records keep-current followed by withdrawal of the old source in the
receiving copy. The accepted successor remains selected; both published
versions are queried again. It verifies that the original publisher enforces
that received source withdrawal.

The receiving journal retains exact source, capture, comparison, decision,
candidate and archive identities. The complete outputs include
accepted-refresh.ckanw and received-refresh-history.ckanw. The first contains
the original accepted publication; the second includes the subsequent
receiving operator's decisions. Process-local listener tokens stay in memory.
Run the same arguments to continue the existing journal, source IDs and
receiving directories.
