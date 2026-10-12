# Google Sheets source workspace

Create a reviewed merchant source from the original Sheet cells, then use the
existing dataset publisher to publish and serve it. The browser handles source
authoring: workbook and range selection, public columns, typed preview, saved
source versions, comparison and private handoff. It calls the original
[Sheets projector](../source.mjs) and opens the original
[dataset publisher](../../postgres/publisher/README.md) against the selected
source file.

The source workspace runs on Linux with Node 22.16 or later and util-linux
flock. It has no additional npm dependency or frontend build. Keep its private
directory outside the source checkout. Examples below use placeholder absolute
paths; choose the actual operator directories on the host.

## Open the browser

From the installed merchant package:

~~~sh
starforge sheets-source workspace serve \
  --directory /private/sheets/catalog-source --create --port 8453
~~~

From the repository root, the equivalent entry is:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/cli.mjs workspace serve \
  --directory /private/sheets/catalog-source --create --port 8453
~~~

Open the complete printed URL. It contains a capability in the fragment; the
browser retains it for this local session. The server binds to 127.0.0.1 and
requires its exact Host, Origin and session capability for private API calls.
A fresh process prints a new capability. The directory and files are created
with private permissions and use the original publisher's workspace flock.
One owning process opens the source workspace at a time.

To reopen, use the same command without --create. Reopening reads retained
state. Google reads and the original publisher start only when explicitly
requested. Stop the server with Ctrl-C before opening this source workspace
through a separate CLI invocation.

By default, the source workspace creates its dataset state at
catalog-source/dataset and the original publisher at catalog-source/publisher.
At initial creation, --state can name a separate dataset state directory. A
configured running original dataset seller can be supplied using --seller and
--resource; the original publisher then offers its native buyer handoff. These
options use the original publisher contract and do not create a signer.

## Import the original observation

In **Observations**, select either the complete JSON Spreadsheet resource from
a connected spreadsheets.get CellData response or a private source packet
exported from this workspace.

For a Spreadsheet resource:

1. Select the actual captured tab by title and numeric sheet ID.
2. Enter the exact A1 rectangle requested in the original provider read,
   including its header and final row. For example, A1:H500.
3. Enter a useful observation title and select **Retain observation**.
4. The workspace retains the exact original resource bytes and the original
   capture manifest before opening the column review.

The input includes spreadsheetId, properties, sheets.properties and
sheets.data.rowData.values with native userEnteredValue, effectiveValue and
effectiveFormat.numberFormat. A values-only response, formatted CSV or screenshot
does not contain that CellData contract. The complete resource limit is 64 MiB;
the original selected rectangle supports at most 1,000,000 cells.

The JSON may omit trailing blank cells or rows. That omission does not define
the rectangle the provider was asked to read. Enter the original requested
rectangle instead of inferring it from the rowData array length.

The observation list shows its exact source SHA-256, received time, range and
transport. Import records local receipt of the supplied original file.
The original capture format identifies one Spreadsheet response; it does not
claim a historical Google revision.

## Use a declared Google connection

A host can make existing connections available to this browser with a private
JSON file:

~~~json
{
  "merchant": {
    "label": "Merchant Google account",
    "oauthDirectory": "/private/google/merchant"
  }
}
~~~

Then start with:

~~~sh
starforge sheets-source workspace serve \
  --directory /private/sheets/catalog-source \
  --connections /private/sheets/connections.json --port 8453
~~~

The renewable directory is the connection created by the original
[sheets-source auth workflow](../auth/README.md). That original account and
scope review, token refresh, disconnect and recovery workflow remains the
credential owner. Use its status command to inspect the connection:

~~~sh
starforge sheets-source auth status --directory /private/google/merchant
~~~

For an existing process-supplied access token, a connection can instead name
accessTokenEnv, such as GOOGLE_SHEETS_ACCESS_TOKEN. Supply the token through the
host's existing private environment mechanism. The connections file stores its
name, not its value. Each alias declares exactly one of oauthDirectory and
accessTokenEnv. Optional timeoutMs and maxResponseBytes use the original source
limits.

In the browser, select the declared connection and paste the exact Google Sheets
workbook URL or ID. **Load workbook tabs** makes a metadata-only request for that
workbook. Select a GRID tab, enter a bounded rectangle, then choose **Read and
retain this range**. The CellData read uses the original fetchSheetsResource,
including its fixed endpoint, exact range binding, size and time limits, and
existing renewable-connection behavior. This workspace does not request a
Drive-wide file listing, modify cells, alter sharing or create a new grant.

A read that returns no retained successful response is not silently repeated by
recovery. An operator can request a new observation after resolving its original
operation. Every actual read receives its own original request ID.

## Review public columns

A newly selected observation begins with every column unchecked. The private
column table displays actual header text, native type counts, formula, error,
date and unsafe-integer observations, plus at most four short private samples.

Choose the public columns explicitly. For each selected column, set:

| Setting | Meaning |
|---|---|
| Public name | The alias exposed to the publisher and buyer. |
| Type | string, integer, number or boolean, enforced by the original projector. |
| Allow blank | Whether a missing effective cell may become null. |
| Formula values | Reject formula cells, or explicitly use their native effective value. |
| Original binding | Absolute column letter and exact literal header, retained together. |

The type shown initially is a suggestion from the observed native values.
Selection is explicit. A string-looking number is not coerced; long numeric
identifiers should originate as Sheet text if exact digits are required.
Date-formatted numeric cells retain the original extractor's rejection behavior.
Formula errors, unsafe integer values, mixed types and missing required cells
are reported by the original projector.

A narrowed rectangle must stay within the retained capture. Its first row
becomes the reviewed header row. After changing the range, select **Inspect this
range**. Existing checked bindings remain checked only when both their source
letter and exact header still match. New or changed columns require review.

Choose how completely blank projected rows should be handled: reject for review,
or skip them. Unselected private fields do not become public offered columns.

**Future publisher reads** selects one of two original source modes:

- **This exact retained observation** gives new publisher plans those exact
  captured bytes. Capturing a later Sheet state does not retarget earlier plans.
- **New Google observation at each extraction** saves the reviewed declaration
  and host connection reference. Each explicit extraction under that live plan
  captures a new response through the original source engine.

The source-editor preview always uses the exact selected retained observation,
including when the future source mode is live.

## Validate, save and compare sources

Select **Save draft**, or **Validate and preview public rows**, which first
saves the current draft. Draft saves use the current revision, so another window
cannot silently replace a draft saved after yours was opened.

Preview runs the original typed export over the full selected rectangle. It
validates every projected row and retains the original report and at most 25
public sample rows. It uses the first selected public column for ascending
preview order. This preview does not create a published dataset.

Enter the reviewer and source change note, then choose **Save reviewed source
version**. A saved version binds the exact draft revision, preview, source file,
capture hash and review note. The workspace selects that version by atomically
updating its private current-source.json. The selected source file is managed
by this workspace; do not edit it independently.

In **Versions & publisher**:

- **Use for next plan** selects a previously saved source version.
- **Edit projection** opens a retained version as a new editable draft.
- **Compare** shows the two retained ranges, modes, observation hashes, original
  saved previews and each public binding's addition, removal or change.
- **Private source packet** downloads the exact source handoff described below.

Comparison does not reread Google or recalculate a new preview. Old source
versions, original publisher plans and previously published datasets remain
retained.

## Publish through the original merchant flow

Choose **Open original publisher**, then **Go to open publisher**. This opens the
unchanged native publisher browser for the selected current-source.json and
configured dataset state.

Use that original browser to:

1. Inspect the selected named query and exact scalar columns.
2. Save a plan with the public dataset shape, ordering, page controls and limits.
3. Extract a candidate and inspect its original row preview and source report.
4. Review that candidate against the current native target, then publish it.
5. Use the original configured seller and buyer preparation for the published
   snapshot, and the original scheduler for any explicitly configured refresh.

For capture-backed plans, the original publisher copies the exact manifest and
resource into its private plan directory. A live plan retains its reviewed
source declaration and captures a new observation for each extraction. Completed
extractions retain their own original response and candidate.

Selecting a new source version affects the source offered when creating a new
plan. Existing plan IDs, candidate IDs, reviews, publications, scheduler jobs,
buyer configurations and snapshot/cursor behavior belong to the original
publisher and dataset engines. Source comparison and source packet import do
not perform publication.

The publisher's own workspace directory is shown in the source browser. It can
also be reopened through the existing sheets-publisher command after the owning
source process has stopped. See the
[original publisher guide](../README.md#inspect-review-and-publish-in-the-original-browser)
for exact options. An old publisher URL belongs to its old process; open the
current publisher from the source workspace after a restart.

## Private source handoff and reopening

A downloaded stellar-forge.sheets-source-packet.v1 file includes:

- The exact original CellData bytes, byte length and SHA-256.
- The original capture manifest and its SHA-256.
- The reviewed query, source-column bindings and source-version review metadata.
- The exact original observation retained for the saved preview.

It includes private cells from the captured rectangle, including unselected
fields. Treat the whole packet as a private operator handoff. A live source is
exported as a capture-backed source: token values, OAuth-directory references
and environment-variable references are not transferred.

To adopt it on another operator workspace, choose the packet under
**Observations**, enter its title, and import it. The workspace verifies its
original byte hashes and capture manifest, then creates a capture-backed draft.
Review and preview that draft before saving a new local source version. Attach
an existing local host connection only if future live reads are desired.

A source packet is a source handoff. The complete source history is in the
source workspace, and the original publisher and dataset state retain their own
histories and publications. Preserve those complete private directories for
whole-workflow backup and restoration after stopping their owning processes.

## Interrupted requests

Each mutation has one UUID and a durable original operation. The browser saves
a small receipt marker before dispatch. It stores no CellData or token in that
marker. After a lost response it disables new mutations while the original
request is unresolved.

| Original state | Operator action |
|---|---|
| complete | Reuse the retained result; no duplicate action is created. |
| pending | Check the same original receipt after the active work finishes. |
| interrupted | Resume that exact retained request. |
| failed | Review the recorded error, correct the input and create a new intent. |
| No receipt after an uncertain response | Retry the same request ID and exact payload; reselect the exact same file if the browser no longer has its bytes. |

A confirmed HTTP input error with no admitted operation can be corrected once
its response is known. A failed receipt lookup never authorizes a new UUID.
If the process has restarted, **Operations** also exposes retained operation IDs
and the original resume action.

Recovery uses already retained input bytes. It does not repeat an uncertain
Google read or silently reopen the publisher. A saved source version whose local
pointer update was interrupted reconciles only that known version selection.
Original publisher extraction and publication recovery remain in its own
existing workspace.

For CLI recovery, stop this source server first:

~~~sh
starforge sheets-source workspace operation \
  --directory /private/sheets/catalog-source --request ORIGINAL_UUID
starforge sheets-source workspace resume \
  --directory /private/sheets/catalog-source --request ORIGINAL_UUID
~~~

Read-only status is paginated:

~~~sh
starforge sheets-source workspace status \
  --directory /private/sheets/catalog-source \
  --limit 25 --captures-offset 0 --versions-offset 0
~~~

Use workspace --help for import, capture, headers, draft, preview, save, select,
compare, export and import-package commands. CLI mutations require an explicit
request UUID and the current revision or selected-version guard where relevant.

## Existing-source API

The module exposes openSheetsAuthoring from model.mjs. Its handle owns the
private workspace until close resolves. The returned methods correspond directly
to the browser's operations.

| Endpoint | Request / result |
|---|---|
| GET /api/status | Current draft and revision, selected version, original publisher address, paginated captures/versions and recent operation summaries. |
| POST /api/workbook | connectionAlias and exact spreadsheet URL/ID; returns metadata only. |
| POST /api/capture | Declared connection, workbook, exact tab ID/title and bounded range; retains the original read. |
| POST /api/import | Exact base64 resource bytes, length, SHA-256, original requested range, title and requestId. |
| GET /api/capture?id=UUID&range=A1:H500 | Retained observation and original column statistics for that optional subrange. |
| POST /api/draft | draft, expectedRevision and requestId. |
| POST /api/preview | Saved draftRevision and requestId; returns the original extractor report and public sample. |
| POST /api/version | draftRevision, previewId, reviewer, note, expectedSelectedVersion and requestId. |
| POST /api/select | versionId, expectedSelectedVersion and requestId. |
| GET /api/compare?left=N&right=N | The two retained versions, binding differences and original saved previews. |
| GET /api/export?id=N | Exact private source packet download. |
| POST /api/import-package | packet, title, expectedDraftRevision and requestId. |
| POST /api/publisher/start | expectedSelectedVersion and requestId; opens the original publisher. |
| POST /api/publisher/stop | requestId; drains and stops the owned original publisher. |
| GET /api/operation?id=UUID | Original operation receipt, or null when not admitted. |
| POST /api/resume | The original requestId. |

Private API requests carry x-sheets-workspace-token from the current printed
capability URL. A source draft names captureId, title, query name, A1 range,
columns, emptyRows, mode and optional connectionAlias. Each columns entry
contains the original column letter, exact header, scalar type, nullable flag and
formula rule. The API does not accept a token or arbitrary credential path from
the browser.

## Source layout

model.mjs retains source observations, drafts, previews and reviewed versions.
provider.mjs resolves declared original connections and metadata-only workbook
reads. server.mjs serves the private browser and API. browser.mjs, index.html and
style.css provide the responsive operator flow. cli.mjs is nested under the
maintained sheets-source command.

The original capture, declaration, source, OAuth, publisher, scheduler, dataset
version and buyer engines are reused directly. A source authoring revision is
distinct from an original publisher plan and a published dataset snapshot.

## Merchant deployment

After the original publisher records a matching PUBLISHED run, the **Merchant deployment** panel reviews its exact source version and public merchant terms, prepares the original five-file dataset package and stages an immutable SF82 release. It opens the original deployment console for native comparison, selection, start, restart, drain, rollback and receiving. The same source workspace owns that console; closing the workspace drains its owned merchant. Reopen retains packages and selection without starting a merchant. The [deployment guide](../DEPLOYMENT.md) provides the complete browser, CLI, MCP, file download and request recovery workflow, including the original dataset binding and rollback semantics.
