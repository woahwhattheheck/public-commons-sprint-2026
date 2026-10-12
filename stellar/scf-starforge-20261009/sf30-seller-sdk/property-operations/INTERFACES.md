# Property Operations: SDK, merchant MCP and Applications

This contribution connects the existing Socrata Property Operations workspace to native JavaScript clients, an authenticated merchant agent interface and the maintained Applications manager. The original workspace still owns source captures, property requests, reviewed identity links, inspections, comparisons, reports and publisher/customer records.

The contribution adds two commands:

| Command | Purpose |
| --- | --- |
| `starforge property-application` | Inspect the complete source/workspace binding or serve the original workspace with a managed startup announcement. |
| `starforge property-mcp` | List the declared tools, call the attached merchant interface, receive complete exports and reopen their exact files offline. |

The source-owned provider IDs are `property-workspaces` for merchant MCP and `property-operations` for Applications. The `property-operations` source selection includes the original property/Socrata, publisher, buyer, release and Applications dependencies. There is no second property database or capture engine.

## Open the original workspace

The workspace directory must already contain the original Socrata `workspace.json`. Its immutable `createdAt` identifies the source workspace even before the first Property record is saved. Property actions subsequently bind the original property ID and revision.

Inspect a binding before directly launching:

~~~sh
starforge property-application binding \
  --directory /absolute/original-property-workspace \
  --connection-file /absolute/private/property-connection.json
~~~

Use the returned `bindingSha256` and `createdAt` in the direct launch:

~~~sh
starforge property-application serve \
  --directory /absolute/original-property-workspace \
  --connection-file /absolute/private/property-connection.json \
  --expected-created-at ORIGINAL_CREATED_AT \
  --expected-binding-sha256 REVIEWED_BINDING_SHA256 \
  --port 0
~~~

A selected original private vendor-host JSON file can be supplied with `--property-host`. It contains the original environment-variable references and enabled contracts. Credential values stay in the host environment. Serving without that file leaves new vendor requests disabled.

The launcher verifies every member of the maintained package's `manifest.json`, the source-owned registrations, the selected Node executable and any original host settings. It acquires the original workspace owner before atomically publishing its private connection record. An earlier matching record is preserved under its exact hash before replacement. A different source, workspace or setting is rejected.

The record contains the authenticated local URL, source identity and original owner instance. Keep it private. SIGINT or SIGTERM closes the original listener and workspace, drains their existing work and then removes only this instance's exact connection record. A failed drain leaves its history available for reconciliation.

## Use the native JavaScript SDK

The package exports `@tokenjunkielabs/starforge-merchant/property/client` with complete TypeScript declarations.

~~~js
import {
  createPropertyOperationsClient,
  readPropertyConnection,
} from '@tokenjunkielabs/starforge-merchant/property/client';

const connection = await readPropertyConnection('/absolute/private/property-connection.json');
const client = createPropertyOperationsClient({
  url: connection.url,
  expectedCreatedAt: connection.createdAt,
});

try {
  const state = await client.status();
  const prepared = await client.prepare('property.baseline.save', {
    edition_id: SELECTED_EXISTING_HPD_EDITION,
    columns: REVIEWED_ORIGINAL_COLUMN_NAMES,
    actor: 'Receiving operator',
    note: 'Retain the complete existing HPD source as property context.',
  }, { key: ORIGINAL_REQUEST_KEY });

  // Save the full prepared object to the original operation journal here.
  const result = await client.invoke(prepared);
  console.log(result.result);
} finally {
  await client.close();
}
~~~

Keep the complete `prepared` value, including action, key, property ID, expected revision and input digest. Do not construct a new request after losing a response. `inspectPrepared(prepared)` returns one of these native dispositions:

| Disposition | Meaning and continuation |
| --- | --- |
| `DONE` | The original operation is committed. `invoke` returns that saved result. |
| `ISSUED` | The original vendor request may already have been sent. Keep its original request and receipt. An explicit `resumeIssued` on the same request invokes the native retained-evidence recovery; it does not send the request again. |
| `ABSENT_AT_ORIGINAL_REVISION` | No committed operation exists and the original workspace revision still matches. The same prepared request can be invoked. |
| `ABSENT_AFTER_CHANGE` | The workspace advanced without this operation. Reconcile the original state and decide whether a newly reviewed request is appropriate. The client does not silently rebase it. |

The native write roster remains file import, HPD baseline, property selection, Propply/RentCheck/inspection request preparation, original request run/recovery/import, identity review, comparison, inspection binding, report save and resource export. The original publisher actions remain available for a selected native property resource, including review, publish, release and buyer-session operations.

`record(group,id)` reads the complete retained record. `receiveFile(selection,{onChunk})` reads the complete original file with its declared length and SHA-256. Its supported selections are a property file or a named member of an existing source export. The publisher-file methods preserve the original draft and buyer-session file kinds.

Every SDK instance owns only its HTTP calls. Closing it rejects new work and waits for already-started calls and complete file receiving. It leaves the original native owner alive.

## Configure the authenticated merchant attachment

Use one private JSON connection document:

~~~json
{
  "schema": "stellar-forge.property-workspaces.v1",
  "workspaces": {
    "portfolio": {
      "label": "Original property portfolio",
      "directory": "/absolute/original-property-workspace",
      "urlFile": "/absolute/private/property-connection.json",
      "expectedCreatedAt": "ORIGINAL_CREATED_AT"
    }
  },
  "files": {
    "original-source": {
      "path": "/absolute/reviewed/source-file.json",
      "bytes": 12345,
      "sha256": "COMPLETE_ORIGINAL_SHA256"
    }
  }
}
~~~

Replace the example values with observed identities. `urlEnv` is an alternative to `urlFile`; choose one. File aliases are selected by the host, and the full bytes are verified again immediately before native import. Agent requests do not accept arbitrary host paths or credential values.

The original merchant-provider initializer accepts:

~~~json
{
  "directory": "/absolute/private/property-agent-host",
  "connection": "/absolute/private/property-workspaces.json",
  "name": "Property Operations"
}
~~~

Run `starforge merchant-providers init property-workspaces --options /absolute/setup.json`, or call the source-owned initializer export through the maintained provider registry. The host directory must be outside the native workspace. The initializer uses the original SF82 release store, writes the original merchant configuration and verifies it through the maintained host reader. Serve that configuration with the existing merchant MCP command and its original bearer-token environment selection.

The 22 tools form one provider:

| Area | Tools |
| --- | --- |
| Original workspace | `workspaces`, `status`, `reconnect` |
| Full records and operations | `records`, `record`, `operation` |
| Reviewed changes | `prepare`, `file_import_prepare`, `inspect_request`, `invoke`, `action` |
| Native files | `files`, `file`, `file_read`, `file_release` |
| Publisher files | `publisher_file`, `publisher_file_read` |
| Complete customer receiving | `export_prepare`, `export_manifest`, `export_inventory`, `export_file`, `export_file_release` |

Tool names use the `merchant_property_` prefix. Inventories return a native revision and continuation offset. Keep that revision for every page. Full records remain in their original nested shape.

The generic `action` tool preserves the original read, publisher, retained-query and package-export actions. It cannot bypass the prepared native property-write envelope. A `package.export` operation is an original native action without an idempotency key: save the preceding export IDs, and inspect the native export list after an uncertain response before asking for another export.

## Receive every declared file

Select an already saved native source export or property resource. Merchant `export_prepare` records its complete immutable inventory; it does not create another native export. The inventory includes the original native manifest and every file, with complete relative names, lengths and SHA-256 values.

~~~js
import { openPropertyClient, reopenPropertyExport }
  from '@tokenjunkielabs/starforge-merchant/property/merchant-client';

const client = await openPropertyClient({
  url: ORIGINAL_MERCHANT_URL,
  tokenEnv: 'ORIGINAL_MERCHANT_TOKEN',
  workspace: 'portfolio',
});
try {
  const retained = await client.exportPrepare({
    createdAt: ORIGINAL_CREATED_AT,
    selection: { kind: 'source-export', exportId: EXISTING_NATIVE_EXPORT_ID },
  });
  await client.download({
    directory: '/absolute/customer/received-export',
    exportId: retained.exportId,
    expectedManifestSha256: retained.manifestFile.sha256,
  });
} finally {
  await client.close();
}

await reopenPropertyExport({
  directory: '/absolute/customer/received-export',
  exportId: ORIGINAL_RECEIVING_EXPORT_ID,
  expectedManifestSha256: ORIGINAL_MANIFEST_SHA256,
});
~~~

The original file-receiving engine retains the endpoint, workspace, manifest and per-file progress. Keep that receiving directory and the same endpoint when continuing an interrupted download. It verifies the full bounded native stream before exposing chunks, preserves nested names and rejects a changed source. Offline reopen verifies all received files after the merchant borrower and its listener have closed.

The command equivalent uses `property-mcp tools|call|inspect|download|reopen`. `call` takes one JSON argument file and can save the complete JSON result. `reopen` needs no live native or merchant listener. See `property-mcp --help` for the exact retained-file arguments.

## Manage the original application

In the maintained Applications workspace, choose **Property Operations**, the complete READY runtime and the existing property workspace. Supply the private connection-file location and optional original host-settings file. Review, save, connect the source release, then Start.

The manager uses its existing application IDs, source adoption, resource keys, startup observer, operation journal and Stop recovery. Each run owns one original native workspace. The SDK and merchant clients attach through the connection record and never acquire a second native lease.

Source adoption may relocate the same complete package. The binding compares its full maintained manifest and each source file; only the installation path can change. Mutable property revisions are intentionally outside the startup digest. Reviewed records can therefore advance during one managed lifetime without changing the application identity.

The same application can be stopped and reopened with its retained captures, property ID, review history and customer files intact. Preserve a failed or interrupted operation and read its original management outcome before starting a replacement listener.

## Original HPD and customer meaning

The complete receiving entry under `operations/scf-property-operations-receiving-20261012/` composes this full workflow against an explicitly identified existing HPD workspace and already purchased customer package. It does not capture the source again, create a property-vendor request or make another purchase.

HPD rows remain building-in-project records. Multiple rows may describe one building or parcel; their presence does not establish violations or an inspection result. Propply source coverage and RentCheck receiving identities retain the original domain's review requirements. Missing values remain unknown, and property links are explicit operator decisions.

The receiving report distinguishes the complete advertised agent catalog from the methods actually invoked. It records the actual source, baseline, customer, application, native export, merchant manifest, Stop/reopen and cold-restore identities. The final customer package contains the complete original files and the instructions needed to reopen them.
