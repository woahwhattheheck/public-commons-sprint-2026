# Run the Bitwave merchant close from an MCP client

The merchant MCP service operates the complete retained Bitwave Data Fusion
workflow inside the original accounting workspace. An agent can freeze a reviewed
merchant close, create or select its native loaded table, deliver original rows,
capture the table, review source and concurrent bookkeeping changes, apply an
accountant return and transfer the complete handoff. The browser and MCP reopen
the same plans, request/response files, captures and accountant revisions.

The original `BitwaveWorkspace`, `BitwaveHttpClient`, accountant return engine and
accounting lease perform these operations. The adapter adds thirteen tools to the
existing thirty-nine accounting tools. It shares the existing merchant process,
stdio/HTTP transport, file reader and installed package.

For the browser workflow and the native request contract, see
[Bitwave merchant/accountant operation](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/BITWAVE_WORKFLOW.md).
For source reconciliation, period closes and the original accountant packet, see
[Accounting](./ACCOUNTING.md). The underlying native formats are documented by
Bitwave in [loaded data sources](https://docs.bitwave.io/docs/api-loaded-data-sources),
[table-row retrieval](https://docs.bitwave.io/docs/get-datasource-rows) and
[authentication](https://docs.bitwave.io/reference/gettoken).

## Configure an existing merchant close

Add `bitwave` inside the chosen accounting workspace. Keep its actual original
outbox, proofs, terms and recovered-source settings. The following standalone
accounting configuration illustrates one customer organization and one existing
loaded table. Replace the example IDs and paths with the original host values.

```json
{
  "workspaces": {
    "books": {
      "label": "Merchant close",
      "directory": "./accounting-workspace",
      "outboxDir": "../merchant/outbox",
      "proofDir": "../merchant/proofs",
      "termsFile": "../merchant/accounting-terms.json",
      "bitwave": {
        "tokenEnv": "BITWAVE_ACCESS_TOKEN",
        "organizations": {
          "customer": {
            "orgId": "original-bitwave-organization-id",
            "label": "Customer accounting organization",
            "allowCreate": true,
            "dataSources": {
              "october-close": "original-loaded-table-id"
            }
          }
        },
        "pageSets": {
          "october-return": {
            "organization": "customer",
            "dataSource": "october-close",
            "files": [
              "./bitwave-pages/table-page-0001.json",
              "./bitwave-pages/table-page-0002.json"
            ]
          }
        }
      }
    }
  }
}
```

`organizations` maps readable aliases to exact native organization IDs. The host
may declare sixteen organizations, each with up to sixty-four existing table
aliases. Each native organization and table is declared once within its scope.
`allowCreate:true` lets the original native client create a loaded table for a
new plan in that organization. It also lets that plan operate its table retained
from the native create response. With `allowCreate:false`, select a declared
existing table. An organization may have no existing tables when it will create
new ones. Table names and stable request IDs come from the actual plan.

The optional `pageSets` map gives the original JSON response files in native page
order, with their customer and existing table aliases. It supports up to sixty-four
sets, each containing 1–500 distinct files totaling at most 64 MiB. Omit `pageSets`
when using native capture exclusively. Files are read from host configuration,
then retained by the original controller; file paths are absent from tool
arguments. A selected set must match the plan's native organization and binding.

Paths resolve relative to this input configuration file. The existing initializer
records their absolute host locations. For an existing merchant configuration,
place the object above under its existing `accounting` property and retain its
other source, fleet, receiving, publisher and support settings.

Use the existing accounting-only initializer when a seller is not needed:

```sh
starforge merchant-mcp init-accounting \
  --dir /absolute/new/merchant-operator \
  --accounting /absolute/private/accounting.json

starforge merchant-mcp serve \
  --config /absolute/new/merchant-operator/merchant-mcp.json
```

From a source checkout, the equivalent entry is
`node stellar-forge/mcp-merchant-operator/serve.mjs`. Its `init-accounting` and
`serve` arguments are identical. The ordinary HTTP listener uses the existing
`MCP_ACCESS_TOKEN` and remains on loopback.

For a subprocess client, generate its registration with the original command:

```sh
node stellar-forge/mcp-merchant-operator/client-config.mjs \
  --config /absolute/new/merchant-operator/merchant-mcp.json \
  --name starforge-books \
  --output /absolute/private/starforge-books-host.json
```

The registration launches the installed original `stdio.mjs` and preserves its
private child-process bearer. [The stdio guide](./STDIO.md) describes existing host
registration and shutdown. Supply the real Bitwave access token through the
process environment selected by `tokenEnv`; the default is
`BITWAVE_ACCESS_TOKEN`. The token value belongs in the existing host secret
configuration. The native client fixes its origin to `https://api4.bitwave.io`,
uses the original bearer transport and retains request bodies and selected
response metadata without recording the authorization header.

## Complete one close

### 1. Open the original saved accounting workspace

Call `merchant_accounting_sources`, then `merchant_accounting_open` with
`{"workspace":"books"}`. The original exclusive lease is shared with the browser:
close whichever interface currently owns the directory before opening the other.

Call `merchant_accounting_bitwave_status`. Its connection reports whether the
host token is configured. Use `view:"organizations"` to inspect the exact native
customer IDs, allowed creation setting and table aliases. `view:"plans"` pages
existing plans and their latest operation/capture/return; an optional
`organization` narrows the view. `view:"pageSets"` lists declared file inputs.
Status reads retained state and does not contact Bitwave.

Use the existing accounting tools to select or prepare an original handoff.
`merchant_accounting_status` with `view:"handoffs"` lists saved packet IDs.
`merchant_accounting_accountant` and `merchant_accounting_accountant_rows` show
the original source, amounts, labels and current returned bookkeeping. If a new
packet is required, use the original prepare/create tools and actual run or
period-close ID. Reusing the retained packet preserves its source and payment.

### 2. Freeze the actual rows and choose their destination

Call `merchant_accounting_bitwave_plan_create` with the workspace, current
accounting `revision`, `actor`, a fresh stable UUID `id`, organization alias,
original `handoffId`, a useful `name` and optional description/batch size.
`accountantRevisionId` selects an exact saved return; omission or `null` selects
the initial accountant packet. Use the current original returned ID when its
bookkeeping assignments should be the exported baseline.

The result retains the immutable plan, source hashes, native schema, string rows
and original request batches. Native row identity combines this plan's ID with
the original accountant row ID. All original protected fields remain exact;
the original return engine owns the editable accounting fields.

An adjusted handoff also freezes its source snapshot hash, exact refund and
cancellation amounts, refund status/count and native transfer/decision dates.
These appear in the same `schema` and row views as protected string columns.
A closed-period handoff keeps the original close's adjustment snapshot after
later refunds. Legacy plans retain their original column set. Select a native
table with the plan's complete schema; Bitwave requires a new data source when
the schema changes, and this workspace refuses a known retained table with
different columns. The existing [operator workflow](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/BITWAVE_WORKFLOW.md#carry-the-selected-adjustment-snapshot)
explains source selection and dates.

Inspect `merchant_accounting_bitwave_plan` and page `view:"schema"` or
`view:"batches"`; use `merchant_accounting_bitwave_rows` for the full source rows.
Default page size is 25, maximum 200. Follow `total`, `offset` and `limit` to
consume every row that matters to the operation.

For an existing table, call `merchant_accounting_bitwave_bind` with its declared
`dataSource` alias, current workspace revision, actor and a selection note.
For a new table, start the native `create` operation described below. A frozen
plan retains one native destination. Use a new plan when the intended table or
exported source version changes.

### 3. Deliver and capture through the original native client

Call `merchant_accounting_bitwave_operation_start` with `action:"create"` or
`action:"upload"`, its original `planId`, current accounting revision, actor and
a fresh stable operation UUID. Record that UUID before sending the call. The
result is an asynchronous original operation, not the completion of all batches.

Read `merchant_accounting_bitwave_operation` using `operationId`. The saved status
is `RUNNING`, `COMPLETE`, `PAUSED`, `UNCERTAIN` or `FAILED`. `view:"steps"` pages the
actual native request and response identities, including their exact original
file hashes. Refresh the revision from status or the operation before the next
revision-based command. The original controller serializes native work in each
organization and honors its recorded retry-after time.

After delivery, start `action:"capture"`. The original paginated request saves
every native response, original source comparison and capture ID. Read the
operation to obtain its `captureId`, complete/partial state, summary and
comparison integrity. `merchant_accounting_bitwave_rows` with that `captureId`
pages `MATCHED`, `CHANGED`, `MISSING`, `DUPLICATE` and `UNKNOWN` rows. Filter with
`status` or `search` when resolving a particular exception, and retain the full
count so the remaining rows stay visible.

Call `merchant_accounting_bitwave_operation_stop` with the actual operation ID
and actor to stop between native requests. Inspect its retained outcome. A
partial native capture can be continued by starting a new `capture` operation
with the prior `resumeCaptureId`. The original cursor and exact table binding
govern that continuation.

### 4. Resolve interrupted delivery from its native outcome

After an interrupted MCP reply, inspect the original operation ID. Repeating
the same start ID with the same request returns that original operation; it
does not dispatch another write. A different request under the same ID fails.

If table creation is uncertain, identify the table from its retained native
request/response and the native Bitwave data-source list. Add that exact table
to the host's declared aliases, restart the MCP host, reopen the same accounting
directory and select it with `merchant_accounting_bitwave_bind`. The original
controller prevents another create while that first outcome is unresolved.

For an uncertain row delivery, capture the table. Review the latest complete
native capture, correct any changed or duplicate protected source rows through
their original owning workflow, and start `action:"repair"` with its `captureId`
and `comparisonSha256` from `capture.integrity.sha256`. The original repair sends
only missing original rows. It requires a capture newer than the last write
attempt. An uploaded JSON file can support a returned-accounting review; native
missing-row repair uses an actual native capture.

To retain externally downloaded original response pages, inspect
`merchant_accounting_bitwave_input` with the page-set alias. Keep its
`inputSha256`, inspect the ordered file hashes, then call
`merchant_accounting_bitwave_import` with that digest, a stable capture UUID,
current revision, actor, plan and name. The host rereads the files and rejects a
changed input or different customer/table before the original import runs.

### 5. Review and save the accountant return

`merchant_accounting_bitwave_plan` returns `currentAccountantParentId`. Pass that
exact value, including `null` for the first return, to
`merchant_accounting_bitwave_return_preview`, together with plan/capture IDs,
actor and a return name. The original engine compares the frozen export, current
local bookkeeping and captured native rows.

The preview retains the current parent, proposed return UUID, creation time,
integrity SHA and original return summary. It reports source-issue and concurrent
edit-conflict counts. Page `view:"sourceIssues"`, `"editConflicts"`, `"results"`,
`"issues"`, `"assignments"` or `"missingRows"` to inspect the details. Repeat the
returned `id` and `createdAt` when paging the same proposed revision. A change to
the current accountant parent requires a fresh preview.

Concurrent local changes are retained when the remote value still equals the
exported baseline. A conflicting local and remote edit is displayed with its
three original values and omitted from this return. Missing or unsuitable source
rows retain their prior local assignments through the original accountant engine.
If `preview` is `null`, all candidate rows need source or edit correction; inspect
the issue/conflict pages and correct the original data before previewing again.

Save with `merchant_accounting_bitwave_return_apply`. Carry the preview's
`id`, `createdAt`, `expectedParentId`, actor and name unchanged; set
`previewSha256` to `preview.revision.integrity.sha256` and use the current workspace
revision. The controller records the exact return intent before calling the
original accountant save. Repeating that exact request recovers a lost response
or interrupted second journal entry, preserving one original accountant return.

The saved revision is immediately available through the ordinary accountant
tools and browser. Subsequent returns retain earlier source and bookkeeping
history. `view:"returns"` and `view:"returnIntents"` on the Bitwave plan show the
linked revisions and any save that needs the same stable request continued.

### 6. Deliver the original files and reopen the same work

Use `merchant_accounting_bitwave_plan` with `view:"files"` to find an exact
retained filename. `merchant_accounting_bitwave_file` returns base64 chunks for
that name, or use `file:"bitwave-handoff.tar"` for the complete current plan.
The archive includes original plan/source files, native requests and responses,
captures/comparisons, return intents and every accepted original accountant
return packet. Its file manifest carries the exact included byte hashes.

For an adjusted source, `adjustments.json`, `adjustments.csv` and
`adjustments.html` are retained plan files available through this same chunked
reader. The complete archive also carries these exact frozen companions inside
every saved accountant return. Their source hash stays bound to the selected
handoff, including when later merchant adjustments have been recorded.

The first read returns `readId`, `file.bytes`, `file.sha256`, `data` and
`nextOffset`. Decode `data` as base64. For each following chunk, keep the same
workspace, plan ID and requested filename, pass that `readId` and
`expectedSha256:file.sha256`, and use `offset:nextOffset`. Finish when
`nextOffset` is `null`; verify the concatenated size and SHA256. The shared
original reader loads the original artifact once and keeps one private immutable
snapshot through the read. A later saved capture cannot change the middle of
that transfer.

Use the existing `merchant_accounting_file_release` with workspace and read ID
to abandon an unfinished read. Up to four reads share the original 256 MB
snapshot allowance. Reads expire after two minutes of inactivity. A process
restart releases its temporary snapshots; original files remain retained. For
an unchanged file, reopen with the expected digest and next offset. If a complete
handoff has changed because new work was saved, fetch its current complete
artifact from offset zero. For larger aggregate histories, transfer the exact
individual retained files within the existing reader allowance.

Finally call `merchant_accounting_close`. It waits for admitted calls, releases
file snapshots, closes native Bitwave operations, drains original collection
work and releases the original workspace lease. The ordinary accounting browser
can then open the same directory and `/bitwave.html`. Close the browser before
reopening it through MCP. Retain the original workspace with the existing
merchant backup procedure; the portable Bitwave handoff carries this plan's
source and returns, while the complete accounting directory carries all periods,
collections, other plans and operational history.

## Source and operating limits

The same native engine uses string-valued schema columns, stable original row
IDs, batches of 1–250 rows, paginated captures and exact source comparisons.
It keeps native provider failures and interrupted writes in the original saved
operation. MCP supplies declared aliases and current revisions to that engine.
No token, host path, arbitrary URL or raw replacement ledger is accepted as a
tool argument.

The module is `bitwave.mjs`; its only integration hooks are the existing
accounting configuration, tool definitions and owned-session lifecycle. The
original request client, comparison logic, return arithmetic, file snapshot
reader and merchant transport remain their implementations. The complete native
consumer exercise and installed-source handover are linked from the original
merged delivery and operating thread.
