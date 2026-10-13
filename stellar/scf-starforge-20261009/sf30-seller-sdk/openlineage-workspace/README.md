# OpenLineage operations workspace

The [reviewed multi-job policy rollout](SERVICE_POLICY_ROLLOUT.md) commissions selected jobs through one original workspace transaction. Inspect every exact before/after policy version, retain the full reviewed request, apply atomically, and reopen immutable rollout history and complete reports after receiving. The original single-policy editor, assessments and incident decisions remain available.

The [async Python producer](ASYNC_PYTHON_PRODUCER.md) operates the released 1.53.0 queue, ordering and retry worker through `cli.mjs native-python-async`. It retains each first native request and actual acknowledgement, resumes the same delivery after interruption, and exports the complete producer operation with the original workspace. The guide includes the full native customer receiving command.

Native Python and Java OpenLineage 1.53.0 producers are included in the complete application. Use `cli.mjs native-python` or `cli.mjs native-java` to send retained original pipeline events and continue interrupted deliveries through the same workspace. The [producer guide](PRODUCERS.md), [Python guide](PYTHON_PRODUCER.md) and [Java guide](JAVA_PRODUCER.md) cover preparation, configuration, saved progress and customer receiving.

The managed merchant producer desk prepares private Python or Java settings,
sends complete host-pinned event files and continues their original delivery.
Use `cli.mjs producer` and the [merchant guide](MERCHANT.md) to operate it.

A private, editable operations workspace for original OpenLineage events.
Receive a producer's HTTP events or import original JSON, NDJSON or gzip files,
inspect their jobs, runs and datasets, follow
the reported dependencies, save an edition, record an operator decision and
attach a complete result to the event context that explains it. Deliver that
whole workspace, including the original files and editable application, to
another operator.

The browser, command line, Node SDK and MCP tools use the same revisioned
workspace. The maintained SCF distribution adds this product to its existing
command catalog and Applications lifecycle. Its source-owned merchant provider adds
22 tools over this same original application; see [MERCHANT.md](MERCHANT.md).

## Start

Node 22 or newer is the only runtime dependency. A received application can
run directly from its own directory; there is no package installation step.

    node cli.mjs init --workspace /absolute/private/lineage --title "Data operations"
    node cli.mjs serve --workspace /absolute/private/lineage --port 8767

Open the printed local URL. The browser has source import, a searchable
jobs/runs/datasets inventory, original event and facet inspection, lineage,
saved editions and comparison, reasoned reviews, attached result files and
complete downloads. Existing projects reopen through the same command.

In the maintained installed distribution:

    starforge openlineage init --workspace /absolute/private/lineage
    starforge openlineage serve --workspace /absolute/private/lineage
    starforge registrations --source openlineage-workspace

Applications lists **OpenLineage operations**. Select the initialized or
received workspace and an optional private token file, then use the existing
Review, Save, Review Start, Start, Open and Stop controls. The adapter binds the
original workspace identity and selected source to that existing lifecycle.

## Import original events

Select a complete source file in the browser or use:

    node cli.mjs import --workspace /absolute/private/lineage \
      --input /absolute/producer/events.ndjson \
      --source https://your-producer.example/retained-job-log \
      --operation-id producer-capture-20261012

The CLI infers the current revision unless --revision is supplied. Reuse the
same operation ID and exact original arguments after an interrupted response.
A new intended source import gets its own ID.

Import accepts one JSON event, an array of JSON events, or NDJSON. Every
original source byte is retained under its SHA-256. Logical events deduplicate
by canonical complete event content; later observations with changed facets
remain distinct even when their run and event type match. The source inspector
retains the original source position and diagnostic for each event.

The source URL is an operator-supplied provenance field. The application does
not fetch it. Source downloads return the exact retained bytes.

### Producer HTTP transport

Native Python, Java, Airflow and other OpenLineage HTTP clients can send their
original bodies to:

    POST http://127.0.0.1:8767/api/v1/lineage

The receiver accepts uncompressed or gzip JSON/NDJSON. It retains compressed
wire bytes unchanged and verifies their decoded byte identity. Native producer
arrivals use the original workspace writer through a serial append queue.
A response acknowledges the source only after its original operation is saved.

The optional Idempotency-Key header selects the original operation ID. By
default it is derived from the unchanged wire body. Repeat the exact body,
name, reference and encoding after a lost response. An explicitly supplied
If-Match retains its numeric revision check. Queue or writer backpressure
returns 503 with Retry-After: 1.

Use the browser's **Producer intake** control to inspect the actual endpoint,
current queue and server counters and download complete Python or Java client
settings. The CLI's producer-config command creates the same private
configuration from the actual connection.json. A separate producer token can
admit events while the operator token controls the whole workspace.

[PRODUCERS.md](PRODUCERS.md) covers complete client setup, authentication, gzip,
source inspection, retries, capacity and the native producer receiving journey.

The explicit operator import route, /api/sources?name=events.ndjson&source=URL,
keeps its normal revision checks. It also accepts Content-Encoding: gzip.
To import a compressed original directly through the CLI, add
--content-encoding gzip to the import command and retain the .gz filename.

## Operate the project

1. Import complete producer files. Inspect any source diagnostics before
   choosing the event set to review.
2. Open a job, dataset or run. Namespaces are part of identity. Runs retain their
   native UUID plus the owning job identity. Inspect original facets and input
   and output observations alongside the graph.
3. Save a named edition. It retains the current event IDs and source IDs; later
   imports do not change that saved selection.
4. Compare two editions, or a saved edition with the live project. Inspect
   added events and changed jobs, datasets and run outcomes.
5. Save a review against selected entities. A reason is required. Decisions are
   accepted, needs-work, excluded or observed. Updating a review retains its
   previous text, selection and decision in the review's history.
6. Attach the complete existing result file to its saved edition and entities.
   Keep its source reference and, where applicable, its original query alongside
   the bytes. CSV, JSON, reports and other file formats remain their original
   files.
7. Export the complete workspace or generate its complete JSON, CSV or printable
   HTML report. Reopen the delivered workspace to continue the same history.

A review records a human or agent assessment. It does not erase an event,
rewrite the upstream pipeline outcome or cause an upstream job to run.
Result attachment carries existing bytes and their declared relationship to
the selected context.

## Deliver and receive

    node cli.mjs export --workspace /absolute/private/lineage \
      --out /absolute/delivery/openlineage-workspace.json

The package contains the saved state, all source and attached-result objects,
and the complete portable application. Each object and application file has
its byte length and SHA-256; the complete payload has its own digest. Existing
workspace, event, edition, review and operation identities survive receiving.

    node cli.mjs verify --input /absolute/delivery/openlineage-workspace.json
    node cli.mjs receive --input /absolute/delivery/openlineage-workspace.json \
      --out /absolute/private/received-lineage
    node /absolute/private/received-lineage/application/cli.mjs serve \
      --workspace /absolute/private/received-lineage --port 8768

Receiving verifies the complete package before creating the destination. Use a
new destination directory. It restores exact original objects and reconstructs
event/source relationships from those original files, installs the included
application, and records a separate local installation ID in received.json.
Starting that received application is the explicit subsequent command.

Remote clients can download an existing export in exact, resumable byte ranges:

    node cli.mjs download --url http://127.0.0.1:8767 \
      --id EXPORT_SHA256 --out /absolute/delivery/openlineage-workspace.json

A partial download retains its original export identity and offset. Repeating
the command continues that export and verifies its complete digest before
making the destination file available.

## Node SDK

Import LineageClient from ./client.mjs or the installed
@tokenjunkielabs/starforge-merchant package's /seller/openlineage export. The
adjacent client.d.ts declares the interface.

    import { LineageClient } from "./client.mjs";
    import { readFile } from "node:fs/promises";
    import { randomUUID } from "node:crypto";

    const client = new LineageClient("http://127.0.0.1:8767");
    const current = await client.read();
    const original = await readFile("/absolute/producer/events.ndjson");
    const imported = await client.importSource(original, {
      name: "events.ndjson",
      operationId: randomUUID(),
      expectedRevision: current.revision
    });
    const edition = await client.saveEdition({
      title: "Reviewed producer capture",
      operationId: randomUUID(),
      expectedRevision: imported.revision
    });

Keep the operation ID and exact arguments before sending a mutation if another
process will need to resume it. A 409 with the current revision means another
writer changed the project; read that change before issuing a new operation.
A replay with the same ID and original input returns the original result.

For a host-selected connection, the client supports expectedWorkspaceId and
instanceId. The server verifies these headers on the same request that performs
the action. The optional signal joins the caller's cancellation to the request
timeout.

The direct LineageWorkspace interface in store.mjs provides the same native
methods for a private local process.

## MCP and HTTP API

    node cli.mjs mcp --workspace /absolute/private/lineage

The stdio server uses newline-delimited JSON-RPC. It provides MCP initialize,
tools/list and tools/call for the native action catalog. The same stateless
JSON-RPC interface is available at POST /mcp. The declared protocol version is
2025-03-26.

POST /api/action accepts {"action":"workspace.read","args":{}} and returns the
native action result. Inspect catalog.mjs for exact input schemas. Mutation
arguments carry operationId and expectedRevision. Object and export downloads
have separate original-byte routes.

GET /api/identity returns the current original workspace and application
instance. The server writes that same small identity to the workspace's private
connection.json for an installed host adapter. GET /api/workspace returns the
current projection and saved history.

## Source interpretation

SOURCE_CONTRACT.md records the supported upstream schema versions, lifecycle,
facet replacement, graph rules and exact fixture provenance. Events outside the
supported operational grammar remain inspectable in their original source
with diagnostics. Native event timestamps order projections; source arrival
sequence resolves ties.

This workspace distinguishes declared job structure from individual run
observations. It follows explicit producer lineage when available and retains
the dataset-to-run-to-dataset graph when only input/output observations exist.
It does not manufacture an all-to-all dataset relationship from two event
arrays.

## Recovery and operation

The selected workspace directory holds workspace.json, content-addressed
objects/, immutable exports/, the current connection.json and a short-lived
writer.lock. Files created by the application use private permissions.

Only one mutation writes the saved state at a time. State updates use a
synchronized temporary file followed by an atomic rename. Stable operation IDs
make a lost success response recoverable. A process interruption may leave its
writer.lock. Read that original record and use:

    node cli.mjs recover-lock --workspace /absolute/private/lineage \
      --id ORIGINAL_LOCK_ID

The recovery command checks that the exact original lock remains and that its
process no longer exists.

The default HTTP body limit is 64 MiB. The native producer queue has separate
wire and decoded capacity settings described in PRODUCERS.md. Direct source
imports have a 256 MiB wire/decoded ceiling, subject to available memory and disk. This first
implementation keeps the saved event index in memory for projection and writes
its JSON state atomically. Use a workspace per operational scope when the full
event history outgrows the available host.

The default listener is local to this computer. To bind another interface,
provide a private token file containing at least 24 characters. The server
rejects other browser origins, requires that token on its data routes and uses
the selected host consistently. Transport through a configured HTTPS service
is the operator's deployment responsibility.

## Original source and distribution

The source-owned contribution is in
distribution/contributions/openlineage-workspace.json; contribution.json here
retains its portable metadata. The command, typed client, native store/model,
MCP API, browser route manifest and Applications provider enter the existing
immutable-source builder. The managed provider uses the existing distribution's
lifecycle; the portable exported application runs independently.

browser-assets-loader.mjs is the unchanged original shared distribution
browser-assets.mjs, Git blob 63801fa838c0479e6ae156d9f155461f02df0cfb, retained
locally so the independently received application uses that same manifest
reader without an external package dependency.

The application is MIT licensed. Upstream event fixtures retain their
OpenLineage provenance and upstream license information in SOURCE_CONTRACT.md.

## Schema change review and staff resolution

Open **Schema changes** to compare two named saved editions, inspect original field observations and declared downstream paths, assign follow-up and retain complete staff decision history. Reviews use the existing workspace writer and saved-request recovery. HTML, CSV and JSON reports and editable workspace receiving carry the complete comparison, original sources and evidence. See [SCHEMA_OPERATIONS.md](SCHEMA_OPERATIONS.md) for the full UI, SDK, CLI, receiving and operating programme.

## Pipeline service levels

Open **Service levels** from the workspace header to maintain per-job freshness, duration and failure policies; evaluate original events at a stated time; and assign, acknowledge, resolve or accept incidents with complete decision history. The same workflow is available through `scf-lineage service-levels`, the typed service-levels client and the original native/merchant tools. See [SERVICE_LEVELS.md](SERVICE_LEVELS.md) for policy semantics, complete customer reports and editable receiving, and [SERVICE_LEVELS_OPERATOR.md](SERVICE_LEVELS_OPERATOR.md) for the operator desk.

## Dataset quality operations

The original browser's **Quality** view provides original metric and assertion history, exact dataset/run selection, saved rules, immutable evaluations and reasoned finding dispositions. Original producer severity, assertion success and observed run state are visible independently. A reported zero remains a value and an omitted metric remains unreported.

Use `QualityClient` from `./quality-client.mjs`, or the installed `@tokenjunkielabs/starforge-merchant/seller/openlineage/quality` export. Its seven methods call the existing `quality.*` actions through the original workspace HTTP owner. Rule, evaluation and disposition saves use the same operation IDs, revision checks and replay handling as the other application workflows.

The [complete quality operator and client guide](QUALITY_OPERATOR.md) explains the four desk views, metric and assertion rules, reports, original request recovery and full editable receiving. Existing schema and service-level operations remain available in the same application.

## Customer service reviews

Open `customer-service-review.html` in the original authenticated host to prepare an attributed customer handover from saved Service Levels assessments, Quality evaluations and comparisons, and retained result files. The preview includes the complete supporting original records and freezes incident, disposition and follow-up histories at one committed workspace revision. Saved reports and their full JSON/CSV/HTML downloads preserve that exact snapshot after later workspace changes.

Use `openlineage customer-review status|preview|prepare|request|save|resume|show|report` for the same native workflow. A create-only prepared request retains the complete preview before dispatch, and original operation lookup recovers accepted work. The existing workspace export/receive carries every original source and evidence file plus all historical customer reviews and the complete editable application. See [CUSTOMER_SERVICE_REVIEW.md](CUSTOMER_SERVICE_REVIEW.md) for the native/typed/MCP and recovery contract, and [CUSTOMER_SERVICE_REVIEW_OPERATOR.md](CUSTOMER_SERVICE_REVIEW_OPERATOR.md) for the browser workflow. Actual rendered/native receiving remains with the original equipped owner.

## Recipient review requests and returned responses

Open **Recipient returns** from the customer-review operator view after saving
the original customer service review. Select that immutable review, the intended
recipient, requesting operator and instructions. Preview and save the complete
request, then download its editable recipient HTML. Each request retains its exact
review edition, original selected records and recipient instructions.

The recipient can reopen that document, inspect the original records and enter
their attribution, item responses and overall response. The complete response JSON
is the file to return. In the original operator workspace, select the saved
request, open that returned JSON, preview its exact content, enter the receiving
operator and note, and retain the reviewed response. The response remains an
attributed statement in its own immutable history. Original assessments, incidents,
quality results, dispositions and saved customer reviews keep their existing
identities and decisions.

The [complete recipient-return guide](REVIEW_RETURNS.md) covers the offline
recipient document, operator recovery, SDK, exact input fields and complete
workspace receiving. The editable recipient document belongs to one saved
request; the whole workspace export includes the wider operator history and
original source files.

### Command line: keep the complete request

The installed command is `starforge openlineage review-return`.
The portable application uses `node cli.mjs review-return`, and the individual
`review-return-cli.mjs` remains directly executable.
All three use the same eight native actions.

Create a UTF-8 JSON request file containing these exact outer fields. Obtain the
original workspace ID from the selected application's status; keep that value
when receiving or reconnecting the same workspace.

~~~json
{
  "schema": "commons.openlineage.review-return-action.v1",
  "workspaceId": "ORIGINAL_WORKSPACE_ID",
  "action": "review-return.overview",
  "args": {}
}
~~~

Calculate SHA-256 from the complete saved file, including its actual whitespace.
This command only reads those bytes:

~~~sh
node --input-type=module -e 'import {readFileSync} from "node:fs"; import {createHash} from "node:crypto"; console.log(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"));' /absolute/requests/overview.json
~~~

Pass that hash explicitly. Output destinations are new files; repeating an action
can reopen an already complete byte-identical output.

~~~sh
node cli.mjs review-return \
  --workspace /absolute/private/lineage \
  --request /absolute/requests/overview.json \
  --expected-request-sha256 EXACT_REQUEST_FILE_SHA256 \
  --out /absolute/results/overview.json
~~~

For an existing HTTP workspace, replace `--workspace` with `--url` and,
where configured, its existing private token file. An explicit instance ID pins
the intended running instance. The request file still pins the original workspace.

~~~sh
starforge openlineage review-return \
  --url http://127.0.0.1:8767 \
  --token-file /absolute/private/operator-token \
  --instance-id CURRENT_INSTANCE_ID \
  --request /absolute/requests/overview.json \
  --expected-request-sha256 EXACT_REQUEST_FILE_SHA256 \
  --out /absolute/results/overview.json
~~~

Use a separate retained request file for each intended action:

| Action | Complete input in args | Result |
| --- | --- | --- |
| review-return.overview | An empty object | Saved reviews, requests and response summaries |
| review-return.request.preview | reviewId, recipient, requestedBy; optional instructions | Full original review and recipient, current revision and preview digest |
| review-return.request.save | Previewed input plus operationId, expectedRevision and expectedPreviewSha256 | Immutable saved request and native receipt |
| review-return.response.preview | requestId and originalText containing the entire returned JSON | Original/source binding, respondent entries, current history and preview digest |
| review-return.response.save | Previewed requestId/originalText plus receivedBy, optional operatorNote, operationId, expectedRevision and expectedPreviewSha256 | Retained response, original text and native receipt |
| review-return.operation.get | Original operationId and its expectedRevision | Original receipt or absence at the current committed revision |
| review-return.get | requestId | Full request and every saved response |
| review-return.report | requestId; optional format editable, json or html | Complete recipient HTML or JSON/printable history |

The recipient object contains name and optional organisation/reference. Mutation
files retain the original preview's revision and digest before dispatch; a current
workspace revision alone does not replace that preview. Keep the same complete
file, byte hash and operation ID after an interrupted response. Rewriting a
request with a new revision is a new intended operation and requires its own
inspected preview.

To receive a returned file, put its complete UTF-8 text into originalText using
JSON serialization. Preserve leading/trailing whitespace and original item
identities. The preview validates its full content before adoption. Report actions
write the complete report text directly: use .html for editable/html formats
and .json for complete history.

### Typed Node client

The complete selected distribution exports
`@tokenjunkielabs/starforge-merchant/seller/openlineage/review-return`.
An independently received application imports `ReviewReturnClient` from
`./review-return-client.mjs`. The adjacent declaration file provides recipient,
mutation and returned-review input types.

~~~js
import { ReviewReturnClient } from
  "@tokenjunkielabs/starforge-merchant/seller/openlineage/review-return";

const client = new ReviewReturnClient("http://127.0.0.1:8767", {
  token: existingOperatorToken,
  expectedWorkspaceId: originalWorkspaceId,
  instanceId: selectedInstanceId
});

const overview = await client.reviewReturns();
const preview = await client.previewRecipientRequest({
  reviewId: selectedSavedReviewId,
  recipient: { name: intendedRecipient, organisation: intendedOrganisation },
  requestedBy: requestingOperator,
  instructions: requestedReviewInstructions
});
~~~

After inspecting the complete preview, retain its exact input together with the
new operation ID, expectedRevision and expectedPreviewSha256 before calling
`saveRecipientRequest`. Keep that saved input for replay.
Use `previewReturnedReview(requestId, originalText)` and
`retainReturnedReview` for the analogous explicit receiving step.
`getReviewReturn`, `reviewReturnReport` and `reviewReturnOperation`
expose complete history, downloads and original receipt lookup.

### Native, MCP and merchant integration

The original `LineageWorkspace.dispatch`, HTTP `/api/action` and MCP
catalog expose the same actions. MCP names use the existing `lineage_` prefix
with dots/hyphens converted to underscores, for example
`lineage_review_return_request_preview` and
`lineage_review_return_response_save`. The catalog marks only the two saves
as mutations. Merchant connections retain their existing selected workspace and
authenticated transport; this feature adds no server or token store.

The following application edition carries all thirteen recipient-return source
files and the complete guide through the existing contribution and full
application inventory. Complete workspace export/receive preserves the original
requests, exact returned text, operation receipts and source review editions.
Historical application inventories remain available to the original receiver;
the complete following application retains its separate source selection.
