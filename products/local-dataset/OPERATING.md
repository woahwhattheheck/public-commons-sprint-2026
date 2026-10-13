# Local dataset customer workspace

Use one installed product to receive a reviewed local data package, import complete
customer editions into DuckDB, work with saved views and SQL, and deliver an
independently reopenable customer package.

The original Frictionless publisher owns source capture, field review, extraction
and publication. Its browser gains the complete customer workflow. The existing
Python DuckDB service owns the customer's database and report history. The
merchant host connects those original owners and provides the same operations to
the browser and agent client.

## What the operator can finish

| Workspace screen | Complete result |
| --- | --- |
| Source and deliveries | A reviewed original publisher run, exact query scope, every native page and a finalized retained delivery |
| Map and import | A complete field mapping, original import review and immutable customer edition |
| Editions and views | Saved edition identities, explicit view revisions and keyed comparisons |
| Queries and reports | Original saved SQL and parameter text, previews and complete Parquet/CSV results |
| Files and receiving | Original source, full warehouse handoff, selected reports and one portable receiving package |

The source handles CSV, TSV, JSON and Parquet Frictionless resources. Parquet
uses the original Wherobots output decoder included beside the publisher.
Its Arrow dependency is selected explicitly in the Python environment.

## Build and install this product

Use Linux, Node.js 22.16 or later, Python 3.11 or later, Git, npm and util-linux
`flock`. Operating directories must support file locks, atomic publication and
fsync. Keep customer data and private configuration outside the source checkout.

From a checkout of this repository, build the committed product selection:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo . --ref HEAD --selection local-dataset \
  --out /absolute/private/packages/local-dataset
~~~

Keep the returned original archive, SHA-256 and manifest together. The builder
records the resolved Git commit and packages the selected registrations,
complete source dependencies, browser assets, Python customer, Parquet decoder
and this guide. Its existing interrupted-build recovery uses that same source
selection and output directory.

Install the source package into a new application directory:

~~~sh
npm install --ignore-scripts --offline --omit=optional /absolute/path/to/package.tgz
npx --no-install starforge doctor
~~~

The installed command is `starforge`. Before installation, use the original
source dispatcher in its place:

~~~sh
node stellar/scf-starforge-20261009/distribution/cli.mjs
~~~

Prepare the declared merchant/MCP dependencies through the existing installer.
Replace the archive and hash with the actual builder result:

~~~sh
starforge runtime-install prepare \
  --dir /absolute/private/runtimes/local-dataset \
  --archive /absolute/path/to/package.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

starforge runtime-install install \
  --dir /absolute/private/runtimes/local-dataset

starforge runtime-install run \
  --dir /absolute/private/runtimes/local-dataset -- source
~~~

The installer retains the selected archive, exact dependencies, original
operation and recovery state. Use the
[original runtime installation guide](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md)
when transferring dependencies or continuing an interrupted installation.

### Open Applications and install the Python customer

Create a new runtime workspace, or use an existing one:

~~~sh
starforge runtime-workspace init \
  --workspace /absolute/private/runtime-workspace

starforge runtime-workspace attach \
  --workspace /absolute/private/runtime-workspace \
  --runtime /absolute/private/runtimes/local-dataset \
  --label 'Local dataset customer'

starforge runtime-workspace serve \
  --workspace /absolute/private/runtime-workspace --port 0
~~~

Open the local URL returned by the server. Select the attached runtime and
**Python & workbooks**, review the installed Python interpreter, select the
**duckdb** extra, then resolve the exact wheels, install offline and select that
environment. This source declares `duckdb==1.5.6`.

In **Applications**, create **DuckDB dataset workspace** with that selected
Python environment and a private customer directory. Start it and retain its
actual customer workspace ID. The service writes its current
`duckdb-launch.json` inside the customer directory; `workspace_id` is the
saved 32-character hexadecimal identity used by the connection below.

A source installation can run the same original customer directly:

~~~sh
umask 077
python3 -m venv /absolute/private/duckdb-venv
/absolute/private/duckdb-venv/bin/python -m pip install \
  "/absolute/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python[duckdb]"

/absolute/private/duckdb-venv/bin/python -m stellar_forge_buyer.duckdb_cli \
  --workspace /absolute/private/customer-warehouse serve --open
~~~

Keep the original customer service running while using the combined merchant
workspace. It retains its own database, request history and listener. The
[DuckDB customer guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/DUCKDB.md)
and [Python runtime guide](../../stellar/scf-starforge-20261009/distribution/python-runtime/WORKSPACE.md)
cover both installation routes and original customer recovery.

For Parquet source packages, select an existing trusted interpreter containing
the original decoder's `pyarrow==26.0.0` dependency through
`SF_FRICTIONLESS_PYTHON`. Keep the included Wherobots
[source requirements](../../stellar/scf-starforge-20261009/sf30-seller-sdk/wherobots/source/requirements.txt)
with the installation. The local Parquet reader uses PyArrow; Wherobots remote
SDK, account and job operations are separate parts of that component's declared
environment. CSV, TSV and JSON source capture uses Python's standard library.

## Capture and review the original source

If an original Frictionless publisher is already prepared, keep that workspace
and continue from its current saved run. For a new source, choose its actual
descriptor and capture all required resources and source references:

~~~sh
starforge frictionless capture \
  --descriptor /absolute/original/datapackage.json \
  --output /absolute/private/source-capture

starforge frictionless inspect-capture \
  --capture /absolute/private/source-capture/capture.json

starforge frictionless suggest-source \
  --capture /absolute/private/source-capture/capture.json \
  --output /absolute/private/reviewed-source.json
~~~

Review every selected field, source name, logical type, original quality and
missing markers, timestamp meaning, units and source rights. Preserve exact
text for identifiers, large integers and decimals when the native dataset
number representation cannot retain the original value. Apply a documented
schema or dialect correction only against the retained original references.

The [complete Frictionless guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/frictionless/README.md)
defines the source configuration, supported types and constraints, schema
reviews, Parquet representations, publication and independent source receiving.

After editing the reviewed source, create and inspect the publication plan:

~~~sh
starforge frictionless review-source \
  --source /absolute/private/reviewed-source.json

starforge frictionless plan \
  --source /absolute/private/reviewed-source.json \
  --query ORIGINAL_QUERY_NAME \
  --out /absolute/private/reviewed-plan.json
~~~

Review the plan's complete fields, filters, order, null handling and extraction
limits against the required source. An extraction must include the complete
selected resource. Create the original publisher and save that reviewed plan:

~~~sh
starforge frictionless init \
  --workspace /absolute/private/source-publisher \
  --source /absolute/private/reviewed-source.json \
  --state /absolute/private/source-dataset

starforge frictionless save \
  --workspace /absolute/private/source-publisher \
  --input /absolute/private/reviewed-plan.json

starforge frictionless extract \
  --workspace /absolute/private/source-publisher --plan RETURNED_PLAN_NUMBER

starforge frictionless inspect \
  --workspace /absolute/private/source-publisher \
  --run ORIGINAL_RUN_UUID --query 'limit=20'

starforge frictionless review \
  --workspace /absolute/private/source-publisher \
  --run ORIGINAL_RUN_UUID --reviewer 'Customer data operator' \
  --note 'Reviewed the complete source, field meanings and selected candidate.' \
  --initialize
~~~

Use `--initialize` for a new dataset target. An existing target uses the
current snapshot and revision through the original review contract. Retain the
returned run, review ID and candidate digest. Local customer receiving uses
that reviewed candidate; a paid merchant release follows the original source
guide when that is part of the agreed customer work.

Close a separately opened publisher browser before the combined merchant
opens the same publisher. The original publisher keeps one writer owner.

## Bind the publisher and customer to one merchant

Create a private `publishers.json` containing the actual existing publisher.
The alias and directory below are a complete configuration example:

~~~json
{
  "schema": "stellar-forge.merchant-publisher-connection.v1",
  "workspaces": {
    "source": {
      "label": "Reviewed local source",
      "kind": "frictionless",
      "directory": "/absolute/private/source-publisher"
    }
  }
}
~~~

For a new merchant host, use the maintained initializer:

~~~sh
starforge merchant-mcp init-publishers \
  --dir /absolute/private/local-data-merchant \
  --connection /absolute/private/publishers.json \
  --name 'Local dataset customer'
~~~

It creates the original merchant configuration, release store and export
directory. When attaching an existing merchant, retain its configuration and
stores instead of initializing another host.

Create a private `local-dataset-workspaces.json` with the actual customer
identity from the running original service:

~~~json
{
  "schema": "stellar-forge.local-dataset-workspace-connection.v1",
  "workspaces": {
    "customer": {
      "label": "Customer dataset operations",
      "publisher": "source",
      "customer": {
        "name": "customer",
        "database": "/absolute/private/customer-warehouse",
        "workspaceId": "ORIGINAL_32_CHARACTER_HEXADECIMAL_ID"
      }
    }
  }
}
~~~

Add this property to the complete existing `merchant-mcp.json`:

~~~json
{
  "localDatasetWorkspaceConnection": "/absolute/private/local-dataset-workspaces.json"
}
~~~

Keep the merchant's other required properties and existing provider connections.
Use owner-only regular configuration files and private canonical directories.
Each local workspace borrows one declared original Frictionless publisher.
Keep its directory separate from the customer's warehouse.

## Open the combined workspace

In **Applications**, choose **Local dataset customer workspace**, select the
merchant configuration and alias `customer`, and review the saved inputs.
The default MCP token environment name is `MCP_ACCESS_TOKEN`; supply its value
through the host's existing private environment controls. Start the application
and open the returned local browser.

The same installed command can inspect the configuration and start that owner:

~~~sh
starforge local-dataset-agent inspect \
  --config /absolute/private/local-data-merchant/merchant-mcp.json \
  --workspace customer

starforge local-dataset-agent serve \
  --config /absolute/private/local-data-merchant/merchant-mcp.json \
  --workspace customer --port 0 --mcp-port 0 --token-env MCP_ACCESS_TOKEN
~~~

The ready line reports `LOCAL_DATASET_AGENT_READY` and the actual browser/MCP
URLs. Its local delivery workspace UUID and the customer's 32-hex ID are
different identities. Preserve each in its proper field.

Use the full [operator and receiving guide](../../stellar-forge/mcp-merchant-operator/LOCAL_DATASET_WORKSPACE.md)
for every screen and action. Select the original reviewed publisher run,
prepare the complete local receiving scope and continue all native pages.
Then inspect the entire source, review every field mapping, and import the
exact saved review into the original customer.

Saved views and queries require their actual current revisions. The service
returns literal `parameters_text` with each saved recipe so browser reopening
keeps large integer parameters exact. For precision-sensitive decimal
parameters, use a quoted string and explicit SQL cast such as
`CAST(? AS DECIMAL(18,6))` with `["123456789.123456"]`.

A preview displays the selected sample. **Export complete saved result** writes
the entire saved query result; a `LIMIT` in the SQL itself remains part of
that result. Keep source meanings and the original saved query alongside
every customer report.

### Agent and command-line operation

The merchant catalog exposes all `merchant_local_dataset_*` operations. The
installed client uses that same host and workspace:

~~~sh
starforge local-dataset status \
  --url ORIGINAL_MCP_URL --workspace customer --token-env MCP_ACCESS_TOKEN

starforge local-dataset request \
  --url ORIGINAL_MCP_URL --workspace customer \
  --workspace-id ORIGINAL_LOCAL_DELIVERY_WORKSPACE_UUID \
  --request-id ORIGINAL_REQUEST_UUID --token-env MCP_ACCESS_TOKEN
~~~

Read the original request after an interrupted response. Use `--resume` only
to continue that saved request with its unchanged input. The client supports
original preparation, delivery, customer reads/writes, package creation and
full downloads; `starforge local-dataset --help` lists the exact commands.

## Deliver the whole customer workspace

Complete the selected query exports first. Create the original whole-warehouse
handoff, then select that handoff and the desired complete reports under
**Files and receiving**. Create and download the complete receiving package.

That package contains the retained source archive, original SF100 pages and
finalized delivery, the customer's warehouse and history, selected report files,
member inventory and original receiving helpers. Keep the actual archive hash.

Receive it with the same installed product:

~~~sh
starforge local-dataset receive \
  --archive /absolute/Local_Dataset_Receiving.zip \
  --sha256 ORIGINAL_COMPLETE_ARCHIVE_SHA256 \
  --output /absolute/private/received-local-dataset \
  --request-id ORIGINAL_RECEIVING_REQUEST_UUID
~~~

This runs the original Python receiver. It validates the whole archive and
every declared original member before publishing the receiving directory.
Keep its returned `warehouseDirectory` as the original handoff; make a
separate sparse working copy and open that copy with the same DuckDB customer
runtime. The full operator guide provides the exact copy, reopen and original
Frictionless source-receive commands.

Open the imported editions, mappings, view history, saved queries and full
reports after receiving. Close and reopen the working customer from the same
directory. A later source edition, mapping or report uses a deliberate new
operation; the delivered original remains available.

## Continue the same work after interruption

| Saved state | Operator action |
| --- | --- |
| Source or query changed | Review the new complete scope before a following operation |
| Native page transfer interrupted | Inspect and resume its original request and accepted page prefix |
| Import or export response lost | Read the original saved operation and returned edition/files |
| View or query revision changed | Open its current revision and review the intended update |
| Package download interrupted | Continue the retained transfer against the original member identities |
| Receiving response lost | Reopen the same receiving operation, archive identity and destination |
| Merchant stopped | Reopen the original configuration and directories through Applications |
| Customer service stopped | Reopen its original Python application, then the combined workspace |

The local source delivery records explicit operator authorization. Customer
acceptance and any actual payment remain separate business events. Use the
original merchant release and buyer acquisition workflow when delivering paid
access under the agreed terms.
