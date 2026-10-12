# SAM.gov opportunity operations

This component carries a SAM.gov search through retained source editions, notice review, change review, selected notice sets, named handoffs, and the original Stellar Forge merchant and buyer workflow. The browser uses a clean grayscale operator layout. The CLI and SDK use the same private workspace and retained operation history.

A saved edition preserves the returned notice records, their original page bodies, issued description and attachment URLs, and every resource body that the operator acquires or receives. Named handoffs freeze a particular source and review revision. Later captures and reviews create new history while the handoff continues to export its original bytes.

## Run the operator

Use the installed source distribution:

~~~sh
starforge samgov serve --workspace /private/sam-opportunities --operator "Procurement operator"
~~~

Or run this component from its source directory:

~~~sh
node cli.mjs serve --workspace /private/sam-opportunities --operator "Procurement operator"
~~~

Open the private loopback link printed by the command. The fragment authenticates that browser tab and is removed from its visible address after loading. Keep the process running while using the workspace. Ctrl+C drains owned work, pauses the original active capture, closes prepared sellers, and releases the original workspace writer.

The default API key environment variable is SAM_GOV_API_KEY. Use --api-key-env with the name of an existing runtime-managed variable when required. The browser receives connection readiness, source records, and action results; it never receives the provider key. An existing captured response or portable workspace can be received through the same operator when source acquisition is performed by another authorized environment.

Use --opportunity-workspace /private/opportunity-workspace at launch to enable the source bridge to the existing opportunity operations component. The source bridge uses that exact selected directory throughout the operator session.

## Complete working flow

1. Save the source search with its posted-date window, filters, page size, and record capacity.
2. Run the original capture. Its page index, retained response bodies, accepted records, and terminal state remain together.
3. Open an edition in the notice library. Review the complete issued notice fields, source bytes, contact details, award fields when supplied, and response deadline as issued.
4. Retain the selected notice's issued description and attachment bodies. The resulting resource-enriched edition preserves the parent search edition.
5. Review a notice with an owner, decision, notes, and an explicit reviewed deadline when a deadline decision is needed.
6. Save a selection containing the exact notice IDs from one edition. The operator can select the complete filtered edition across all pages.
7. Compare successive editions. Review each material change against the selected before and after editions.
8. Create a named handoff and export its complete portable packet, readable review, and CSVs.
9. Prepare the original notice seller with its public payment terms and resource origin, then start it and review its running offer and prepare the original buyer request. The selected sources can also be joined directly to the existing opportunity workspace.
10. Receive the complete portable packet into a fresh workspace, reopen it, inspect the original sources, and export its named handoffs.

## Source contract

The primary contract is the [GSA Opportunities Public API documentation](https://open.gsa.gov/api/get-opportunities-public-api/). SOURCE-CONTRACT.md and references/gsa-opportunities-contract.json retain this component's field, paging, and source custody interpretation.

| Concern | Operator behavior |
| --- | --- |
| Search endpoint | Production uses https://api.sam.gov/opportunities/v2/search; the documented alpha endpoint is separately selectable. |
| Required search window | postedFrom and postedTo are required. The operator accepts YYYY-MM-DD and the transport emits the documented MM/dd/yyyy values. The window is at most one year. |
| Paging | offset is the zero-based page index. limit is the page size, up to 1,000 records. |
| Saved query | The complete filter definition, page size, capacity, and source terms are retained with a query revision. |
| Latest API observation | The public search API supplies the latest active version. A retained comparison describes the observations this workspace acquired. The provider's complete historical record requires its Data Services source. |
| Completion | Accepted pages, row count, unique notice identities, advertised total, and the terminal page must reconcile before an edition is complete. |
| Capacity | A capture can retain up to its explicit selected capacity, within the component's 5,000,000-record maximum. Reaching capacity preserves that original capture for an increase and continuation. |
| Rate limits and failures | A failure remains on the original capture with its retained page and attempt history. Resume the same capture after the source is ready. |
| Description | The issued description URL is retained. The provider key is supplied only to the supported GSA API or description destination. |
| Attachments | Original resourceLinks are retained and selected for acquisition. A provider key is not forwarded to an attachment destination or a redirect. |
| Deadline | responseDeadLine is preserved as the provider issued it, including its original string. A reviewed operational deadline separately requires an offset, IANA time zone, and reason. |
| Government amounts | Award amounts and other original values retain their source strings. |
| Sensitive echoes | Known credential echoes are removed from the shareable source representation while private source custody retains the original hash and redaction description. |
| Resource size | Each individual retained source may contain up to 64 MiB. A complete portable JSON input may contain up to 512 MiB. |

A notice absent from a later search is labeled as no longer returned in that search. Its absence alone does not establish cancellation or deletion. Compare the original notice fields and source documents before changing the opportunity decision.

The UI presents the documented notice types, organization filters, notice and solicitation identifiers, NAICS and classification codes, set-aside, state, ZIP, and response deadline filters. The search contract omits the provider's forthcoming status parameter and deprecated department and subtier parameters.

## Capture and resume

The durable sequence for each original page is a prepared request, retained source result, then accepted cursor advance. A resumed capture uses its already retained result before requesting later pages. The acquisition owner can be paused without creating a second capture.

Use the browser's capture controls or the CLI:

~~~sh
starforge samgov status --workspace /private/sam-opportunities

starforge samgov query \
  --workspace /private/sam-opportunities \
  --input search-definition.json \
  --request-id source-search-mcc-20261012 \
  --expected-revision 0

starforge samgov capture \
  --workspace /private/sam-opportunities \
  --query-id QUERY_ID \
  --query-revision 1 \
  --request-id source-capture-mcc-20261012 \
  --expected-revision CURRENT_WORKSPACE_REVISION

starforge samgov run \
  --workspace /private/sam-opportunities \
  --capture-id ORIGINAL_CAPTURE_ID
~~~

The example expected revision 0 applies only to an empty workspace. Read the current retained revision before preparing each new mutation. QUERY_ID and the other uppercase values stand for IDs returned by the corresponding original action.

A search-definition.json input has this shape:

~~~json
{
  "name": "MCC Software Development Recompete",
  "filters": {
    "postedFrom": "2026-10-01",
    "postedTo": "2026-10-31",
    "noticeid": "ec4254f4fdf24f8998bd4e10d5b58050"
  },
  "pageSize": 1000,
  "maxRecords": 250000,
  "sourceTerms": "Retain the original public notice, description and issued resources."
}
~~~

This is a query definition. Its actual source acquisition is retained by the capture operation.

To receive original API pages acquired elsewhere, use action import_capture with the saved definition and complete pages. Each page supplies its actual GET request URL, HTTP status, capture time, selected response headers, and exact response bytes as contentBase64. Secret query values must remain in private custody. The importer validates the complete page sequence and source records using the same acquisition contract.

To receive an original selected attachment or description body, use action retain_resource with editionId, noticeId, kind, the issued url, filename, mediaType, capturedAt, and contentBase64. The original issued URL must belong to that selected notice. A received file retains status `received_file` and a null request. If the original acquisition includes an HTTP receipt, supply its actual metadata as `response: {request: {method: 'GET', url}, status, headers?}`; its status is retained exactly. Both successfully acquired HTTP resources and original received files carry their bytes into the opportunity handoff. The source index identifies how each source was received.


## Receive a saved SAM notice

The same workspace accepts original notice JSON acquired from the SAM website. Receive its original attachment metadata and published history alongside the notice when available. The browser's **Receive saved notice** form accepts these three original files and creates a retained edition. Choose an existing edition in the form to extend that notice collection.

The operator keeps the website response's original data2, notice ID, description bodies, attachment IDs and metadata, publication state, published history entries, and issued response time zone. Each displayed field remains connected to its exact source body and JSON pointer. Received website documents use the retained_notice_document source basis; API search captures keep latest_api_observation.

The CLI accepts the original files directly:

~~~sh
starforge samgov notice \
  --workspace /private/sam-opportunities \
  --notice-file /source/sam-notice-current.json \
  --resource-index-file /source/sam-notice-attachments.json \
  --history-file /source/sam-notice-history.json \
  --name 'Saved notice and issued source register' \
  --request-id receive-original-notice-1 --expected-revision 0
~~~

Use --base-edition-id to extend a retained collection. Use --captured-at only when the original acquisition time is known. Otherwise the source records when the file was received here. Exact response bytes remain in their original source objects; the action does not assign an HTTP status to a received file.

The typed action import_notice also accepts an original HTTP receipt:

~~~ts
await workspace.dispatch('import_notice', {
  requestId, expectedRevision, name,
  notice: {contentBase64, filename, capturedAt},
  resources: {contentBase64: resourcesBase64, filename: resourcesFilename},
  history: {contentBase64: historyBase64, filename: historyFilename},
});
~~~

Each input may additionally supply its original url and response: {request: {method: 'GET', url}, status: 200, headers}. Request URLs must be the original SAM notice, resource-index or history path for that same notice. A source file received without the HTTP envelope keeps received_file and a null request.

Attachment metadata supplies the issued file IDs, names, sizes and access fields. **Receive source file** attaches the actual downloaded bytes at that issued URL; **Capture issued files** uses the original HTTPS transport. Embedded notice descriptions and published history remain readable in the operator and complete exported review. The entire source set follows a selected notice through the original merchant publication and opportunity bridge.

A repeated notice import can extend the selected edition while retaining original files whose issued URLs remain in its current attachment index. Earlier editions and named handoffs retain their prior contents. The portable receiver reconstructs both source formats from their retained bodies and validates the notice, index, history and resource set before advancing the workspace.


## Reviews, selections, and change handling

A notice review belongs to one edition and notice ID. Supported states are unreviewed, watching, qualified, declined, and needs_review. The operator records its owner and notes. A reviewed deadline is separate from the provider's source deadline and has the form:

~~~json
{
  "at": "2026-10-29T22:00:00Z",
  "timeZone": "America/New_York",
  "reason": "Reviewed against the notice's issued 18:00 EDT response deadline."
}
~~~

A saved selection records its source edition, exact notice IDs, name, purpose notes, and selection revision. Exports contain the full saved selection even when the screen is showing one page.

Edition comparison includes additions, notices no longer returned, changed records, and unchanged records. Each changed item contains the retained before and after notice and its exact changed raw fields or retained resource set. A change review records the exact edition pair, notice ID, decision, owner, and note. Changing the comparison selectors clears the prior comparison before another review can be prepared.

## Named handoffs and complete exports

A named handoff records its original selection revision, source revision, source state hash, creator, and creation time. All formats render from the exported packet for that exact revision.

| Format | Complete contents |
| --- | --- |
| portable | Original state version chain, retained editions and records, source metadata, body objects, selected scope, and packet hash. |
| html | Standalone readable notice register, reviewed decisions and deadlines, contact and award fields, retained description text, change reviews, and source index. |
| markdown | Readable full review and receiving guide from the same frozen packet. |
| notices | CSV of the complete selected notice records and their source identity. |
| reviews | CSV of notice decisions, owners, notes, and reviewed deadline details. |
| changes | CSV of retained change reviews and their original edition pairs. |
| sources | CSV of the source metadata and retained body identities. |

CSV cells that could be interpreted as spreadsheet formulas are prefixed for spreadsheet safety. Original source JSON and source-body bytes remain available in the portable packet.

~~~sh
starforge samgov export \
  --workspace /private/sam-opportunities \
  --handoff-id NAMED_HANDOFF_ID \
  --format html \
  --out mcc-review.html

starforge samgov export \
  --workspace /private/sam-opportunities \
  --handoff-id NAMED_HANDOFF_ID \
  --format portable \
  --out mcc-handoff.json

starforge samgov receive \
  --workspace /private/sam-received \
  --operator "Receiving operator" \
  --input mcc-handoff.json

starforge samgov list --workspace /private/sam-received
~~~

Export can choose a selection, named handoff, or historical revision. A named handoff supplies its own frozen selection and revision. An output file is created atomically; replacing an existing output requires --force. Repeating receipt of the same complete original packet reconciles its retained state.

## Original seller and buyer integration

Prepare a merchant from a complete saved selection in the Selections tab. The preparation materializes the existing dataset contract and seller integration under the original workspace's merchant/PUBLICATION_ID directory. It records the selected edition and review revision, source state hash, snapshot, files, original bundle, and seller configuration.

The original dataset contract supports up to 1,000,000 selected records and a 64 MiB dataset. These limits apply to the selected merchant product; the source capture can retain a larger corpus.

Supply the existing public SDK payment object and intended resource origin together to create a configured merchant. Leaving both empty prepares the retained dataset; Prepare seller terms creates a configured publication from the same selection when those terms are supplied.

In Handoffs, choose Start local seller for the configured merchant preparation. The operator starts the original versioned dataset seller on loopback and displays its actual bound origin. Review buyer offer uses that address by default. Stop local seller drains the owned original service and releases its version writer. Starting again opens the same prepared publication.

The CLI exposes the same path:

~~~sh
starforge samgov merchant \
  --workspace /private/sam-opportunities \
  --input merchant-input.json \
  --request-id mcc-notice-merchant-20261012 \
  --expected-revision CURRENT_WORKSPACE_REVISION

starforge samgov merchant-serve \
  --workspace /private/sam-opportunities \
  --publication-id MERCHANT_PUBLICATION_ID

starforge samgov buyer-review \
  --workspace /private/sam-opportunities \
  --input buyer-review-input.json \
  --request-id mcc-offer-review-20261012 \
  --expected-revision CURRENT_WORKSPACE_REVISION

starforge samgov buyer-prepare \
  --workspace /private/sam-opportunities \
  --input buyer-prepare-input.json \
  --request-id mcc-buyer-intent-20261012 \
  --expected-revision CURRENT_WORKSPACE_REVISION
~~~

Merchant preparation accepts selectionId, the intended origin together with its public payment terms, product path, default and maximum result limits, and the existing SDK payment configuration. The merchant input's default path is /procurement-notices.

Buyer review accepts publicationId, the actual running seller origin, and product query. Buyer preparation records publicationId, the saved reviewId, original intentId, selected acceptIndex, and reviewed offerSha256. It rechecks the original reviewed offer before preparing the existing buyer intent. Continue that intent through the original buyer's payment and request flow.

The merchant control service remains part of the original seller implementation. The SAM browser receives the publication identity and running origin; its private control token stays in the host process.

## Original opportunity source bridge

Launch with the intended --opportunity-workspace, then choose Open opportunity on a saved selection. Select the notice, opportunity title, document kind, and reviewed deadline when appropriate. Use a known project ID and expected project revision when joining an existing project.

The bridge imports the original retained notice and selected description and attachment bodies into the existing opportunity model. It keeps the source and operation identities together with its bridge journal. A repeated original request recovers the same bridge operation. The source-only acquisition view does not create claims about a company's delivered experience; the opportunity model owns capability, teaming, response, milestone, and proposal review.

## SDK

~~~js
import {openSamWorkspace} from './workspace.mjs';
import {startSamWorkspace} from './server.mjs';
import {exportSamWorkspace} from './reports.mjs';
import {serveSamMerchant} from './merchant.mjs';

const workspace = await openSamWorkspace({
  directory: '/private/sam-opportunities',
  operator: 'Procurement operator',
  apiKeyEnv: 'SAM_GOV_API_KEY',
  opportunityDirectory: '/private/opportunity-workspace'
});

try {
  const current = await workspace.list();
  const original = await workspace.get('RETAINED_RECORD_ID', {
    offset: 0,
    limit: 50,
    search: ''
  });
  const packet = await workspace.exportPacket({handoffId: 'NAMED_HANDOFF_ID'});
  const review = await exportSamWorkspace(workspace, {
    handoffId: 'NAMED_HANDOFF_ID',
    format: 'html'
  });
} finally {
  await workspace.close();
}
~~~

openSamWorkspace holds the existing private directory writer for its lifetime. Pass readOnly:true for a reader. All mutation actions carry expectedRevision and requestId; read actions view, get, notice, read_source, and compare use the same facade without creating a mutation.

runCapture(captureId, {signal, onProgress}) owns one original acquisition. cancelCapture(captureId) pauses that owned run. readSource(sourceId) returns source metadata and exact retained bytes. exportPacket and importPacket carry the complete version and source closure.

startSamWorkspace returns directory, operator, origin, private url, server, store, and an idempotent close function. A native embedding caller may supply an already-open store. runSamCli with waitForClose:false returns the started operator or prepared seller to the embedding caller, which owns close.

## Recovery and operation ownership

The browser saves a prepared mutation's complete payload, original revision, and request ID before sending it. An uncertain response can be reconciled from retained history or retried using that same input. A new edit reads the current revision and prepares a new identity.

A completed capture and its immutable source edition remain together after process restart. An interrupted page resumes its retained request and source result. A named handoff continues to reference its original revision after later source changes, merchant preparation, or review edits.

The private operator validates its loopback host and browser origin, uses a tab-specific bearer token, and serves only its bundled assets. Its pages use no external scripts or styles. Provider response values render as text; retained HTML source is read as source text in the operator and can be downloaded as its original bytes.
