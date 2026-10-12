# Sheet Best merchant source workspace

This workspace turns an existing complete Sheet Best records response into a reviewed public dataset source. The browser, command line, Applications and merchant MCP all open the same private source database. The existing Sheet Best publisher owns extraction, candidate review, dataset editions, schedules and buyer handoffs. The existing SF82 dataset release store owns merchant deployment, start, stop, restart, rollback and customer receiving.

A saved source version records the exact original capture, the explicit public field projection and the extraction ordering. Selecting a different version updates the managed source declaration for a future publisher plan. Existing publisher plans and published editions keep their own retained source.

## Requirements and installation

Use Node 24 with its original SQLite module on a POSIX host with the standard system flock command. The original source workspace and publisher use a kernel-held workspace lease. No Google account, Google OAuth adapter, spreadsheet write permission or database server is required. A live Sheet Best read uses its existing read connection and optional API key.

The source-owned distribution contribution is distribution/contributions/sheetbest-authoring.json. It registers:

| Surface | Entry |
| --- | --- |
| Installed command | sheetbest-workspace |
| Applications choice | sheetbest-authoring |
| MCP provider | sheetbest-workspaces |
| Merchant configuration field | sheetbestWorkspaceConnection |
| Source model export | ./seller/sheetbest/workspace |
| Other exports | ./seller/sheetbest/workspace/server, /launch, /packet, /deployment, /mcp |

Use a maintained merchant distribution that includes this contribution. Its existing runtime installer supplies the selected native/MCP features and source manifest; this component adds no new npm dependency or hosted Actions workflow. Applications uses the original installed runtime and checks the selected source files, immutable settings, database inode and connection-file hash before accepting the actual startup line.

From a checked-out or installed source tree:

~~~sh
SHEETBEST_SOURCE=/absolute/source/stellar/scf-starforge-20261009/sf30-seller-sdk/sheetbest
SHEETBEST_WORK=/absolute/private/sheetbest-catalog
node "$SHEETBEST_SOURCE/workspace/cli.mjs" init --directory "$SHEETBEST_WORK"
node "$SHEETBEST_SOURCE/workspace/cli.mjs" serve --directory "$SHEETBEST_WORK" --port 8471
~~~

Open the complete private URL printed by serve. Port 0 selects a free loopback port. The token remains in the URL fragment and current browser session; API requests require the same token, exact local Host and local Origin. Close the original process with SIGINT/SIGTERM. Closing waits for the source operation, borrowed publisher/scheduler, file reads and owned deployment service before releasing the workspace.

Workspace directories are mode 0700 and private files are mode 0600. Reopen the same directory with status or serve. Do not create a second publisher, move individual files, rewrite retained source hashes or use two independent services against the same database.

## Reuse an existing source and completed publication

This is the preferred entry when a frozen source already exists. Source import calls the original declaration reader and original capture reader. It verifies the complete response and manifest without making a provider request.

~~~sh
node "$SHEETBEST_SOURCE/workspace/cli.mjs" import-source \
  --directory "$SHEETBEST_WORK" \
  --source /absolute/private/original/source.json \
  --orders /absolute/private/original-query-orders.json \
  --title "Existing reviewed merchant source" \
  --expected-revision 0 \
  --request 11111111-1111-4111-8111-111111111111
~~~

The UUID above is an example. Use a fresh UUID for a new intentional action and retain it for recovery. The orders file maps each query to the exact original extraction order:

~~~json
{
  "catalog": [
    {"column": "record_id", "direction": "asc"}
  ]
}
~~~

Use the actual query and public column names from the original plan. Importing a source without --orders proposes ascending order on its first declared column and explicitly records PROPOSED_FIRST_COLUMN_ASCENDING in the packet origin. That proposal does not claim to reproduce a prior publication. Review or replace it before saving a source version.

When two original publisher plans use different orderings, preserve both original plan identities and receipts. Retain the first ordering in one source version and the second ordering in another. The version comparison shows order changes independently of capture and column changes. No old publisher plan or dataset edition is rewritten.

The completed internal Sheet Best pilot used one retained 516-record response and four public text fields. Its private capture and original native receipt remain outside this public repository. This workspace is designed to import that source and preserve its existing field choices; it does not infer those choices from raw personal fields or replace its existing customer/contact record.

## Read a host-declared connection

A host can supply a private connection file. This is an example shape, not an existing account or credential:

~~~json
{
  "catalog": {
    "label": "Example Sheet Best connection",
    "connectionId": "22222222-2222-4222-8222-222222222222",
    "tab": null,
    "valueMode": "strings",
    "apiKeyEnv": "SHEETBEST_API_KEY",
    "maxResponseBytes": 67108864,
    "timeoutMs": 30000
  }
}
~~~

Replace the connection ID privately. Set the existing key through the host's environment or service credential configuration; do not put its value in JSON, source, chat, browser storage or a source packet. Omit apiKeyEnv for an intentionally public read connection. The host file selects the connection ID, tab, strings/raw mode and limits. Browser and MCP select only the declared alias.

~~~sh
node "$SHEETBEST_SOURCE/workspace/cli.mjs" serve \
  --directory "$SHEETBEST_WORK" \
  --connections /absolute/private/sheetbest-connections.json \
  --port 8471
~~~

In Capture source, select the connection, name the observation and choose Read complete records. This invokes the existing fetchSheetBestRecords once with _format=records and the selected value mode. Redirects are refused by the original reader. A response must be a complete JSON records array within the declared byte limit. Newly read data starts with no public fields selected.

The full raw response and its original response receipt are saved before capture adoption. If the process ends after saving the response body but before its receipt, recovery reports SHEETBEST_READ_RECEIPT_NOT_RETAINED and preserves those bytes. The operator can acknowledge that recorded failure and intentionally make a new observation. Recovery does not silently repeat a GET whose outcome is unknown.

The command-line equivalent is:

~~~sh
node "$SHEETBEST_SOURCE/workspace/cli.mjs" capture \
  --directory "$SHEETBEST_WORK" \
  --connections /absolute/private/sheetbest-connections.json \
  --connection catalog --title "Current catalog observation" \
  --expected-revision 0 --request 33333333-3333-4333-8333-333333333333
~~~

A single complete response is the source observation. Provider headers, record count, response bytes, received timestamp and binding are retained as observed. The adapter does not assert an unobserved transaction boundary or infer data from separate requests.

## Select public fields and review all rows

Open a retained observation in Review columns. The field browser shows the exact original source key, observed scalar/null/missing counts and up to five samples. Search and field pagination preserve selections across pages. No field is selected automatically after a fresh read. An imported frozen source keeps its explicit previous projection.

For each query, choose:

1. Which source fields may be published.
2. A unique public alias beginning with a letter.
3. The original supported scalar type: string, integer, number or boolean.
4. Whether an explicit null is allowed.
5. Whether an empty string remains empty or explicitly becomes null.
6. A nonempty ordered list of published column aliases and asc/desc directions.

Strings mode preserves source strings unless an explicit original canonical numeric or boolean conversion is selected. Raw mode requires compatible original scalar values. Large identifiers should remain strings when numeric conversion would lose precision. A missing source key fails even when the column allows null. Null and empty string remain separate decisions; the original extractor rejects configurations its CSV representation cannot preserve.

The workspace supports up to 32 queries and 64 selected columns per query. Each query may select a different public subset. The complete raw response remains private and unchanged.

Save draft uses the editor's original draft revision. Refresh workspace does not silently advance a dirty editor's revision. Reload saved draft deliberately replaces that editor with the current saved draft. A conflicting save returns the original revision conflict rather than overwriting another window.

Validate every row calls the original openSheetBestSourceFile/exportDataset for every configured query and saved order. It checks all rows, field presence, types, null policy and original size limits. The browser displays at most 25 result rows per query; the receipt records all-row validation and the exact draft/capture/source identities.

Enter the reviewer and change note, then Freeze and select source version. Version creation requires the exact saved preview, draft revision and current selected version. A preview from an earlier edit cannot authorize a later projection.

The complete draft JSON is portable between CLI and API:

~~~json
{
  "captureId": "44444444-4444-4444-8444-444444444444",
  "title": "Reviewed public catalog",
  "queries": {
    "catalog": {
      "columns": {
        "record_id": {"source": "ID", "type": "string", "nullable": false, "empty": "preserve"},
        "description": {"source": "Description", "type": "string", "nullable": true, "empty": "null"}
      }
    }
  },
  "orders": {
    "catalog": [{"column": "record_id", "direction": "asc"}]
  }
}
~~~

These field names and UUIDs are examples. Select actual keys and scalar semantics from the retained observation.

## Publish through the original engine

Open original publisher starts the existing Sheet Best publisher over this workspace's selected managed source and original publisher directory. It also exposes the original publisher browser. Source and agent operations borrow that same publisher and scheduler.

In Publish & operate, enter a saved query name and prepare the original publisher plan input. The input includes the saved source SHA256, chosen columns and exact extraction order. Review its dataset/filter/range/sort/limit settings before saving it through the publisher. The original publisher captures a private copy of the complete source and validates its selected dataset.

For a host integration, use the same model and original savePlan call:

~~~js
const input = await workspace.publisherPlan({ versionId: selectedVersion, query: 'catalog' });
await workspace.openPublisher({
  expectedSelectedVersion: selectedVersion,
  requestId: crypto.randomUUID(),
});
const savedPlan = await workspace.withOpenPublisher(({ publisher }) => publisher.savePlan(input.plan));
~~~

Then use the original publisher's extraction, candidate review and publish workflow. The authoring model does not implement a second extractor, dataset writer, schedule or buyer store. Existing candidate digests, review IDs, expected target revisions and buyer handoffs remain authoritative.

The CLI can print the same complete plan input:

~~~sh
node "$SHEETBEST_SOURCE/workspace/cli.mjs" publisher-plan \
  --directory "$SHEETBEST_WORK" --version 1 --query catalog
node "$SHEETBEST_SOURCE/workspace/cli.mjs" publisher \
  --directory "$SHEETBEST_WORK" --version 1
~~~

A completed PUBLISHER request receipt may contain the URL of a service that has since closed. Status reports current ownership. Replaying that receipt does not start a new service. An intentional reopen uses a new request UUID against the current selected version.

## Deploy, operate and receive the same merchant

Refresh original publications in the workspace. Select an original published extraction and the source version that actually produced it. The model verifies source SHA256, capture manifest SHA256 and the saved extraction order against the original plan. Copy the actual original merchant origin, fixed path and payment terms into the review form.

Review creates a read-only package review. Prepare binds its exact review hash and retains five files:

| File | Original purpose |
| --- | --- |
| dataset.csv | Exact reviewed candidate data |
| dataset.json | Original typed dataset description |
| seller.json | Original public seller route and payment terms |
| source.json | Original source-plan, candidate, publication and configuration identities |
| binding.json | Original existing dataset directory, contract and baseline snapshot |

The package builder uses the existing prepareDatasetRelease validator and retained version store. It checks complete CSV/configuration hashes while copying and publishes only complete files. The package does not copy an API key or raw unselected source fields.

Stage assigns an original release ID and reviewed runtime configuration. Open original release controls exposes SF82's existing comparison, activation, Run, Stop, Restart, rollback and customer receiving. The model retains the original generation, digest and exact owned instance requirements. An uncertain command response is recovered by inspecting original state; it does not repeat a command or infer that an unobserved transition happened.

Deployment packages and the original source model remain separate from private portable source packets. Customer receiving uses the original release/customer contract, generated client and published dataset. A complete raw source packet is an operator artifact.

The CLI has deployment-status, deployment-review, deployment-prepare, deployment-stage, deployment-package, deployment-console, deployment-compare and deployment-file. Supply each write's complete JSON input through --input and retain its --request UUID. Interactive run/stop/restart/rollback remain in the original release console, or the same model/MCP methods with exact current guards.

## Private packet export, import and reopen

A private source packet contains every original source record, including columns excluded from the public projection. It also includes the exact original capture manifest, selected query projection, extraction orders and source/version provenance. It strips connection credentials by requiring capture-backed source configuration. Give it only to the intended operator of the source workspace.

~~~sh
node "$SHEETBEST_SOURCE/workspace/cli.mjs" export \
  --directory "$SHEETBEST_WORK" --version 1 --out /absolute/private/source-v1.json
node "$SHEETBEST_SOURCE/workspace/cli.mjs" init --directory /absolute/private/receiving-workspace
node "$SHEETBEST_SOURCE/workspace/cli.mjs" import \
  --directory /absolute/private/receiving-workspace \
  --packet /absolute/private/source-v1.json --title "Received source" \
  --expected-revision 0 --request 55555555-5555-4555-8555-555555555555
~~~

Import checks the exact base64 member sizes and hashes, source binding, original manifest and every record through the original capture reader. It rewrites only the new workspace's local source reference, never the original producer's source or dataset history. An observation can be retained even when the draft revision changed; its receipt reports draftSaved:false and the operator may explicitly load it later.

Use export-capture for the complete observation before saving a source version. An unprojected new capture packet remains unprojected on import. Use packet --source ORIGINAL_FROZEN_SOURCE --out NEW_PACKET to create a portable packet directly from an existing declaration; its default first-column order is explicitly a proposal.

## Managed Applications

Initialize the source workspace first. In the maintained Applications browser, select Sheet Best source authoring, review the private workspace path and optional connection file, save, Start and Open. The original launcher verifies the existing settings/database identity, exact executed source and connection-file hash. The startup result must match the same source and workspace.

Stop drains the original workspace and services. Reopen uses a deliberate new reviewed start while retaining the same database, captures, selected source, drafts and publisher history. Do not start Applications while a separate CLI or MCP process owns the source lease. The existing owner must close first.

## Merchant MCP and host custody

Add the following field to an existing reviewed merchant configuration:

~~~json
{"sheetbestWorkspaceConnection": "/absolute/private/sheetbest-workspaces.json"}
~~~

The referenced host file has this shape:

~~~json
{
  "schema": "stellar-forge.sheetbest-authoring-connection.v1",
  "workspaces": {
    "catalog": {
      "label": "Sheet Best catalog",
      "directory": "/absolute/private/sheetbest-catalog",
      "connections": "/absolute/private/sheetbest-connections.json",
      "inputs": {
        "existing": {
          "kind": "source",
          "file": "/absolute/private/original/source.json",
          "label": "Existing frozen source",
          "orders": {"catalog": [{"column": "record_id", "direction": "asc"}]}
        },
        "received": {
          "kind": "packet",
          "file": "/absolute/private/received-source.json",
          "label": "Received private source"
        }
      }
    }
  }
}
~~~

Connections and inputs are optional. Seller and resource may be declared together when the original publisher buyer handoff is configured. Host paths and environment-key references are not accepted as tool-selected inputs. Each configured alias binds one existing canonical private database identity.

The source-owned provider registers with the existing merchant provider loader. It depends on the original publishers provider and borrows its retained candidate, review, schedule, recovery and buyer APIs.

| Operator intent | MCP tools |
| --- | --- |
| Open and inspect | merchant_sheetbest_workspaces, _open, _status, _inputs |
| Retain source | _import, _import_packet, _capture, _capture_attempt, _columns |
| Review source | _draft_save, _preview, _version_save, _version, _compare, _select |
| Use the original publisher | _plan_input, _publisher_open, original _publisher_* tools, _publisher_close |
| Operate original SF82 | _deployment_status, _deployment_review, _deployment_prepare, _deployment_stage, _deployment_compare, _deployment_command, _deployment_console_open/_close |
| Receive retained bytes | _packet_read, _capture_read, _deployment_file_read and corresponding release tools |
| Reconcile and close | _operation, _resume, _close |

All abbreviated entries in the table use the merchant_sheetbest prefix. Source import binds the expected hash of the same declaration the original packet builder interprets. Retained packet reads bind the original version/capture, full packet SHA256, offset and read ID. After expiration or process restart, omit the old read ID and resume the same version/hash/offset. Later chunks use the new read ID.

Close requires the exact current owned instance ID. It closes HTTP admission, waits for in-flight source and borrowed publisher calls, drains retained file reads and closes the original model. A different process's publisher or source service is not adopted by listener address.

## Recovery and operational limits

Every mutation has a stable request UUID and a durable original input/receipt. The browser retains its recovery marker until both the original receipt and current-state refresh succeed. A lost HTTP reply therefore cannot silently become a second action. For a large imported packet, browser storage retains only its filename/byte count/hash and small request metadata; reselect the same original file when needed.

Read operation --request UUID first. If the original receipt is interrupted, resume --request UUID uses its retained input. Provider reads never automatically repeat. A known pre-dispatch validation rejection may be corrected with a new request; an unknown response stays attached to the original request until reconciled.

Saved draft CAS, selected-version CAS, original publisher target revision, and SF82 generation/digest/instance checks are independent. Refresh the appropriate original state when a specific conflict occurs. Do not replace these guards with a new source directory or request ID merely because another window changed state.

Source response limit is 64 MiB; private packet transport limit is 129 MiB. Preview uses the original one-million-row, row-byte, total-byte and timeout checks. The source adapter remains read-only and does not batch writes back to Sheet Best.

### Validation status for this implementation

The complete authored JavaScript modules have passed Node syntax checks. The original Sheet Best provider/publisher consumer already retained the real 516-record capture and completed its two editions and buyer configuration. The new authoring and managed interfaces are being reviewed against those exact original APIs. This guide does not claim a completed new browser/Applications/native receiving run before its actual result is retained.
