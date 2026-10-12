# Wherobots in Applications

**Wherobots spatial workspace** opens the existing Python operator from a saved entry in the original Applications console. It retains the workspace's native workflow reviews, saved operations, complete output editions, comparisons and customer handovers.

The application uses the source-owned Wherobots connection, original browser and original SQLite workspace. Applications supplies Review, Save, Start, Open, Stop and the retained run history.

## Select the original workspace

Initialize a new workspace through the original command only when a new workspace is needed:

~~~sh
starforge wherobots --python /absolute/runtime/bin/python3 --workspace /absolute/private/spatial init --title "Spatial operations"
~~~

The command returns its original workspace_id. Put that exact ID and canonical directory in the existing private workspace connection, with file mode0600:

~~~json
{
  "schema": "stellar-forge.wherobots-workspace-connection.v1",
  "workspaces": {
    "spatial": {
      "label": "Spatial operations",
      "directory": "/absolute/private/spatial",
      "workspaceId": "ORIGINAL_WORKSPACE_ID",
      "python": "/absolute/runtime/bin/python3"
    }
  }
}
~~~

The connection accepts the same optional profile, pythonPath and named inputs documented in [source/MERCHANT.md](source/MERCHANT.md). A profile contains the original organization, region and SDK configuration. Its secret API key belongs in the existing host environment or private environment JSON. Keep the installed Python environment selected by source/requirements.txt; source-based customer receiving uses the original PyArrow engine when reading Parquet or GeoParquet.

The application can open a source workspace or an independently received customer. For a customer, select the directory and actual workspace_id returned by the original importer. A separate alias keeps the source and receiving identities clear.

## Review, save and start

Choose a runtime edition containing this contribution. Create an Application and select **Wherobots spatial workspace**.

| Field | Selection |
| --- | --- |
| Workspace connection | The original private Wherobots connection JSON. |
| Workspace alias | An existing name in that connection. |
| Python runtime | Optional absolute Python executable; otherwise the connection must already declare an absolute executable. |
| Local port | 0 selects an available loopback port. |
| Private environment JSON | The existing private JSON of environment names and string values, if needed. |

Review the existing workspace and source selection, then Save. Adopt the reviewed runtime using the normal installed workflow, review the start and Start the entry. Open appears after the actual authenticated Python listener reports the selected workspace.

The saved preparation includes the connection, optional profile, Python executable/virtual environment selection, original module directories and the application source. It retains the stable workspace ID and directory. Editing a workflow or receiving a corrected handover preserves that workspace identity, so normal work remains available at the next start.

The source and adopted runtime may live in different directories. Their selected original source bytes must agree. Changing the connection, executable, profile or application source requires reviewing the saved entry again.

## Operate a complete spatial workflow

The browser's existing controls cover the full customer workflow:

1. Read the selected organization/runtime, retain the original script and source files, and save the native workflow definition.
2. Review the saved workflow revision. Submit it through the original SDK or attach its existing native run ID.
3. Reopen the retained operation to recover its native run, read paged logs and capture every declared output part.
4. Open an edition and dataset to read its full typed rows. Compare the corrected edition with its predecessor and download the complete report and changed rows.
5. Export the complete workflow handover or the original SF30 dataset package. Receive all source companions through SF82 when publishing that data product.
6. Import the complete handover into a separate customer workspace, then import the corrected handover into that same customer. Reopen its original workflow, editions, objects and comparison.

Source-interoperability workspaces use the same browser's retained source collection view. They retain the exact source definitions and all four original fixture-derived datasets used by the source receiving programme.

[source/README.md](source/README.md), [source/OUTPUTS.md](source/OUTPUTS.md) and [source/MERCHANT_CLIENT.md](source/MERCHANT_CLIENT.md) describe the original workflow, output and complete SDK receiving interfaces. The managed application and the merchant tools select the same durable workspace. The application owns its local browser; the existing merchant host owns its own attachment.

## Stop and reopen

Stop signals the supervised Python process through its original server's ready hook. The existing server stops accepting new connections, drains accepted HTTP requests and waits for its native task executor. Idle keep-alive connections have a30-second timeout. After accepted work finishes, the original workspace and browser lease close.

Stopping this local application preserves the native cloud run and all retained workspace data. Its existing controls still provide explicit native cancellation when that operation is requested.

Start the saved entry again to open the same workspace. Each start creates a new process, browser capability and instance ID while retaining the original workflow and edition identities. The private run record stores the exact current Open link.

## Native launcher and typed API

Inspect the same selection from a terminal:

~~~sh
starforge wherobots-app inspect --connection /absolute/private/wherobots.json --workspace spatial
~~~

Open the same workspace:

~~~sh
starforge wherobots-app serve --connection /absolute/private/wherobots.json --workspace spatial --port 0
~~~

Use --python when the connection uses a command name instead of an absolute executable. SIGINT and SIGTERM drain this same original server.

Embedders can use the paired application-launcher.mjs/application-launcher.d.mts API, exported as ./seller/wherobots/application:

~~~javascript
import {prepareWherobotsApplication,startWherobotsApplication} from "./application-launcher.mjs";

const selection = await prepareWherobotsApplication({
  connection: "/absolute/private/wherobots.json",
  workspace: "spatial"
});
const app = await startWherobotsApplication({
  connection: selection.binding.connectionFile,
  workspace: selection.binding.workspace,
  selection,
  port: 0
});
console.log(app.url);
try {
  // Work through the original authenticated browser and workspace.
} finally {
  await app.close();
}
~~~

The ready record includes the actual Node and Python PIDs, original workspace, connection/source hashes, native runtime information and browser URL. The shared Applications observer verifies that record against its adopted source and managed process, then reads the original authenticated /api/state endpoint before offering Open.

## Source ownership and complete receiving

The contribution registers applicationProviders.wherobots, command wherobots-app, the typed launcher export and every application file alongside the existing merchant provider and consumer. The shared Applications catalogue, preparation and run lifecycle remain the original owners.

application-provider.mjs is the source-owned adapter. application-launcher.mjs reads the actual connection, preserves the selected native environment, supervises one Python child and verifies its startup. managed-serve.py uses the existing serve(on_ready) hook and original Workspace. The complete core source directory remains independently importable in a customer handover.

examples/managed-receiving.mjs continues an already operated original workspace: it opens the managed browser, reads the selected workflow and every page of every dataset from both editions, receives the complete handover through the original export endpoint, closes the app, reopens the same workspace and checks all original edition identities. Use the source and customer directories from the existing native/source receiving operation.

~~~sh
node examples/managed-receiving.mjs --connection /absolute/private/wherobots.json --workspace customer --workflow-id ORIGINAL_WORKFLOW_ID --out /absolute/private/managed-receiving
~~~

The output retains the selected source/connection, complete typed rows, original workflow and export task, byte-identical complete handover, and both actual managed process identities. An interrupted attempt remains under attempts/ when the same original selection resumes.
