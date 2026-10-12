# UtilityAPI and Green Button through merchant MCP

This provider attaches the original private Utility console. It exposes the complete source-to-customer workflow: retained imports and interval records; preview and reviewed selection; native dataset edition and comparison; bill reconciliation; UtilityAPI capture continuation; publisher, release and buyer operations; complete original exports; and cold receiving through the same source engine.

The original Python operator remains the owner of its database, source files, action journal and publisher. Closing the MCP host drains its own HTTP requests and retained file handles. Start and Stop belong to the original console or its [managed Applications entry](../../stellar/scf-starforge-20261009/sf30-seller-sdk/utility-energy/MANAGED_APPLICATION.md).

## Configure the existing console

Start the original Utility command with a private connection file. The same command is used by managed Applications:

~~~sh
starforge utility-energy --workspace /private/utility-customer serve \
  --connection-file /private/utility-console.url --port 0
~~~

Create a private host connection file:

~~~json
{
  "schema": "stellar-forge.utility-workspace-connection.v1",
  "workspaces": {
    "customer": {
      "label": "Customer utility workspace",
      "consoleUrlFile": "/private/utility-console.url",
      "workspaceDirectory": "/private/utility-customer",
      "files": {
        "meter-source": {
          "kind": "source",
          "path": "/private/incoming/utility-original.json",
          "provider": "utilityapi",
          "sourceKind": "intervals",
          "name": "Received original meter intervals"
        },
        "received-workspace": {
          "kind": "workspace",
          "path": "/private/incoming/utility-workspace.zip"
        }
      },
      "captures": {
        "meter-window": {
          "path": "/private/utility-capture.json",
          "label": "Reviewed meter window"
        }
      },
      "buyerWorkspaces": {
        "buyer": {
          "directory": "/private/original-buyer",
          "label": "Original customer buyer"
        }
      }
    }
  }
}
~~~

Files and capture profiles may include a host-reviewed sha256. The workspace may include expectedBindingSha256 from the native binding command. All paths are host references. Tool arguments select these aliases and repeat reviewed file digests.

The connection file is the original console's private one-line loopback URL. The client checks its file ownership and permissions, reads the authenticated launch identity, and pins the original workspace, native application marker and source binding during attachment. Its explicit reopen tool rereads the connection file after the same console restarts.

Add utilityEnergyWorkspaceConnection to an existing merchant host, or use the original source-owned provider initializer with a private options file:

~~~json
{
  "directory": "/private/utility-mcp",
  "connection": "/private/utility-connection.json",
  "name": "Utility customer operations"
}
~~~

~~~sh
starforge merchant-providers init utility-energy-workspaces \
  --options /private/utility-mcp-options.json
~~~

The initializer creates the original merchant release store and private customer-export directory. An existing releaseStore can be supplied explicitly. The host's normal authenticated HTTP command serves the resulting merchant-mcp.json configuration.

The product's existing distribution contribution declares merchantProviders.utility-energy-workspaces. Configuration, catalog, startup instructions and runtime construction use the maintained provider registry. Unconfigured Utility native owners are not opened.

## Tools and native state

The catalog contains 22 tools. Full command schemas are returned by tools/list and by the original merchant provider inspector.

| Tools | Complete operating scope |
| --- | --- |
| workspaces, status, reopen | Declared handles, original state and authenticated binding, reattachment after the same console restarts. |
| inventory, inspect, operation | Original source/review/edition/export arrays and complete records; saved action results by UUID. |
| records, series, changes | Original meter/channel records, quantities, source provenance and exact native edition differences. |
| files, ingest, restore | Complete host-file identities, reviewed raw source receiving and original portable reconstruction. |
| capture_profiles, capture_start | Reviewed native UtilityAPI configuration and original capture creation. |
| action | Original preview, review, edition, reconciliation, capture continuation, merchant, publisher, release and buyer actions. |
| buyer_session, publisher_state | Host-bound original buyer workspace and explicit limits; original workspace-owned publisher state. |
| file_prepare, exports, manifest, file, file_release | Complete native files, retained manifests, bounded chunk reads, resume and explicit handle release. |

Every name has the merchant_utility_ prefix. Native fields retain their original snake_case names inside payload and returned native objects. The outer MCP envelope uses workspace, expectedRevision and requestId.

Inventory pagination returns snapshot, offset, total, items and nextOffset. Continuing after page zero requires expectedSnapshot. Record and comparison pagination uses the original native offsets and next_offset; select a useful page size for complete nested records.

Imports retain their original bytes and SHA256. Interval records retain meter and series identity, start/duration, raw quantities, source units, multiplier, currency and provenance. The native analysis engine handles conversion, duplicate/corrected readings, coverage and bill reconciliation. A decision or rate assumption does not rewrite the original source.

## Reviewed actions and exact recovery

Read status and the relevant complete record before mutation. Retain one canonical UUID and the complete submitted payload. Submit that same UUID with the reviewed current integer revision:

~~~js
const result = await client.action({
  workspace: 'customer',
  action: 'edition.build',
  payload: { review_id: originalReviewId },
  expectedRevision: reviewedRevision,
  requestId: retainedRequestId
});
~~~

After an interrupted response:

~~~js
const saved = await client.operation({
  workspace: 'customer',
  requestId: retainedRequestId
});
~~~

The result is the original utility_actions record. A completed action is recovered from its existing result and fingerprint. A failed or running action requires inspection of the original operation and retained workspace state. The client does not silently replay a mutation. HTTP transport errors preserve requestId and identify the original operation reader.

The action tool accepts the original named operations, including:

- analysis.preview and review.save with the source selection, original preview SHA, reviewer, note and acknowledged issue IDs.
- edition.build, edition.compare, dataset.query and bills.reconcile.
- capture.advance, capture.pause and capture.resume on the original capture_id.
- merchant.configure with the exact payment, origin and path.
- package.export using the original review_id.
- publisher.prepare using a verified Utility export_id; draft preview/review/publish, snapshot selection, release stage/inspect/activate/rollback/start/stop, and original buyer review/prepare/run/recover/account/export.

Raw source import and portable restore use their dedicated file tools. Capture creation uses a declared profile. A buyer session uses a declared buyer workspace. The agent supplies original reviewed action data without selecting an arbitrary host pathname.

## Source and UtilityAPI capture

Use files to read actual full file identities. Ingest repeats expectedSha256 and forwards the selected original source as raw bytes to the same owner. The source kind, provider, name and optional original context come from host configuration.

A capture profile is a private JSON file using the original UtilityAPI configuration:

~~~json
{
  "name": "Reviewed meter period",
  "token_env": "UTILITYAPI_TOKEN",
  "meter_ids": ["original-meter-id"],
  "collections": ["meters", "bills", "intervals"],
  "start": "2026-01-01T00:00:00+00:00",
  "end": "2026-02-01T00:00:00+00:00"
}
~~~

The environment value belongs to the original Python owner. The profile contains only its configured reference. capture_profiles returns the complete selected configuration and byte hash; capture_start repeats that hash, current revision and request UUID. Native pagination, provider response bodies, pause, retry timing and continuation remain in the original capture journal.

The original selection preview exposes source priority, coverage, conflicts and issue identities. Review and acknowledge the relevant issues, retain the named selection, build its native edition, query that edition and compare it with an earlier edition. The same original comparison remains available as paginated records and a complete NDJSON file.

## Publisher, running seller and customer

Configure the original merchant payment terms, export the reviewed Utility edition, and prepare that export through publisher.prepare. This passes the verified adjacent dataset.csv, dataset.json, seller.json, source.json and complete sourceFiles closure to the existing publisher.

Review the original draft and publication revision, publish, and stage the dataset through the original SF82 release adapter. Runtime settings retain the original port, facilitator and allowLocalFacilitator fields. Activate or roll back with the original generation check, and start the retained release.

The buyer review obtains the original seller offer and query. Prepare that reviewed offer, then use buyer_session with a declared buyer workspace, buyerId, maxPages, maxTotalAtomic and optional maxRows/maxPageBytes. maxTotalAtomic is the aggregate native atomic-unit limit. Approval, settlement, accounting, unpaid-page continuation and complete delivery remain in the existing buyer and publisher engines.

The original publisher export kinds are draft-csv, draft-review, buyer-config, session-manifest, session-csv, session-jsonl and session-review.

## Complete retained file receiving

file_prepare accepts one original selection:

| Selection kind | Required original selection |
| --- | --- |
| delivery | exportId: complete customer ZIP. |
| workspace | Complete portable source/review/native-edition workspace ZIP. |
| export-file | exportId and name from the original delivery, including delivery.json. |
| original | id of a retained Utility import. |
| changes | id of a retained native edition comparison. |
| native-project | id of an original native dataset build. |
| publisher | publisherKind and the original draft/buyer/session id. |

Preparation streams the complete native response into the existing private merchant export directory. It records the original source selection, authenticated binding, before/after revision, actual file length and SHA256. An expectedRevision binds both ends of the preparation; expectedSha256 can pin an already-reviewed immutable output.

Generated workspace and customer ZIPs retain their actual response bytes. Their creation timestamps can differ between separate preparations. A completed MCP file manifest identifies one exact prepared response, and subsequent chunk reads use that retained file.

~~~js
import {
  openUtilityEnergyClient,
  downloadUtilityEnergyExport,
  reopenUtilityEnergyExport
} from '@tokenjunkielabs/starforge-merchant/merchant/utility-energy/client';

const client = await openUtilityEnergyClient({
  url: 'http://127.0.0.1:8787/mcp',
  tokenEnv: 'MCP_ACCESS_TOKEN'
});
const prepared = await client.filePrepare({
  workspace: 'customer',
  selection: { kind: 'delivery', exportId: originalExportId },
  expectedRevision: originalRevision
});
const received = await downloadUtilityEnergyExport({
  client,
  directory: '/private/received-utility-delivery',
  exportId: prepared.exportId,
  expectedManifestSha256: prepared.manifestSha256
});
const reopened = await reopenUtilityEnergyExport({
  directory: received.directory,
  exportId: prepared.exportId,
  expectedManifestSha256: prepared.manifestSha256
});
~~~

The original retained-download engine verifies the manifest, resumes the same output under its download lease and verifies every completed file. After a reader expires or the MCP process restarts, resume with the same manifest/file hashes and next offset. Original native descriptors are read in bounded chunks, without loading or copying a multi-gigabyte file for each request.

Exports can be listed and downloaded after the native console closes. The declared host alias and retained manifest still identify their original custody. Closing the MCP host releases its owned descriptors; it preserves the complete files and original operator.
