# WooCommerce ERP operations through the merchant agent

The merchant agent, installed client and command line now operate the complete
original Woo ERP project: map the store, prepare an order edition, review and
approve it, deliver to the selected Acumatica application, reconcile its actual
target, correct the owned original lines, and receive the complete project with
another engineer.

The [original ERP product guide](../../stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/ERP.md)
describes the mapping contract, exact decimal arithmetic, native journal and
receiving comparison. These tools call that same authenticated merchant client
and PHP implementation. The WordPress manager, browser and agent therefore see
the same order, current revision, mapping, pending attempt and recovery decision.

## Install and connect the original store

Use the complete source edition containing the ERP implementation and this
adapter. The normal Woo preparation command copies the original plugin, its ERP
modules, operating guide and replaceable mapping example. Keep the generated
plugin and Node merchant source on that same edition.

Configure the original merchant operator and approved ERP connection as described
in [ERP.md](../../stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/ERP.md).
The existing WordPress application-password environment names remain in the
merchant operator file. Its approved exact WordPress origin is also the original
ERP-client transport origin. The server separately selects the registered
Acumatica application and credential reference.

Add optional ERP input aliases to the existing Woo connection file:

~~~json
{
  "schema": "stellar-forge.woocommerce-connection.v1",
  "stores": {
    "shop": {
      "label": "Main store",
      "operator": "./merchant-operator.json",
      "erpInputs": {
        "production_map": {
          "label": "Reviewed product and customer mapping",
          "kind": "mapping",
          "file": "./erp-map.json"
        },
        "received_project": {
          "label": "Original received ERP project",
          "kind": "project",
          "file": "./received/project.json"
        }
      }
    }
  }
}
~~~

Relative paths resolve against this existing connection file. Keep the connection,
operator and source files private, with file mode0600 and private directories.
An input alias can be declared before the file arrives. The input tools read its
actual current bytes and hash when the operator selects it. The existing receipt
and accounting-export aliases continue to be configured in the same store.

Start the maintained merchant MCP using that connection:

~~~sh
starforge merchant-mcp init-woocommerce \
  --dir /private/shop/merchant-agent \
  --connection /private/shop/woocommerce.json
starforge merchant-mcp serve --config ORIGINAL_RETURNED_CONFIG_PATH --port 3211
~~~

Use the configPath returned by initialization. The existing merchant server
supplies incoming authentication through its configured bearer-token environment
name or OAuth configuration. The installed ERP client uses the same MCP
connection; the WordPress and ERP credential values stay with their original
hosts.

The new command is registered with the normal installed distribution:

~~~sh
starforge registrations --source woo-erp-operator
starforge merchant-woo-erp help
starforge merchant-woo-erp status \
  --url http://127.0.0.1:3211/mcp --store shop
~~~

Use Node22+ and the original Linux flock dependency used by retained downloads.
The source entrypoint is stellar-forge/mcp-merchant-operator/woo-erp-cli.mjs.
The normal configured Woo provider includes all23 ERP tools alongside its existing
order, native-review and refund operations.

## Prepare a complete mapping

1. Use inputs to see the host-declared mapping and project aliases.
2. Read input for the selected mapping. Retain file.sha256 and its returned
   value.snapshotSha256.
3. Read status for the installed connection readiness and currentMapId.
4. Save the exact mapping input against that original selection.
5. Run mapping-check against the returned immutable mapId. The original PHP
   implementation checks the installed Acumatica contract and records its result.

~~~sh
starforge merchant-woo-erp input \
  --url http://127.0.0.1:3211/mcp --store shop --input production_map
starforge merchant-woo-erp mapping-save \
  --url http://127.0.0.1:3211/mcp --store shop \
  --input production_map --expected-sha256 ORIGINAL_FILE_SHA \
  --expected-current-map-id CURRENT_MAP_SHA
starforge merchant-woo-erp mapping-check \
  --url http://127.0.0.1:3211/mcp --store shop --map-id SAVED_MAP_SHA
~~~

For the initial selection, use --expected-current-map-id none. The CLI converts
that one value to the native empty selection. Later saves require the currently
selected map ID. mapping-select selects an already retained native mapping
through the same original selection guard.

A mapping input can be the editable native mapping JSON or the complete
mapping.json received from another operator. The original compiler validates all
customer/product/fee/shipping bindings and registered connection rules.

## Read every original value

Large mappings and order journals stay complete. The adapter returns bounded
pages of original JSON children and explicit pointers for expanding them. Every
read includes the selected source snapshot SHA256:

| Selection | Original source |
| --- | --- |
| input | Exact host-declared file bytes; the page hash is the file SHA256. |
| mapping | Complete native mapping record, including its retained contract checks. |
| read | Complete original ERP order journal. Its snapshot excludes the separate live observation clock. |
| status mapping history | Original native mapping summaries, with their own stable page hash. |

Use an empty pointer for the root. Object keys and array indexes use JSON Pointer
escaping: ~0 for a tilde and ~1 for a slash. The current order inspection returns
ready-to-use pointers for its edition, source, plan, approval, target, attempts,
decisions and imports.

Objects and arrays have at most100 children per page. A small child contains its
full value; a larger child retains its pointer and type for expansion. Strings
are returned in pieces of at most65536 UTF-16 units. Follow nextOffset until it is
null, repeating expectedSnapshotSha256. If another operator changes the source,
reopen its current first page and inspect the new native revision.

For example, inspect the current order, then read its exact prepared plan:

~~~sh
starforge merchant-woo-erp inspect \
  --url http://127.0.0.1:3211/mcp --store shop --operation-id ORIGINAL_OPERATION_SHA
starforge merchant-woo-erp read \
  --url http://127.0.0.1:3211/mcp --store shop \
  --operation-id ORIGINAL_OPERATION_SHA \
  --pointer /editions/0/plan --expected-snapshot-sha256 ORIGINAL_RECORD_SHA
~~~

Use the returned currentEdition pointer when the current edition has another
index. The saved journal remains the authority for every original request,
response, line crosswalk and operating decision.

## Prepare, approve and deliver the original order

Select an actual original Woo numeric order ID from the existing store or ERP
queue. Prepare it with the selected mapping and revision0 for a new ERP project.
An existing project uses its current retained revision.

~~~sh
starforge merchant-woo-erp prepare \
  --url http://127.0.0.1:3211/mcp --store shop \
  --order-id ORIGINAL_WOO_ID --map-id SAVED_MAP_SHA --expected-revision 0
~~~

The response returns native.operationId, native.revision, currentEditionId,
current source status, target summary and pointers into the original journal.
Review its complete source, exact amounts, mapped target and request. Then use
approve with the exact edition and current revision. Supply the actual operating
reason; use a private --params JSON file for a longer decision.

~~~json
{
  "operationId": "ORIGINAL_OPERATION_SHA",
  "expectedRevision": 3,
  "editionId": "CURRENT_EDITION_SHA",
  "reason": "The original order, mapped customer, items and amounts were reviewed."
}
~~~

~~~sh
starforge merchant-woo-erp approve \
  --url http://127.0.0.1:3211/mcp --store shop \
  --params /private/shop/approval.json
starforge merchant-woo-erp deliver \
  --url http://127.0.0.1:3211/mcp --store shop \
  --operation-id ORIGINAL_OPERATION_SHA \
  --expected-revision APPROVED_REVISION --edition-id APPROVED_EDITION_SHA
~~~

Read the actual returned httpStatus and native state. A native HTTP200 can retain
an operating conflict or incomplete receiving comparison; the original state
explains that outcome. Successful receiving retains the actual ERP document key
and native line references.

The transport preserves the original75-second ERP request deadline and16MiB
response capability. MCP operation arguments remain small: large mappings and
projects travel through declared inputs and retained file downloads. The client
allows90 seconds for the original ERP operation to return through MCP.

## Resolve uncertainty and correct the same target

After an interrupted delivery, inspect the same operationId and revision.
reconcile performs the original receiving read, records its observation and
resolves the retained attempt when the target matches. It uses the original
target key or business reference.

When the unique target needs a correction, inspect its complete returned document
and exact targetBaselineSha256. identify-target records that selected original
target and the operating reason. A pending request additionally requires the
checked completed processing outcome, provided together with
confirmOperationEnded:true. The original engine preserves this as an identified
correction baseline.

prepare and approve then use the current source and mapping. The native
correction retains each original Woo line reference and its returned ERP line
key, adds new original lines and removes only owned lines. Approval and delivery
reread the selected target baseline through the original implementation.

authorize-retry accepts the checked provider outcome, confirmOperationEnded:true,
confirmNoOrder:true and the current journal revision. The original engine
searches the target again and clears its earlier approval. The next deliberate
delivery uses another reviewed approval on that same operation.

These tool names expose the existing decisions; the original journal and
Acumatica receiving logic determine their result.

## Complete export and resumable receiving

Export a project at its inspected native revision using a stable export alias.
The export contains the complete original project JSON: mappings, source editions,
approved requests, HTTP outcomes, target comparisons, native line crosswalks,
decisions and import history.

~~~sh
starforge merchant-woo-erp export \
  --url http://127.0.0.1:3211/mcp --store shop --kind project \
  --id ORIGINAL_OPERATION_SHA --expected-revision CURRENT_REVISION \
  --export-id order-handover
starforge merchant-woo-erp download \
  --url http://127.0.0.1:3211/mcp --store shop --kind project \
  --id ORIGINAL_OPERATION_SHA --export-id order-handover \
  --expected-manifest-sha256 RETURNED_MANIFEST_SHA \
  --directory /private/receiver/order-handover
~~~

A mapping export uses kind mapping, its immutable map ID, and an export alias;
it has no journal-revision argument.

The retained export has one original data file (project.json or mapping.json)
and a compact transport manifest. The native project digest remains inside the
original project. The transport manifest binds that file's byte count and SHA256
to the original store, kind, native ID, revision and export alias.

A completed export ID reopens its existing bytes without rerunning the exporter.
An interrupted publication can finish its manifest from the already retained
native file. A later journal revision uses a different export alias.

The maintained downloader owns the private directory lease, verified partial
bytes, checkpoint and final file publication. Rerun download with the same
directory and exact manifest hash to continue the original download. It reopens
expired server read snapshots by the same file hash and byte offset. Completion
also checks the original native project digest.

~~~sh
starforge merchant-woo-erp inspect-local \
  --directory /private/receiver/order-handover \
  --expected-manifest-sha256 RETURNED_MANIFEST_SHA
~~~

The project contains customer and address data. Retain it as a private customer
handover together with the original Woo installation and source. The original
ERP guide describes the receiving database and connection requirements.

## Reopen with another engineer

On the receiving store, restore the original Woo order and register the approved
ERP connection. Declare received project.json as a project input, inspect its
actual file SHA256, then call import with that alias and hash. The PHP receiver
checks the complete original history.

If the receiving store already has this live ERP journal, reopen it through
inspect. A receiving installation can import the original project when that
journal is absent, or reopen the same already imported project by its native
digest.

Use mapping-select for the retained mapping, then bind-import with the returned
current revision and the actual operating reason. Binding checks the original Woo
order identity and installed ERP contract. Reconcile its target before preparing
another delivery.

For two stores declared on the same MCP host, import-export receives an exact
retained project by fromStore, original id, exportId and expectedManifestSha256.
The source export stays in its original directory, and the native receiving
store performs the same project validation.

## Typed installed client

~~~js
import {openWooErpClient, inspectReceivedWooErp}
  from '@tokenjunkielabs/starforge-merchant/merchant/mcp/woocommerce/erp';

const client = await openWooErpClient({
  store: 'shop',
  url: 'http://127.0.0.1:3211/mcp',
  tokenEnv: 'MCP_ACCESS_TOKEN'
});
const order = await client.call('inspect', {operationId});
const prepared = await client.call('export', {
  kind: 'project',
  id: operationId,
  expectedRevision: order.native.revision,
  exportId: 'order-handover'
});
const received = await client.download({
  kind: 'project',
  id: operationId,
  exportId: 'order-handover',
  expectedManifestSha256: prepared.manifestSha256,
  directory: '/private/receiver/order-handover'
});
await inspectReceivedWooErp({
  directory: received.directory,
  expectedManifestSha256: received.manifestSha256
});
~~~

The client exports typed arguments and results for every command. It also accepts
an explicit host-owned native MCP client with endpoint/call for a composed native
receiving operation. Its calls remain attached to the selected store and original
transport identity. Closing the merchant owner drains admitted ERP calls and
releases temporary read snapshots; WordPress retains its original journal and
native target.

The complete tool definitions are in woo-erp-schema.mjs. Source publication
uses the existing woo-erp-operator distribution contribution, and normal source
packaging retains these files through the existing merchant component.
