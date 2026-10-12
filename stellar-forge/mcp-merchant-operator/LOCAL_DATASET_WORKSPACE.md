# Local dataset customer workspace

Use this workspace to take an already reviewed local Frictionless dataset through
complete delivery, customer mapping and import, saved views and SQL, full reports,
and a portable customer handoff.

The browser and agent use one merchant host. The host owns the original
Frictionless publisher and scheduler and borrows their browser for this workflow.
The customer data stays in its original DuckDB workspace. An installed
`local-dataset-agent` entry makes this same workflow available from Applications
and the command line.

## Select the original workspaces

Use the existing merchant configuration and its original Frictionless
`publisherConnection`. Select a publisher alias whose configured kind is
`frictionless`. Its local descriptor, resource files, reviewed run and publisher
directory remain with that original publisher.

The customer selection needs three existing values:

| Value | Where it comes from |
| --- | --- |
| Customer alias | The original lowercase customer alias; letters, digits, underscores and hyphens |
| Database directory | The absolute directory of the original DuckDB workspace |
| Customer workspace ID | The original DuckDB workspace's saved 32-character hexadecimal ID |

Use a customer alias matching \`[a-z0-9][a-z0-9_-]{0,63}\`. The connection's optional\nworkspace \`label\` supplies a readable display name. Read the actual customer\nstatus to obtain the saved ID. Keep that ID when moving
a complete handoff to a new working directory. Each local delivery workspace
also has its own persisted UUID; the startup and operator display both identities.

Create a private UTF-8 connection file, for example
`local-dataset-workspaces.json`, with this shape. Replace the capitalized values
with the actual existing selection:

```json
{
  "schema": "stellar-forge.local-dataset-workspace-connection.v1",
  "workspaces": {
    "customer": {
      "publisher": "ORIGINAL_FRICTIONLESS_PUBLISHER_ALIAS",
      "customer": {
        "name": "customer",
        "database": "/absolute/original/customer-workspace",
        "workspaceId": "ORIGINAL_32_CHARACTER_HEXADECIMAL_ID"
      }
    }
  }
}
```

Add `localDatasetWorkspaceConnection` to the existing complete merchant
configuration, alongside its existing `publisherConnection`:

```json
{
  "publisherConnection": "./publishers.json",
  "localDatasetWorkspaceConnection": "./local-dataset-workspaces.json"
}
```

This is a property excerpt to apply to the existing merchant configuration. Keep
its other required settings and existing provider connections. Relative
connection paths are resolved from the merchant configuration directory.

The local dataset connection selects an existing reviewed publisher candidate.
It does not require a release-store declaration. The launcher binds the exact
merchant, publisher-connection and local-dataset-connection files, the publisher
directory and the customer directory/ID. Ordinary changes inside either working
directory do not change that configuration binding.

## Start from Applications

Use an installed runtime that includes the complete local dataset contribution.

1. Open **Applications** and choose **Local dataset customer workspace**.
2. Select the original merchant configuration and its local dataset workspace
   alias, such as `customer`.
3. Leave the browser and MCP ports at `0` to choose available local ports, or
   supply the exact local ports required by this host.
4. Set the MCP token in the existing host environment. The default environment
   name is `MCP_ACCESS_TOKEN`; a private environment JSON can supply its value
   through the normal Applications controls.
5. Review and start the saved application. Open its announced local browser.

Applications retains the original command and three configuration files. The
startup must match the selected configuration and identify the same local
delivery workspace, publisher instance and original customer workspace. Editing
a connection file requires reviewing the changed configuration before a new
launch.

The operator URL belongs to the original publisher browser. The MCP URL
belongs to its owning merchant host. Stopping the saved application closes that
host and its borrowed resources through the normal Applications lifecycle.

## Start from the installed command

Inspect the declarations without opening a publisher, scheduler or database:

```sh
stellar-forge local-dataset-agent inspect \
  --config /absolute/private/merchant-mcp.json \
  --workspace customer
```

The result contains the exact selected configuration and `bindingSha256`.
Keep the token value in the existing host environment, then start the workspace:

```sh
stellar-forge local-dataset-agent serve \
  --config /absolute/private/merchant-mcp.json \
  --workspace customer \
  --port 0 \
  --mcp-port 0 \
  --token-env MCP_ACCESS_TOKEN
```

An automated caller that already inspected the configuration can also supply
`--expected-binding-sha256` with that returned digest. A changed declaration is
reported before the original host is opened.

The ready line uses schema
`stellar-forge.local-dataset-agent-workspace-startup.v1` and status
`LOCAL_DATASET_AGENT_READY`. It contains the actual browser/MCP URLs and both
workspace identities. Use SIGINT or SIGTERM to close the one owning host.
Closing a borrowed browser through its original tool stops that listener while
the merchant owner remains responsible for the publisher and scheduler.

Source users can invoke the same entry directly:

```sh
node SOURCE/stellar-forge/mcp-merchant-operator/local-dataset-workspace-setup.mjs \
  serve --config /absolute/private/merchant-mcp.json --workspace customer
```

The public module exports `inspectLocalDatasetAgentBinding`,
`startLocalDatasetAgentWorkspace` and `main`.
`startLocalDatasetAgentWorkspace` returns the actual `startup`, `operator`,
`server`, browser `url` and asynchronous `close()`.

## Source and deliveries

The publisher remains the source-selection owner at the top of the browser.
Select the original reviewed publisher run, then use **Read selected publisher
run** in **Source and deliveries**.

Prepare the complete receiving scope from that retained run. Review the actual
dataset/query selection and every scope field before starting it. A delivery
retains that exact input and the original source identity; later publisher
selections do not replace the saved scope.

Continue the selected delivery through its original page operation. The
receiver retains every native SF100 page and cursor in order and checks the
accepted prefix when reopening. It appends native batches against that prefix,
then finalizes the complete delivery and its reports. **Open delivery** shows
the saved scope, current state and original operation.

Use the saved operation when a page transfer stops. Read its current status
first, then choose **Resume original request** if that original operation is
interrupted. Cancelling a running page operation preserves the existing
delivery and its accepted pages.

A browser reload, status refresh or opening a saved delivery reads retained
work. The next source transfer is an explicit action on the selected delivery.

## Map and import

Open **Map and import** after the complete source delivery is available.

1. Choose **Inspect complete source**. Read the native inspection and its
   complete row/type findings.
2. Review every column and the selected treatment of each source value. Keep
   identifiers, numeric precision, timestamps, NULLs and source quality meanings
   consistent with the actual input contract.
3. Choose **Save reviewed mapping**. The saved review is bound to that exact
   delivery and customer workspace.
4. Choose **Import exact saved review**. The original customer engine applies
   the retained mapping and creates its immutable edition.
5. Open the exact review or edition to inspect the native result.

A new source edition or mapping decision is reviewed explicitly. Keep the
original inspection, review and import result together so another operator can
see the complete inputs behind the customer edition.

**Open original customer** opens the existing DuckDB operator for the same
customer workspace. It uses the same native warehouse and saved history.

## Editions and views

**Editions and views** lists the original customer's immutable imported editions.
Open an edition to inspect its complete native metadata and source association.

A named view points to one exact edition. Read and bind its current saved
revision before choosing a replacement edition, then use **Save view selection**.
If another operator changes that view, read its current revision and decide
against the new state. The original editions remain available.

For a comparison, select the exact **Before** and **After** editions and supply
their real key columns. Read the returned comparison and its counts. Keep the
edition IDs and key selection with the resulting review; a current named view
may move independently later.

## Queries and reports

**Queries and reports** works with the original customer's read-only SQL and
saved recipes.

Open an existing recipe before editing it, or begin a new recipe draft. Save
the exact SQL and parameter text. The current native adapter keeps the original
parameter text so large numeric values are not silently changed by a browser
number conversion.

**Run preview** returns the selected preview size. The preview shows whether
more rows exist. Use **Export complete saved result** for the entire saved
query result, then read its complete export manifest under **Files and
receiving**.

Keep query and view revision selections explicit. A saved report belongs to its
actual original query request and resulting files. Opening a report does not
rerun the query. A later report uses its own deliberate request against the
selected current inputs.

## Files and receiving

This page lists completed original source, export and handoff records.

Use **Export exact edition source** to retain the original input behind a
selected customer edition. Use **Create complete warehouse handoff** to retain
the customer's complete warehouse through its original export engine.

Select the completed whole-warehouse handoff and any completed query exports
needed by the receiving operator, then choose **Create complete receiving
package**. The package contains the complete selected local source and SF100
delivery, the original warehouse handoff, the chosen full reports, and this
guide with its original receiving helper. All included members are declared
with their exact lengths and digests.

The package requires a full warehouse handoff when reopening a complete
customer workspace. A single edition/source export remains useful for source
review and has its own explicit kind.

Download the full package and retain its returned archive SHA-256 beside the
file. Read the original package/export record to recover the result of a
download or export whose response was lost.

## Portable receiving and customer reopening

Use the source-owned receiver from this same product edition. It is included
as `receiving/package.py` in the complete handoff and lives in source at:

`stellar/scf-starforge-20261009/sf30-seller-sdk/local-dataset-receiving/package.py`

Select the complete downloaded ZIP, its exact returned SHA-256, a new private
receiving directory and one request UUID. Keep the same UUID and unchanged
arguments when recovering this receiving operation.

```sh
python3 SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/local-dataset-receiving/package.py \
  receive \
  --archive /absolute/Local_Dataset_Receiving.zip \
  --sha256 ORIGINAL_COMPLETE_ZIP_SHA256 \
  --output /absolute/private/received-local-dataset \
  --request-id ORIGINAL_RECEIVING_REQUEST_UUID
```

The receiver validates the complete member inventory, each full member's
bytes/digest and the original package identity. It retains the immutable source,
SF100 delivery and full warehouse files under the selected receiving directory.
Read the complete receiving result. Its `warehouseDirectory` is the actual
directory of the received original customer warehouse.

Keep that received directory as the original handoff. Make a separate sparse
working copy for customer use. The following commands require GNU coreutils;
replace both paths with the exact receiving result and a new working path:

```sh
set -eu
LOCAL_DATASET_RECEIVED_WAREHOUSE=/absolute/path/from/warehouseDirectory
LOCAL_DATASET_WORKING=/absolute/private/customer-working
test ! -e "$LOCAL_DATASET_WORKING"
cp --sparse=always -a -- "$LOCAL_DATASET_RECEIVED_WAREHOUSE" "$LOCAL_DATASET_WORKING"
python3 -m stellar_forge_buyer.duckdb_cli --workspace "$LOCAL_DATASET_WORKING" status
python3 -m stellar_forge_buyer.duckdb_cli --workspace "$LOCAL_DATASET_WORKING" serve
```

Use the existing Python environment that contains the original
`stellar_forge_buyer` customer runtime and DuckDB dependency. Read the announced
local customer URL from `serve`.

Check the saved customer workspace ID against the complete receiving result.
Open the original imported edition, saved mapping/review, named views, query
recipes and completed reports. Read the complete query export files when
comparing results; a browser preview can intentionally contain fewer rows.
Close the working customer, reopen it from the same working directory and
confirm that the selected saved work remains available.

The warehouse's saved history and identity are preserved. A local working path
can change when moving a handoff to another host. Old native paths inside source
records remain part of that original record.

### Reopen the original Frictionless source

The same package retains the original source archive at
`operator/Frictionless-Source.tgz`. Read that member's declared SHA-256 from the
complete receiving manifest and choose a new source directory:

```sh
stellar-forge frictionless source-receive \
  --archive /absolute/private/received-local-dataset/operator/Frictionless-Source.tgz \
  --sha256 ORIGINAL_DECLARED_FRICTIONLESS_ARCHIVE_SHA256 \
  --output /absolute/private/reopened-frictionless-source
```

The original source CLI is
`stellar/scf-starforge-20261009/sf30-seller-sdk/frictionless/cli.mjs`.
Read the returned source result and use its actual descriptor/resource paths
when preparing a following source operation.

Reopening the complete source or warehouse preserves the delivered original.
Choose a following operation explicitly when you need a new delivery, mapping,
customer edition or report.

## Agent use and ownership

The maintained catalog exposes this workflow under
`merchant_local_dataset_`. Use the host's normal tool discovery for the
complete operation schemas.

The two launch calls are:

```js
const opened = await operator.call('merchant_local_dataset_open', {
  workspace: 'customer',
});
const browser = await operator.call('merchant_local_dataset_browser', {
  workspace: 'customer', workspaceId: opened.workspaceId, action: 'open', port: 0,
});
```

The browser return is direct: `url`, `workspace`, `instanceId`,
`publisherInstanceId`, `workspaceId`, `publisher`, `customer` and
`directory`. Its outer `workspaceId` identifies the local delivery workspace;
`customer.workspaceId` is the original customer's distinct 32-character ID.
Keep these values from the actual opened operation.

The installed launcher obtains both calls from one `startMerchantMcp` owner.
An embedding application should close the returned launcher handle when done;
the normal host closes its resources. A direct consumer of the catalog must use
the original close operation with its workspace alias, delivery workspace ID,\ninstance ID and publisher-instance ID.

The native package API is:

```js
await receiveLocalDatasetPackage({
  archive: '/absolute/Local_Dataset_Receiving.zip',
  sha256: originalArchiveSha256,
  directory: '/absolute/private/received-local-dataset',
  requestId: originalReceivingRequestId,
  environment: originalEnvironment,
});
```

Keep the original request ID and exact input across continuation. The same
native package receiver supplies the complete result used by the command-line
procedure above.

## Continue interrupted work

The operator's **Saved actions and recovery** section retains each action's
exact input before dispatch. It can reopen the original saved request after a
browser interruption.

| Situation | Continue the existing work |
| --- | --- |
| A page transfer is running | Read its original status and follow that operation |
| A page transfer is interrupted | Resume the same retained request and accepted page chain |
| A completed response was lost | Read and open the saved result by its original request ID |
| A request is absent from the native journal | Use the explicit unchanged-input retry after reading that original ID |
| A mapping or view changed in another window | Read the current revision and review the intended choices |
| A customer export is interrupted | Read its original customer request and resume that request |
| Browser request storage is unavailable | Restore that storage before sending another action |
| Merchant connection files changed | Inspect and review the new declarations before launching |
| The host stopped | Reopen the same saved directories, then recover the original operation |

Keep receiving inputs and completed exports until their actual customer
handoff has been read. The complete original workspace backup remains the
recovery copy for the operator's mutable working directory.

## Installed source integration

The source-owned local dataset contribution registers `local-dataset-agent`
and the provider
`distribution/runtime-workspace/providers/local-dataset-workspace.mjs`.

The Applications leaf uses the maintained preparation and stdout-observation
mechanics. Its resource family remains `merchant-mcp`, keyed to the selected
merchant configuration. It retains the original immutable configuration files,
and records the ready line's actual publisher/delivery/customer identities.
The native publisher and customer engines continue to own their own working
directories and operation journals.

The complete receiving package includes this guide as
`receiving/LOCAL_DATASET_WORKSPACE.md`. Use the source and native receiving
result belonging to the same delivered product edition.
