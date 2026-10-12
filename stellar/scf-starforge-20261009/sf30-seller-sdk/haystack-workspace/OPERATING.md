# Haystack turnover workspace — operating guide

This workspace turns complete native Project Haystack grids into a reviewable building handover. It retains the original files, keeps every record tied to its source, records deliberate tag decisions, and saves immutable editions that can be compared and delivered with the complete editable application.

The browser and CLI use the same workspace actions. A proposal prepared through one interface can be read and decided through the other. Both preserve native JSON values, original operation IDs and explicit workspace revisions.

## 1. Create or open a local workspace

Use Node.js 22 or later. The application uses the Node standard library and browser platform APIs; its local workflow does not require an npm install.

Run these commands from the application directory:

~~~sh
node cli.mjs init --directory ./handover --title "Building handover"
node cli.mjs serve --directory ./handover
~~~

The first command creates the chosen workspace directory, or reads that same existing workspace. The second opens its local server and prints the browser address, workspace ID, server instance ID and connection-file path. Open the printed address in the browser.

The default server listens on `127.0.0.1:8768`. Its local access token is blank unless you configure one. In **Open workspace**, leave the token empty for that default local connection. When the server was started with `--token-file`, enter the token from that private file. The browser retains the token only in the current tab's memory.

To select a different local port:

~~~sh
node cli.mjs serve --directory ./handover --port 8770
~~~

To use an existing token file:

~~~sh
node cli.mjs serve --directory ./handover --token-file ./private-access-token.txt
~~~

The browser connects to the server that served its page. To open another workspace, run that workspace's server and open its printed address. The CLI can connect directly to a running server by URL or by the original connection file:

~~~sh
node cli.mjs status --connection ./handover/connection.json
node cli.mjs status --url http://127.0.0.1:8768
~~~

Add `--token-file ./private-access-token.txt` when that server uses a token. An explicit `--workspace-id UUID` pins the expected workspace. A connection file also carries the original server instance identity. After restarting that same workspace, use its new connection file, or deliberately reconnect with the old workspace identity:

~~~sh
node cli.mjs status --connection ./handover/connection.json --reconnect
~~~

A changed server instance is a new connection to the same saved workspace. Previously retained mutation requests keep their original IDs and arguments.

## 2. Understand the working selection and saved editions

The workspace distinguishes three useful things:

| Item | What it retains | Operator action |
| --- | --- | --- |
| Original source | Complete imported file bytes, file name, provenance, source SHA-256, parsed grid metadata and original import findings | Import once; download the exact original file whenever needed |
| Working selection | Explicit source IDs plus accepted tag proposals that apply to those sources | Choose sources, prepare proposals, accept or reject decisions |
| Saved edition | Exact selected sources, accepted proposal IDs, material identity, counts and diagnostic identity at one saved point | Save an edition; inspect, compare and export it later |

A source identity is the SHA-256 of its original bytes. Importing exactly the same bytes again returns the original retained source metadata. It preserves the current selection. Use **Use selected sources** to change the working selection deliberately.

Different versions of a source file have different identities when their bytes differ. They can both remain in the workspace. Choose the version that belongs in the next edition. Saved editions continue to use the exact sources they originally selected.

Accepted tag changes are applied to the working material while the imported source bytes remain available in their original form. An accepted proposal follows its exact original source identity. Selecting a replacement file does not silently transfer edits to a different source.

## 3. Import complete native grids

In **Source files**, choose one or more native Haystack JSON-v4 files. Enter an optional source URL or provenance reference. The checkbox **Add each imported file to the working selection** controls selection for newly imported sources.

Choose **Import original files**. Files are imported sequentially. Before sending each source, the browser retains its complete original request, including the file's base64 bytes. The progress line identifies the file currently being imported. Completed earlier files remain retained if a later file needs correction or the connection is interrupted.

The original source table lists all retained files. It shows full source identities, source names, provenance, record and column counts, and import times. **Original file** downloads the complete original bytes. **Details** opens the retained metadata, including the original import diagnostics.

Equivalent CLI import:

~~~sh
node cli.mjs import \
  --directory ./handover \
  --file ./fixture-charlie.json \
  --source-url "Original source reference" \
  --request-file ./requests/import-charlie.request.json
~~~

Use `--name` to supply the retained source name. Use `--no-select` to retain the source without adding it to the working selection.

The browser also offers **Import Charlie example**. This reads the complete bundled original file and retains it through the same import request and recovery workflow; it is an explicit operator action.

The bundled `fixture-charlie.json` is the complete native fixture distributed with the application. Its exact origin and license are recorded in `fixtures.json`, `HAYSTACK_CONTRACT.md` and `HAYSTACK_LICENSE.txt`. Import it through the same source action used for a supplied project file.

To read every retained source through the CLI:

~~~sh
node cli.mjs sources --directory ./handover --out ./all-sources.json
~~~

To retrieve the exact original bytes:

~~~sh
node cli.mjs source-download \
  --directory ./handover \
  --source-id SOURCE_SHA256 \
  --out ./original-source.json
~~~

An import retains a complete file of 1 byte to 32 MiB. The workspace supports up to 100 distinct retained source files. Its complete saved state must remain within 128 MiB. A source that exceeds the native type or size requirements produces an actionable error while the original request remains available for inspection.

## 4. Choose source editions explicitly

Check the source files that belong in the working selection, then choose **Use selected sources**. Checkbox changes are a selection draft until that action completes.

The table can select all retained sources or clear the draft selection. Clearing the working selection is useful when choosing a new combination of source editions. Saving a handover edition requires at least one selected source.

The browser retains this tab's selection draft separately from other tabs' drafts. Refreshing the workspace preserves a pending draft so the operator can compare it with the current saved selection before applying it.

CLI selection accepts repeated source IDs:

~~~sh
node cli.mjs select \
  --directory ./handover \
  --source-id FIRST_SOURCE_SHA256 \
  --source-id SECOND_SOURCE_SHA256 \
  --request-file ./requests/select-sources.request.json
~~~

Alternatively, save the complete ordered array of source IDs in a JSON file and use `--sources-file ./selected-sources.json`. An empty array deliberately clears the selection.

## 5. Inspect the asset register and hierarchy

Open **Asset register**. Choose the working selection or a saved edition, then optionally filter by source, record role or search text. The role filter includes sites, equipment, points and all records.

Each displayed record retains:

- Its original source ID and zero-based source row index.
- Its native reference ID, display label and recognized roles.
- Every complete native tag value.
- Its `siteRef`, `equipRef` and other indexed references.
- The complete relationship states and relevant diagnostics.

Choose a record to read the full detail panel. Relationship entries show the exact source-local targets. Resolved references link to their target records; ambiguous references keep every matching candidate in the same source. Incoming references identify the original referring row.

Reference ID strings belong to their original source. A matching string in another source remains a separate record. The workspace records cross-source candidates as diagnostic context without joining those sources implicitly.

Use **Propose edit** beside a tag to copy its exact current native value into the proposal editor. **Use record in proposal** starts with the exact source-row identity. A tag copied from a saved edition is previewed against the current working material before a new proposal can be prepared.

The browser reads record pages with the workspace revision pinned. The page line shows its offset, complete total and revision. **Next** and **Previous** use the returned continuation. Filters take effect when **Apply filters** is chosen.

The CLI reads the complete matching collection by default:

~~~sh
node cli.mjs records \
  --directory ./handover \
  --role point \
  --out ./complete-point-records.json

node cli.mjs record \
  --directory ./handover \
  --record-key SOURCE_SHA256:ROW_INDEX
~~~

Add `--edition EDITION_SHA256` to read a saved edition. Add `--source-id` or `--query` to narrow the selected view.

For one explicit page:

~~~sh
node cli.mjs records \
  --directory ./handover \
  --page --offset 0 --limit 250
~~~

That response includes the original `nextOffset`, `hasMore` and total. The regular list command continues every page and writes the complete collection.

## 6. Read diagnostics in their source context

**Diagnostics** filters effective findings by edition, source, severity or exact record key. Every row can show its complete original finding, including its code, message, source identity and native tag location.

A finding's record link opens the same record in the same selected edition. The detail panel lets the operator inspect the typed value and the surrounding source-local hierarchy before deciding on a correction.

Effective diagnostics are calculated from the selected material, including accepted tag changes. Original import findings stay on each retained source's metadata so the imported source can be inspected separately.

CLI examples:

~~~sh
node cli.mjs diagnostics \
  --directory ./handover \
  --severity warning \
  --out ./current-warnings.json

node cli.mjs diagnostics \
  --directory ./handover \
  --edition EDITION_SHA256 \
  --record-key SOURCE_SHA256:ROW_INDEX
~~~

Changing a tag can change the effective findings. Proposal previews show the resulting diagnostics before the operator accepts the changes.

## 7. Prepare native typed tag proposals

Open **Tag reviews**. Enter a proposal title and an optional review note. Add one or more edits, each tied to an exact record key and tag.

A set edit supplies the complete native JSON-v4 value. A remove edit retains the source-row/tag identity and makes that tag absent.

The native value editor accepts JSON directly. For example, a string value is:

~~~json
"Supply air temperature"
~~~

Copy an existing marker, reference, number with unit, date, time or other native value from the record detail panel when editing that type. The complete native representation appears in the editor. The application preserves type fields, units, timezone information and signed zero through its shared JSON codec. The included `HAYSTACK_CONTRACT.md` describes the supported native encodings.


Native JSON-v4 examples:

| Value | Complete native JSON |
| --- | --- |
| Marker | `{"_kind":"marker"}` |
| Reference | `{"_kind":"ref","val":"opaque-id","dis":"Display"}` |
| Number with unit | `{"_kind":"number","val":23.5,"unit":"°C"}` |
| Zoned date-time | `{"_kind":"dateTime","val":"2026-10-12T10:30:00-04:00","tz":"New_York"}` |
| Primitive values | `null`, `true`, `"Supply air temperature"`, `23.5`, `-0` |

A native grid uses `"_kind":"grid"`, `"meta":{"ver":"3.0"}`, complete `cols` declarations and original `rows` dictionaries. Missing tags and tags whose value is `null` retain different meanings.

The complete edits array is also editable. A proposal might contain:

~~~json
[
  {
    "recordKey": "SOURCE_SHA256:ROW_INDEX",
    "tag": "dis",
    "action": "set",
    "value": "Supply air temperature"
  },
  {
    "recordKey": "SOURCE_SHA256:OTHER_ROW_INDEX",
    "tag": "temporaryTag",
    "action": "remove"
  }
]
~~~

Replace the record-key placeholders with exact IDs from the register. Each proposal can contain 1 to 2,000 distinct record/tag edits. The server checks complete native values, selected source rows, tag names and duplicate targets. A set must include its value; a remove uses the original tag identity without a value.

**Preview changes** reads the draft against the current workspace revision. The preview shows every before-and-after value, whether a tag was present, resulting record counts and the complete resulting diagnostics.

**Prepare review** saves the complete proposal and its original before-values. It does not accept it. Open the prepared proposal to inspect every saved change and the available current preview, then choose **Accept these changes** or **Reject proposal** with an optional decision note.

A proposal's accepted or rejected decision remains in the workspace history. If its working material changed after preparation, the review is marked stale. Read the current records, prepare a new proposal against those values, and preserve the earlier proposal as its own original review.

The browser retains the proposal draft for the current workspace and tab. Each original mutation request is retained separately. Reopening a different workspace does not overwrite the previous workspace's draft.

CLI proposal workflow:

~~~sh
node cli.mjs preview \
  --directory ./handover \
  --edits ./tag-edits.json \
  --out ./tag-preview.json

node cli.mjs propose \
  --directory ./handover \
  --title "Normalize point display names" \
  --edits ./tag-edits.json \
  --note-file ./review-context.txt \
  --request-file ./requests/prepare-tag-review.request.json

node cli.mjs proposals --directory ./handover --state proposed

node cli.mjs proposal \
  --directory ./handover \
  --proposal-id PROPOSAL_UUID

node cli.mjs review \
  --directory ./handover \
  --proposal-id PROPOSAL_UUID \
  --decision accept \
  --note "Reviewed against the source-linked register." \
  --request-file ./requests/accept-tag-review.request.json
~~~

Use `--decision reject` to record a rejection. `--note` and `--note-file` are alternatives. Titles are limited to 160 characters; complete notes and source provenance are limited to 4,000 characters.

## 8. Save an immutable edition

After choosing sources and deciding the intended proposals, open **Saved editions**. Enter the edition title and optional note, then choose **Save immutable edition**.

The edition captures the complete selected source IDs and accepted proposal IDs. Its identity also binds its title, note, save time, material identity, counts and diagnostic identity. Later working selection changes leave that saved edition available for inspection and export.

The saved-history table links directly to its register, metadata and delivery options. The CLI exposes the same edition history:

~~~sh
node cli.mjs save \
  --directory ./handover \
  --title "Mechanical handover — review 1" \
  --note "Source selection and reviewed point names." \
  --request-file ./requests/save-edition-1.request.json

node cli.mjs editions --directory ./handover --out ./edition-history.json

node cli.mjs edition \
  --directory ./handover \
  --edition EDITION_SHA256
~~~

The working workspace revision advances when a source import, selection, proposal preparation, decision, rename or edition save is recorded. A saved edition's own material remains immutable.

## 9. Compare editions and replacement source exports

Choose **Before** and **After** in the saved-edition comparison. Read all changes or filter to added, removed, changed or unchanged records.

Each comparison row retains the full before and after records, the exact source identities, and every typed tag difference. The total counts describe the complete comparison; the table continuation reads its remaining rows.

For two editions based on the same original source, native reference IDs and original row identities keep the comparison attached to that source.

To compare a replacement source export, supply explicit one-to-one source pairs:

~~~json
[
  {
    "beforeSourceId": "BEFORE_SOURCE_SHA256",
    "afterSourceId": "AFTER_SOURCE_SHA256"
  }
]
~~~

The earlier source must belong to the before edition, and the later source to the after edition. Each source can appear in at most one pair. The pairing is part of the comparison request and remains visible in its complete metadata.

Unique reference IDs can align records within that explicit source pair. Missing or duplicated IDs retain their individual original row identities. Records that cannot be aligned appear as their actual additions and removals. Other sources keep their distinct identities.

CLI comparison:

~~~sh
node cli.mjs compare \
  --directory ./handover \
  --before BEFORE_EDITION_SHA256 \
  --after AFTER_EDITION_SHA256 \
  --source-pairs ./source-pairs.json \
  --out ./complete-edition-comparison.json
~~~

Omit `--source-pairs` when comparing the same original sources. The default CLI command reads the entire comparison, including all pages.

## 10. Prepare source-linked reports

Open **Reports & delivery**. Choose the working selection or a saved edition.

| Delivery | Scope | Formats |
| --- | --- | --- |
| Asset and point register | Complete selected source set, optionally filtered to sites, equipment or points | JSON, CSV, HTML |
| Diagnostics report | Complete findings for the selected material | JSON, CSV, HTML |
| Native source grid | One exact source from the selected material | Native JSON-v4 |
| Complete editable workspace | Every retained original source, proposal, edition and saved mutation, plus the complete application | Workspace JSON package |

The register retains source IDs, source names, provenance, original row indexes, reference IDs, display names, roles, parent references, source-local relationship targets, kind, unit and complete native tag values. JSON preserves the structured report. CSV includes complete native tags and relationships as JSON fields. HTML includes the complete register and diagnostic tables.

Choose **Prepare delivery**. The result shows the full byte count, SHA-256, original operation ID and preparation time. **Download complete file** reads the whole prepared payload and verifies its complete byte identity.

Preparing a delivery preserves the current workspace revision. The completed file belongs to the original delivery operation. Replaying that original operation returns the same completed payload, even after later edits to the local workspace.

CLI examples:

~~~sh
node cli.mjs report \
  --directory ./handover \
  --kind register --role point --format csv \
  --edition EDITION_SHA256 \
  --request-file ./requests/point-register.request.json \
  --out ./point-register.csv

node cli.mjs report \
  --directory ./handover \
  --kind diagnostics --format html \
  --edition EDITION_SHA256 \
  --request-file ./requests/diagnostics.request.json \
  --out ./diagnostics.html

node cli.mjs native-grid \
  --directory ./handover \
  --source-id SOURCE_SHA256 \
  --edition EDITION_SHA256 \
  --request-file ./requests/native-grid.request.json \
  --out ./reviewed-native-grid.json
~~~

The native grid contains that source's selected material, including accepted tag changes. **Original file** and `source-download` retrieve the originally imported bytes.

Without `--out`, delivery commands return their complete receipts. Download any completed local delivery later:

~~~sh
node cli.mjs delivery-download \
  --directory ./handover \
  --operation-id DELIVERY_OPERATION_UUID \
  --out ./completed-delivery.json
~~~

## 11. Export and receive the complete application

Choose **Prepare complete workspace** to produce a complete editable workspace package. It contains the full saved state, every original source byte, all proposals and editions, the original saved mutation history, and every application file declared by the package.

The package retains the native parser and index, browser and CLI, server and client, report generator, receiving code, official fixture and licensing, and operator documentation. The receiver verifies the complete package identity, state, source bytes and every application file.

CLI export and verification:

~~~sh
node cli.mjs export-workspace \
  --directory ./handover \
  --request-file ./requests/full-workspace.request.json \
  --out ./handover-workspace.json

node cli.mjs verify \
  --file ./handover-workspace.json \
  --out ./verified-workspace.json
~~~

Receive into a new explicit directory:

~~~sh
node cli.mjs receive \
  --file ./handover-workspace.json \
  --destination ./received-handover
~~~

The receiving receipt reports the exact installed application path and launch arguments. The installed application is in `received-handover/application`, and the received workspace state is in `received-handover/workspace.json`.

Start it from the directory containing `received-handover`:

~~~sh
node ./received-handover/application/cli.mjs serve \
  --directory ./received-handover \
  --port 8770
~~~

The receiving operation keeps its original installation identity. If interrupted during installation, repeat the same receiving command with the same package and destination. It resumes the original installation. A destination containing unrelated work is rejected. Repeating a completed receiving operation returns its original completed receipt.

The received workspace preserves the original workspace identity and full saved mutation history. It can be reopened, inspected, edited, saved as later editions, and packaged again with its installed application. Keep any separately prepared register, diagnostic or native-grid files alongside the delivered package when those particular completed outputs are part of the handover.

The complete workspace package has a 192 MiB limit. Its application files have their own declared complete-file limits. A size error reports the complete affected operation; prior saved editions and original sources remain available for a deliberate delivery choice.

## 12. Continue an interrupted original action

Open **Operations** to see two useful views:

- **Requests retained in this browser** lists each complete original request, its operation ID, expected revision, last known state and continuation actions.
- **Workspace operation history** reads the complete saved mutation history at the current revision.

The browser keeps each operation in its own storage record. Different tabs can retain different operations without replacing one another's original requests.

For an interrupted action, choose **Read receipt** first. A completed result is recovered under its original operation ID. Completed delivery receipts reopen the original prepared file.

If no completed receipt exists, **Resend original** presents the exact action identity for an explicit resend. It uses the same operation ID, expected revision and complete original arguments, including any source bytes. It does not turn the action into a new operation.

If the workspace has changed, the original request can be rejected with a revision conflict. Refresh the workspace and inspect the current selection before preparing a new intended action. The earlier request and any proposal draft remain available to inspect.

The CLI retains complete request files before it sends mutations. Choose a path with `--request-file`, or a directory with `--request-directory`. Defaults are:

- Local workspace: `WORKSPACE/requests/OPERATION_UUID.request.json`.
- Server connection: `./haystack-requests/OPERATION_UUID.request.json`.

After completion, a separate `.receipt.json` file retains the result. Request files remain original. Output and receipt files accept an existing path only when the original content is compatible with the same completed result.

Replay the original command:

~~~sh
node cli.mjs replay \
  --directory ./handover \
  --request-file ./requests/prepare-tag-review.request.json
~~~

For a completed delivery:

~~~sh
node cli.mjs replay \
  --directory ./handover \
  --request-file ./requests/full-workspace.request.json \
  --out ./handover-workspace.json
~~~

Replay first reads the original operation receipt. If no completed receipt exists, it sends the same complete request. It preserves the original expected revision even when the current workspace revision is newer.

For a new action, `--expected-revision N` selects the exact revision the operator reviewed. When omitted, the CLI reads current status once before preparing the new request. It performs the mutation once and returns the actual result or error.

## 13. Writer recovery and local automation

The workspace records an exclusive local writer while applying a mutation or completing a delivery. Inspect it through the original local directory:

~~~sh
node cli.mjs writer --directory ./handover
~~~

If a process was interrupted and its writer record remains, use the exact recorded lock ID:

~~~sh
node cli.mjs recover-writer \
  --directory ./handover \
  --lock-id ORIGINAL_WRITER_UUID
~~~

The original store confirms the owning computer, writer identity and stopped process before recovering that writer. After recovery, continue the original retained mutation request.

The same complete action set is available over JSON-RPC:

~~~sh
node cli.mjs rpc --directory ./handover
~~~

This command reserves stdout for protocol responses. The application also provides `mcp.mjs`, the action catalog and the browser-compatible client module for integration.

To inspect every declared action and its complete argument schema:

~~~sh
node cli.mjs catalog --out ./haystack-action-catalog.json
~~~

A general CLI action can use an exact arguments file:

~~~sh
node cli.mjs request records.list \
  --directory ./handover \
  --args ./record-page-arguments.json
~~~

The general request command returns that action's exact response. For a paged read, use its declared continuation or use the regular list command to retrieve the complete collection. For a mutation, the command retains the complete original request before sending it.

## 14. Handover completion

A finished handover should make the intended source selection easy to inspect, carry every accepted tag decision with its original before-values, and identify the saved edition used for the reports. The delivered package gives the next operator the full editable workspace and application; the accompanying register and native grids give them directly usable source-linked outputs.

Open the received application, read the saved edition's register and diagnostics, and compare the retained source identities with the delivery receipt. Continue work from that received history when another review cycle is needed.

## Corrective work and returning operator changes

Open **Work items** to capture findings from the native register or diagnostics, assign work, retain completed evidence, submit a material snapshot and review its disposition. The [complete corrective-work guide](CORRECTIVE_WORK.md) covers the queue, review rounds, downloadable evidence, full reports and original-operator acceptance of returned project changes.
