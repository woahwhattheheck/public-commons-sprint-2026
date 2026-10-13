# Receive the complete municipal operating suite

A continuing handover has a selected source package, a complete editable workspace for each desk being transferred, and the original or reviewed outputs needed for the next task. Install the source package once; choose the matching receiver for each workspace JSON.

[OPERATING.md](OPERATING.md) covers the complete six-application installation and saved-directory launch. [WORKFLOWS.md](WORKFLOWS.md) describes cross-application source imports, report/analyst/crew returns and the exact files that connect the work.

## Identify the complete editable file

| Application | Complete workspace schema | Saved database | Recipient identity after receive |
| --- | --- | --- | --- |
| Collection | commons.open311.workspace-export.v1 or commons.open311.workspace-export.v2 | open311.sqlite | Restores the original workspace identity and records the receiving operation |
| Reporting | commons.open311.reporting-workspace.v1 | open311-reporting.sqlite | Keeps the new recipient identity, records original workspace/revision, archives the received operation history and begins recipient revision 1 |
| GIS | commons.open311.gis-workspace.v1 | open311-gis.sqlite | Restores the original workspace identity and advances from its revision |
| Follow-through | commons.open311.follow-through-workspace.v1 | open311-follow-through.sqlite | Restores the original workspace identity and advances from its revision |
| Field Desk | commons.open311.field-desk-workspace.v1 | open311-field-desk.sqlite | Restores the original workspace identity and advances from its revision |
| Service configuration | commons.open311.service-configuration-workspace.v1 | open311-service-configuration.sqlite | Restores the original workspace identity and advances from its revision |

Collection v2 includes saved multi-window/page collections. The current collector receives both v1 and v2. A complete reporting JSON export with a selected report uses the reporting-workspace envelope and retains its full source closure.

Use a new empty destination for each received desk. The receive action validates the complete package, original file identities and saved relationships before committing its state. Keeping each desk in its own directory also makes the correct Applications binding and private host alias explicit.

If the delivery is a ZIP customer folder, extract it into the recipient's private handoff directory and select the complete workspace JSON listed in its manifest. These receiving commands accept the complete JSON file. Keep the delivered archive and its file manifest alongside the extracted edition.

## Choose the ordinary outputs for the next task

| Output | Purpose and selection |
| --- | --- |
| Original source JSON or other original input file | Retains the exact original body. Collector source export selects an immutable capture; other desks' source export selects their imported source record. |
| Complete collection JSON | Transfers a collection and all its original observations to reporting or GIS. Select --collection ID with collector kind json. |
| Reporting JSON | Transfers complete report/source editions. Select --report ID when the downstream GIS operator needs one particular report. |
| GIS GeoPackage, GeoJSON, CSV or JSON | Carries the selected complete analyst handoff or mapped GIS dispatch. Keep its feature, handoff and source-version identities through editing. |
| Follow-through dispatch JSON/CSV/GeoJSON/report | Carries selected approved follow-up actions with original request/order context and receiving column mappings. Complete dispatch JSON can start Field Desk. |
| Field crew JSON and HTML | Carries the selected crew package and editable portable crew interface. Its returned JSON is imported against the same original package. |
| Field destination JSON/CSV/GeoJSON/report | Carries selected reviewed visit versions, original source rows, destination actions, resources and attachments. |
| Service release JSON and report | Carries the reviewed configuration, source, preview, explicit baseline, application order and remaining rows. Its recorded state is PREPARED_FOR_APPLICATION. |
| Application workspace JSON | Carries that desk's complete editable history for receive and continued operation. |

Keep the actual file, byte length and SHA-256 with its intended selection. Hash the file that is being transferred. A new export may carry a new export timestamp, including the reporting workspace's export timestamp. Deliver that concrete edition and keep its original file for any exact retry.

## Export the complete desks

Run the commands from the selected package's private installation directory. Create the private handoff directory before collecting outputs:

~~~sh
install -d -m 700 /absolute/private/handoff

npx --no-install starforge open311 export \
  --workspace /absolute/private/municipal/collection \
  --kind workspace \
  --out /absolute/private/handoff/collection-workspace.json

npx --no-install starforge open311-reporting export \
  --workspace /absolute/private/municipal/reporting \
  --kind workspace \
  --out /absolute/private/handoff/reporting-workspace.json

npx --no-install starforge open311-gis export \
  --workspace /absolute/private/municipal/gis \
  --kind workspace \
  --out /absolute/private/handoff/gis-workspace.json

npx --no-install starforge open311-follow-through export \
  --workspace /absolute/private/municipal/follow-through \
  --kind workspace \
  --out /absolute/private/handoff/follow-through-workspace.json

npx --no-install starforge open311-field-desk export \
  --workspace /absolute/private/municipal/field \
  --kind workspace \
  --out /absolute/private/handoff/field-workspace.json

npx --no-install starforge open311-service-configuration export \
  --workspace /absolute/private/municipal/service-configuration \
  --kind workspace \
  --output /absolute/private/handoff/service-workspace.json
~~~

Export only the desks included in the handover. Choose a new output filename for each delivered edition. Preserve the original source package archive/manifest and its digest with these files.

Finish or recover an admitted collection run before making its whole-workspace handover. Read each application's current state and operation result before delivering a revision that another operator will continue. Reporting, GIS, Follow-through and Field Desk exports accept --expected-revision; service configuration uses --revision. The collector CLI exports its selected current workspace state, while original source export remains tied to an immutable capture ID. Its merchant workspace/file selection supports an explicit expectedRevision.

Keep source attribution, license references and original file metadata with the exports. A printable report or spreadsheet is an ordinary reading/analysis output. The workspace JSON is the complete receiving input.

## Receive each editable workspace

Install the delivered complete suite archive using [OPERATING.md](OPERATING.md#install-the-selected-merchant-product), including the existing runtime preparation when merchant tools will be used. Run npx from that host's private installation directory.

The paths below are separate new private destinations. The operation IDs are examples: select a stable distinct ID for each actual receiving action and keep its complete original file and expected revision.

### Collection

The state command initializes the original collection desk, then receive restores the delivered source/review history:

~~~sh
npx --no-install starforge open311 state \
  --workspace /absolute/private/received/collection

npx --no-install starforge open311 receive \
  --workspace /absolute/private/received/collection \
  --file /absolute/private/handoff/collection-workspace.json \
  --request-id collection-receive-001 \
  --expected-revision 0

npx --no-install starforge open311 state \
  --workspace /absolute/private/received/collection
~~~

The receiver preserves catalogs, individual captures, complete collection plans/pages/windows, every retained response, reviews and operation results. It restores the original workspace identity and adds the receiving action.

### Reporting

~~~sh
npx --no-install starforge open311-reporting receive \
  --workspace /absolute/private/received/reporting \
  --file /absolute/private/handoff/reporting-workspace.json \
  --request-id reporting-receive-001 \
  --expected-revision 0

npx --no-install starforge open311-reporting state \
  --workspace /absolute/private/received/reporting
~~~

Reporting keeps the new destination UUID. It copies every original source, profile, report, review and series head; retains original operation history under its original workspace identity; and saves the new receiving action at destination revision 1. Continue the received series with its saved report/profile IDs and the destination's current revision.

### GIS

~~~sh
npx --no-install starforge open311-gis receive \
  --workspace /absolute/private/received/gis \
  --file /absolute/private/handoff/gis-workspace.json \
  --request-id gis-receive-001 \
  --expected-revision 0

npx --no-install starforge open311-gis state \
  --workspace /absolute/private/received/gis
~~~

The complete source files, handoffs, analyst returns, individual review decisions, mapped dispatches and operation history transfer together. Receiving restores the original UUID, retains the input file descriptor and adds the receiving revision.

### Follow-through

~~~sh
npx --no-install starforge open311-follow-through receive \
  --workspace /absolute/private/received/follow-through \
  --file /absolute/private/handoff/follow-through-workspace.json \
  --request-id follow-through-receive-001 \
  --expected-revision 0

npx --no-install starforge open311-follow-through state \
  --workspace /absolute/private/received/follow-through
~~~

Original request/order files and schemas, profiles, operating editions, explicit relationships, assignments, returned review files, decisions and dispatches remain available. Continue a selected edition using its actual current work/approval state. The recipient retains the original workspace identity.

### Field Desk

Field Desk uses --input for the complete file and --expected-revision for its mutation:

~~~sh
npx --no-install starforge open311-field-desk receive \
  --workspace /absolute/private/received/field \
  --input /absolute/private/handoff/field-workspace.json \
  --request-id field-receive-001 \
  --expected-revision 0

npx --no-install starforge open311-field-desk status \
  --workspace /absolute/private/received/field
~~~

The received desk includes original approved dispatch context, crews and visit versions, attachment bytes, portable packages, complete returned files, partial decisions, supervisor approvals and destination updates. Its original UUID remains the working identity. Continue a visit or import a later crew return against the retained original package.

### Service configuration

Service configuration uses --input, --revision and --output. Its validate command can inspect the complete package before receiving:

~~~sh
npx --no-install starforge open311-service-configuration validate \
  --input /absolute/private/handoff/service-workspace.json

npx --no-install starforge open311-service-configuration receive \
  --workspace /absolute/private/received/service-configuration \
  --input /absolute/private/handoff/service-workspace.json \
  --request-id service-receive-001 \
  --revision 0

npx --no-install starforge open311-service-configuration state \
  --workspace /absolute/private/received/service-configuration
~~~

Every original source, saved profile version, full-register preview, declared baseline and implementation release transfers with its original history. The original workspace UUID is restored and its revision advances for the receiving action. Profile reads return the current profile separately from prior history; use the returned current version ID for a subsequent profile save, preview or release.

## Open the received Applications

After receiving, select the directory containing the correct SQLite file from the first table. All six commands use the same startup form:

~~~sh
npx --no-install starforge open311-field-desk serve \
  --workspace /absolute/private/received/field \
  --host 127.0.0.1 --port 0
~~~

Use the selected application's command for its own directory. Open the actual URL from the compact startup line and inspect the received source/work selection.

For managed Applications, complete receiving before the first Review/Save of the destination. Applications preparation records its directory and UUID. If an application entry was saved against the earlier empty destination, stop that managed process, Review/Save the received directory again, then Start/Open. Reporting retains its destination UUID, while the other five receivers restore the original UUID; checking the resulting saved state gives the correct binding in each case.

On the second host, an external MCP client's generated configuration must name that host's actual Node executable and installed runtime paths. Generate it through the received/prepared runtime using the original merchant configuration workflow in [OPERATING.md](OPERATING.md#register-the-installed-merchant-with-the-mcp-client).

## Continue through the typed providers

The collection, GIS, Follow-through, Field Desk and service configuration providers each select a private workspace alias and declared input aliases. A receiving input alias binds a complete local file, its SHA-256 and the file kind/format supported by that provider. Keep the exact host schema and provider-specific input declaration from its MCP guide.

| Provider | Complete host and typed receiving contract |
| --- | --- |
| open311-workspaces | [Collection MCP.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/MCP.md) |
| open311-gis-workspaces | [GIS MCP.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/gis/MCP.md) |
| open311-follow-through-workspaces | [Follow-through MCP.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/follow-through/MCP.md) |
| open311-field-desk-workspaces | [Field Desk MCP.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/field-desk/MCP.md) |
| open311-service-configuration-workspaces | [Service configuration MCP.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/service-configuration/MCP.md) |

Reporting continues through its browser, CLI and direct SDK. Its existing source contribution supplies those interfaces.

For a merchant receiving action, select the original input alias, exact file hash, stable request ID and expected receiving revision. The provider binds that host input to the saved operation. Keep the selected revision while paging current work or reading revision-bound files. The unchanged selected file can be reopened after a provider restart using its expected hash and completed offset.

## Download a complete file through the merchant

Use the existing connected MCP transport with the typed client. This reads the entire source file, verifies its final length and SHA-256, and then saves it:

~~~js
import { writeFile } from 'node:fs/promises';
import { Open311MerchantClient } from
  '@tokenjunkielabs/starforge-merchant/merchant/open311/client';

const desk = new Open311MerchantClient(
  (name, args) => transport.callTool({ name, arguments: args }),
  'desk',
);
const original = await desk.downloadFile(
  { kind: 'source', capture: 'CAPTURE_ID' },
  { limit: 65536 },
);
await writeFile('/absolute/private/handoff/requests.original.json',
  original.bytes, { flag: 'wx', mode: 0o600 });
console.log(original.file);

const current = await desk.status();
const bundle = await desk.downloadFile({
  kind: 'workspace',
  expectedRevision: current.revision,
});
await writeFile('/absolute/private/handoff/municipal-workspace.json',
  bundle.bytes, { flag: 'wx', mode: 0o600 });
console.log(bundle.file);
~~~

The first argument selects the complete file. The second controls chunks and optional streaming. downloadFile returns file metadata, bytesRead and the complete Buffer as bytes. For a larger file, an onChunk callback can write each original chunk to the caller's selected destination.

For an interrupted manual read, keep the complete file selection, expectedSha256, last completed offset and readId. Continue from that offset with the same selection. After the retained reader expires or the merchant process restarts, omit readId and reopen the same selected file with expectedSha256 and offset. The existing reader checks the current bytes before continuing. A changed selection requires obtaining and delivering the intended new edition as a separate file.

### Collection provider receiving example

On the receiving host, complete [Prepare the runtime](OPERATING.md#prepare-the-runtime-for-the-selected-source-archive) using the delivered source archive and its digest, then initialize the merchant and generate its client configuration through that runtime as shown in [Attach the merchant tools](OPERATING.md#attach-the-merchant-tools). The generator records that host's actual Node and installed source paths. Keep its configuration and workspace paths local to that receiving host.

Create the receiving desk with the CLI state command. In its private host connection file, select that directory and bind the actual bundle path and delivered SHA-256 under an input alias:

~~~json
{
  "label": "Received municipal workspace",
  "directory": "/absolute/private/open311-received",
  "connectionProfiles": {},
  "inputs": {
    "municipal-handoff": {
      "label": "Complete municipal source and review history",
      "path": "/absolute/private/handoff/municipal-workspace.json",
      "sha256": "DELIVERED_SHA256"
    }
  }
}
~~~

This object is the receiving alias under workspaces in the original host file. Reload the merchant host configuration after saving the file with mode 0600. The tool selects the alias; the complete private file path remains host configuration.

Use the typed receiver:

~~~js
const receiver = new Open311MerchantClient(
  (name, args) => transport.callTool({ name, arguments: args }),
  'received',
);
const source = await receiver.input('municipal-handoff');
const empty = await receiver.status();
const result = await receiver.receive({
  input: 'municipal-handoff',
  expectedSha256: source.sha256,
  requestId: 'municipal-receive-01',
  expectedRevision: empty.revision,
});
console.log(result);
~~~

Open the same receiving directory through its browser or Applications entry. A concurrent browser observes the received identity through the live startup endpoint. For an Applications row saved before receiving, stop the managed process and Review/Save its received workspace binding before the next Start/Open, as described above.


## Recover an interrupted receiving response

Keep the exact request ID, original expected revision and complete input file. Read that operation before repeating the action. A retained success returns its original result; a retry of that same action uses its original input and original revision. A different input or intended change receives a new request ID after the current state is inspected.

| Desk | Saved operation lookup |
| --- | --- |
| Collection | open311 operation --workspace DIR --id REQUEST_ID |
| Reporting | open311-reporting operation --workspace DIR --request-id REQUEST_ID |
| GIS | open311-gis operation --workspace DIR --request-id REQUEST_ID |
| Follow-through | open311-follow-through operation --workspace DIR --request-id REQUEST_ID |
| Field Desk | open311-field-desk operation --workspace DIR --request-id REQUEST_ID |
| Service configuration | open311-service-configuration operation --workspace DIR --request-id REQUEST_ID |

Prefix these commands with npx --no-install starforge from the installation directory. In the browser, recover the retained original command before preparing another write. Reporting preserves received original operations as archived history associated with the source workspace.

If the destination reports that it already contains work, inspect that saved desk and operation result. A separate independent handover uses a new empty directory. Existing records and original decisions continue in their saved workspace.

## Deliver the continued edition

After the recipient's work is saved, export a new complete workspace and the selected outputs. Record the resulting application, workspace ID, revision, selected report/handoff/dispatch/package/release ID, original source identities and the actual output file hashes in the handover's ordinary manifest.

Reopen the saved recipient directory, inspect the selected original case and current decision, and open its complete exported workspace through the receiving application's normal workflow when another handover is required. Keep source publication and license references attached to the customer files.
