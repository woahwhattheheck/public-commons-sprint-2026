# Field Desk merchant tools and typed client

The **open311-field-desk-workspaces** provider operates the same saved Field Desk as the browser and CLI. Its normalized configuration key and family are **open311FieldDeskWorkspaces**. The maintained host configuration field is **open311FieldDeskWorkspaceConnection**.

Prepare the complete selected merchant product using [INSTALL.md](INSTALL.md). Initialize each saved operating and receiving directory before selecting it in the host configuration.

## Host-selected original files

Save a private connection JSON file with mode 0600. [examples/host-connection.json](examples/host-connection.json) contains the complete shape. Its schema is stellar-forge.open311-field-desk-host.v1.

~~~json
{
  "schema": "stellar-forge.open311-field-desk-host.v1",
  "workspaces": {
    "operations": {
      "label": "Municipal field work",
      "directory": "/absolute/private/field-desk",
      "inputs": {
        "dispatch": {
          "label": "Complete reviewed municipal dispatch",
          "path": "/absolute/handover/reviewed-dispatch.json",
          "sha256": "REPLACE_WITH_COMPLETE_ORIGINAL_FILE_SHA256",
          "kind": "source",
          "format": "json"
        },
        "returned": {
          "label": "Original crew return",
          "path": "/absolute/handover/crew-return.json",
          "sha256": "REPLACE_WITH_COMPLETE_ORIGINAL_FILE_SHA256",
          "kind": "return",
          "format": "json"
        },
        "context": {
          "label": "Original selected task context",
          "path": "/absolute/handover/task-context.json",
          "sha256": "REPLACE_WITH_COMPLETE_ORIGINAL_FILE_SHA256",
          "kind": "attachment",
          "format": "binary",
          "contentType": "application/json"
        }
      }
    }
  }
}
~~~

Replace every hash placeholder with the full SHA-256 of the actual complete file. Relative paths resolve from the connection file. Workspace aliases select distinct original private directories; file aliases select exact original files. Each configuration supports up to 128 workspaces and each workspace up to 128 original input aliases.

| Input kind | Format | Complete input |
| --- | --- | --- |
| source | json | Approved Follow-through dispatch or editable Follow-through workspace |
| return | json | Original partial or complete crew return |
| workspace | json | Editable Field Desk workspace |
| attachment | binary | Original file bytes with the declared media type |

A JSON attachment uses attachment/binary to preserve its original bytes as a visit file. JSON source, return and workspace inputs are decoded strictly as UTF-8. The configured file SHA and the action's expectedSha256 must match the actual entire file before import.

readFieldDeskWorkspaceConfiguration(path) validates the configuration and original directories. FIELD_DESK_HOST_SCHEMA exports the exact schema. readFieldDeskHostInput(entry, alias, expectedSha256) returns the selected complete bytes and metadata.

Each file mutation records the original alias, kind, format, complete SHA and declared media type alongside the original action. File selection is part of request replay, including when two aliases happen to refer to identical bytes.

## Initialize the maintained merchant host

Save setup options:

~~~json
{
  "directory": "/absolute/private/field-desk-merchant",
  "connection": "/absolute/private/field-desk-host.json",
  "name": "Municipal field work"
}
~~~

Use the original prepared runtime:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime -- \
  merchant-providers init open311-field-desk-workspaces \
  --options /absolute/private/field-desk-setup.json
~~~

The equivalent source function is initializeFieldDeskMerchantWorkspace from mcp-setup.mjs. An optional releaseStore selects an existing original SF82 release store. Otherwise the maintained initializer prepares one. The setup keeps its original input and saved attempts, so the same arguments resume an interrupted setup.

Generate the merchant client entry on the host that will launch it:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime -- \
  merchant-mcp-client-config \
  --config /absolute/private/field-desk-merchant/merchant-mcp.json \
  --name open311-field-desk \
  --output /absolute/private/field-desk-mcp-client.json
~~~

The generated entry uses that host's actual Node and prepared stdio source paths. The maintained --merge option preserves an existing client configuration while adding an unused server name to a new output. The direct transport is merchant-mcp-stdio --config through the same runtime.

## Complete operating catalog

Names begin with merchant_open311_field_desk_.

| Suffix | Customer operation |
| --- | --- |
| workspaces / status | Original aliases, current identity, revision, counts and saved operation summaries |
| records | Page sources, crews, issued packages, returns or destination updates |
| input / inspect_source | Verify the original host file and inspect its actual dispatch choices |
| import_source / source / source_rows | Save full original context, inspect its definition and page complete source rows |
| crew_save / crew | Save named crew versions and read membership history |
| visit_save / visits / visit | Save, search and inspect visits, source changes, files and history |
| attachment_save | Retain complete original file bytes and their declared media type |
| package_create / package | Issue selected current visits and inspect the complete package by pages |
| return_import / return | Retain original crew return and inspect proposals, conflicts and decisions |
| decisions_apply | Accept/reject selected exact proposals with explicit overlap choices |
| visits_review | Approve selected current visit versions or return work to the crew |
| update_create / update | Save and inspect selected approved destination updates or closure requests |
| operation | Recover an original request result and its input identity |
| receive | Reopen the whole editable history in an empty selected desk |
| file_read / file_release | Deliver or release complete retained files |

Reads of saved records require expectedRevision. They return workspaceId/revision with items, total, offset, limit, returned and nextOffset. Merchant pages accept 1–100 items; follow nextOffset until null. Large original row bodies and complete packages remain available through file delivery.

source returns dispatch definition, totals and a row count; source_rows carries the original rows. crew pages history. visit pages history or attachment metadata while returning the current visit, source row, crew and approval. package pages visits or attachment metadata; update pages selected items or attachment metadata. return pages proposals or saved decisions. Select section explicitly when changing those views.

All mutations require requestId and expectedRevision. Read status to prepare a new action. Recover a dropped response using operation with the same request ID; if it has no saved result, retry the original complete input. Validation and revision failures roll back. Changed selections use a new request ID.

## Typed operating example

The client adapts an existing merchant transport:

~~~js
import { Open311FieldDeskMerchantClient } from
  '@tokenjunkielabs/starforge-merchant/merchant/open311-field-desk/client';
import { writeFile } from 'node:fs/promises';

const desk = new Open311FieldDeskMerchantClient(
  (name, args) => merchantTransport.callTool({ name, arguments: args }),
  'operations',
);

let state = await desk.status();
const source = await desk.importSource({
  input: 'dispatch',
  expectedSha256: originalDispatchFileSha256,
  name: 'Reviewed municipal work',
  requestId: 'field-source-001',
  expectedRevision: state.revision,
});

const crew = await desk.saveCrew({
  requestId: 'field-crew-001',
  expectedRevision: source.revision,
  crew: { name: selectedCrewName, members: selectedCrewMembers, active: true },
});

const rows = await desk.sourceRows({
  sourceId: source.source.id,
  expectedRevision: crew.revision,
  offset: 0,
  limit: 100,
});

const visit = await desk.saveVisit({
  requestId: 'field-visit-001',
  expectedRevision: crew.revision,
  visit: {
    sourceId: source.source.id,
    sourceKey: selectedOriginalSourceKey,
    crewId: crew.crew.id,
    title: selectedVisitTitle,
    instructions: selectedInstructions,
    priority: 'normal',
  },
});

const issued = await desk.createPackage({
  requestId: 'field-package-001',
  expectedRevision: visit.revision,
  name: selectedPackageName,
  visitIds: [visit.visit.id],
});

const delivered = await desk.downloadFile({
  kind: 'crew-html',
  packageId: issued.package.id,
  expectedRevision: issued.revision,
});
await writeFile('/absolute/handover/crew-work.html', delivered.bytes, {
  flag: 'wx',
  mode: 0o600,
});
~~~

Select the actual original source key from the paged source rows. Creating additional visits continues from the last saved revision. Named crew/member values and visit instructions belong to that operating desk.

The offline crew editor exports a complete original field-return file. Configure it as a new return input alias and retain its actual whole hash. Then call importReturn with input, expectedSha256, requestId and expectedRevision. Inspect returned with the saved return ID and section proposals.

applyDecisions takes returnId, reviewer and selected decisions. Every decision names proposalId, accept/reject and expectedVisitVersionId. Conflicting changes use fieldChoices with changeId and returned/current. Source or assignment changes require the applicable acknowledgement. Unselected proposals remain pending.

reviewVisits selects exact visit versions for approve or return_to_crew. createUpdate selects the current approved versions and names the destination, reviewer and update/request_closure action. The full input interfaces are declared in index.d.mts and mcp-client.d.mts.

## Full byte delivery and receiving

downloadFile(selection, options) returns {file, bytesRead, bytes}. bytes is a Buffer. Options include chunk limit, maximumBytes and async onChunk; a streaming sink receives complete bytes without the accumulated Buffer.

Every chunk keeps its original file name/type/size/hash, byte offset and selected workspace revision. The client checks exact base64, counts, continuation progress, terminal length and whole SHA-256. Original retained snapshots remain stable across later browser changes. A failed download exposes the original selection, expected hash and offset for reconciliation.

| File kind | Required item |
| --- | --- |
| workspace | Complete desk; no item selector |
| source | sourceId |
| crew-json / crew-html | packageId |
| returned | returnId |
| visits-csv | Optional sourceId, crewId, status and q |
| update-json / update-csv / update-geojson / update-report | updateId |
| attachment | attachmentId; complete original bytes |
| operation | operationId; complete retained original input and result |

All file selections require expectedRevision. A saved operation view replaces large source/return/attachment bodies with their original byte/hash descriptors. Its complete body is available as an operation file. A workspace-receive operation keeps a compact original-file descriptor and incoming package hash to preserve repeated handovers without recursive copies of whole prior packages.

To receive an editable desk, configure its actual complete JSON as a workspace input in an initialized empty destination alias. Call receive with that alias, expectedSha256, a new stable request ID and expectedRevision 0. The receiver validates and reconstructs original sources, crew and visit versions, attachment bytes, issues, field returns, partial decisions, approvals and destination packages.

## Ownership and normal shutdown

The provider lazily opens its own existing database handles. Closing it waits for admitted operations, closes its retained readers and releases those handles. An independently running browser continues with the same saved workspace. Applications, release initialization, private host inputs and complete file delivery use the maintained merchant contracts.
