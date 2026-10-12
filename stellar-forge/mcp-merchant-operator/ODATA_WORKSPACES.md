# OData source and customer workspaces over MCP

The merchant operator exposes the same OData workspace used by the industrial browser, CLI and seller SDK. Agents can discover an actual OData 4 service, save and review queries, import complete editions, compare records, publish datasets or live merchants, prepare original SF88 buyer handoffs, and receive customer pages. All interfaces keep the original connection, query, edition, export, release and purchase identities.

The adapter, odata-workspace.mjs, composes the maintained modules under ../../stellar/scf-starforge-20261009/sf30-seller-sdk/odata/, the original SF82 lifecycle and the shared retained-file reader.

## Connect the existing workspace

Create a private connection JSON and existing private workspace directories:

~~~json
{
  "schema": "stellar-forge.odata-workspace-connection.v1",
  "workspaces": {
    "reference": {
      "label": "Northwind source",
      "directory": "/srv/starforge/northwind",
      "services": {
        "northwind": {
          "label": "OData reference service",
          "url": "https://services.odata.org/V4/Northwind/Northwind.svc/"
        }
      }
    },
    "receiving": {
      "label": "Customer receiving",
      "directory": "/srv/starforge/northwind-receiving"
    }
  }
}
~~~

The connection file is an owned regular private file, at most one MiB. Workspace directories are existing canonical private directories. Give each directory one alias. The host supports up to 32 workspaces and 32 entries per input category.

From the merchant MCP directory, initialize and serve through the existing transport:

~~~sh
node serve.mjs init-odata-workspaces \
  --dir /srv/starforge/odata-operator \
  --connection /srv/starforge/odata-connection.json

node serve.mjs serve \
  --config /srv/starforge/odata-operator/merchant-mcp.json \
  --port 8788 \
  --token-env MERCHANT_MCP_TOKEN
~~~

An existing merchant configuration can add odataWorkspaceConnection pointing to the same private file. The original OAuth resource host and stdio transport expose this same tool family.

Each workspace can declare:

| Field | Named entry |
| --- | --- |
| services | label, full OData service-root url, optional authEnv and allowLoopback. |
| imports | label, file and optional sha256 of a complete original workspace transfer. |
| responses | label, file and optional sha256 of an original saved live merchant response. |
| collectionSelections | label, file and required sha256 of a complete native collection selection. |
| collectionSources | label, file and required sha256 of an original complete Analysis source document. |
| merchants | Public merchant profile described below. |
| runtime | Original dataset runtime port, optional facilitator and allowLocalFacilitator. |

Paths resolve relative to the connection file. authEnv names the existing environment variable containing the complete Authorization header. The native source transport reads the value on its host. Each company, tenant or service root has an explicit service alias. A local reference service can set allowLoopback:true.

An imported receiving workspace can inspect, compare, review and export its retained source immediately. Resuming its source import or starting its live service uses the matching host service declaration.

## Capture and review the original collection

Call merchant_odata_status to list the aliases, then merchant_odata_open:

~~~json
{"workspace":"reference"}
~~~

Open returns the process-owned instanceId. Repeating open selects that same instance.

Call merchant_odata_source:

~~~json
{"workspace":"reference","action":"connect","service":"northwind","connectionId":"northwind"}
~~~

merchant_odata_catalog pages the actual advertised entity sets. Add entitySet:"Orders" to page its original structural properties, key fields, types, nullability and collection details.

Save the complete query with merchant_odata_plan:

~~~json
{
  "workspace":"reference",
  "action":"save",
  "planId":"northwind-orders",
  "connectionId":"northwind",
  "name":"Northwind Orders",
  "query":{
    "entitySet":"Orders",
    "select":["OrderID","CustomerID","EmployeeID","OrderDate","Freight","ShipCountry","ShipName"],
    "filters":[],
    "orderBy":[{"field":"OrderID","direction":"asc"}],
    "count":true,
    "pageSize":200
  }
}
~~~

The original compiler supplies complete keys, typed filter literals, stable ordering and the query fingerprint. An absent top imports the whole selected collection. Inspect the saved plan with action:"inspect", then record its intended scope:

~~~json
{"workspace":"reference","action":"review","planId":"northwind-orders","note":"Complete Orders collection with its original key, shipping fields and exact Freight text."}
~~~

Start with merchant_odata_capture:

~~~json
{"workspace":"reference","action":"start","editionId":"orders-baseline","planId":"northwind-orders","label":"Orders baseline"}
~~~

The default returns while the original import continues. merchant_odata_status and merchant_odata_edition expose its saved progress. action:"pause" selects that same edition, and action:"resume" continues its original retained nextLink. The original engine commits each actual source page before the next request. pageBudget selects the capture step size, default 10,000 provider pages; wait:true awaits that step.

A stable editionId identifies one saved query and label. Repeating start with the same inputs returns the existing edition. A different query or label needs another ID. After a lost response, inspect that original ID and continue it.

merchant_odata_rows reads only overlapping normalized source pages for the requested offset and limit. Its actual source hashes, Decimal/Int64 text and null/missing distinctions stay intact.

Accept a complete edition with merchant_odata_edition:

~~~json
{"workspace":"reference","action":"review","editionId":"orders-baseline","decision":"accept","note":"Complete original collection received and reviewed for the selected customer scope."}
~~~

Capture a refresh with a new stable edition ID and the same plan. merchant_odata_compare takes beforeId and afterId, computes the original keyed comparison once, and retains its complete result. Added, removed and changed records have separate page offsets. The returned comparisonId downloads the original full result.

merchant_odata_export projects an accepted edition into the maintained CSV dataset engine and returns its immutable exportId and filenames. merchant_odata_query takes that exportId and the original dataset URL query string; the native engine returns its status and body.

## Dataset and live merchant operations

Declare a merchant profile using the merchant's actual configured Stellar asset contract and recipient:

~~~json
{
  "merchants": {
    "orders": {
      "label": "Orders service",
      "origin": "https://data.example.com",
      "path": "/orders",
      "payment": {
        "network": "stellar:testnet",
        "asset": "STELLAR_ASSET_CONTRACT",
        "payTo": "MERCHANT_RECIPIENT",
        "maxTimeoutSeconds": 60
      },
      "amount": "10000",
      "port": 0,
      "operationsPort": 0
    }
  }
}
~~~

The amount is exact positive atomic text. A profile can set original maxPageRows and maxTotalRows limits and the existing HTTPS facilitator URL.

For an immutable dataset merchant, supply profile to merchant_odata_export, then use merchant_odata_publisher:

1. prepare selects exportId, stable releaseId and an optional label. The host's dataset runtime settings compose the original SF82 package.
2. inspect returns the original release digest/source; status returns the selected generation.
3. activate or rollback takes releaseId, expectedGeneration and reason.
4. start takes expectedGeneration and the inspected expectedDigest; it returns the native instance, listener and operating mode.
5. stop closes that exact owned instanceId.

For a live source merchant, call merchant_odata_live:

~~~json
{"workspace":"reference","action":"prepare","liveServiceId":"orders-live","planId":"northwind-orders","profile":"orders"}
~~~

The original compiler retains the CSDL, query, public offers, OpenAPI, source binding and complete native package. start and stop select liveServiceId. detail returns the original query/offer context and pages both buyer and customer receiving histories.

A configured facilitator selects the existing native payment factory. Without one, the original merchant exposes its actual 402 offer in challenge-only mode. Runtime mode is returned by the original engine.

## Original SF88 buyer and customer receiving

merchant_odata_buyer prepares the stable purchase intent:

~~~json
{"workspace":"reference","liveServiceId":"orders-live","intentId":"customer-orders-page-1"}
~~~

Its returned id selects the original buyer handoff. merchant_odata_file with kind:"buyer", id:"orders-live", that recordId and filename reads request.json, offers.json, buyer.json or handoff.json. The files retain the original SF88 request/output paths for its configured signer, budget and purchase policy.

After the original buyer saves its response, merchant_odata_receive takes buyerId. A host responses alias can also select the complete saved original response:

~~~json
{"workspace":"reference","liveServiceId":"orders-live","response":"customer-page-1"}
~~~

The native receiver validates the operation, metadata identity, query, source hashes, rows, count and continuation. It retains the actual response, normalized JSONL, receiving manifest and next request. Identical bytes reuse the original receiving ID.

Prepare the next original paid page with merchant_odata_buyer, a new stable intentId and the prior receivedId. The original cursor supplies that next request.

## Complete live collections and analytical customer delivery

A complete live collection joins the original saved response pages for one source and query. The original collection engine checks every request/cursor transition, declared entity key, scalar representation, page receipt and terminal response. It retains the whole source chain alongside typed rows, CSV, CSDL-derived projection and a portable Analysis source document.

Use the same open workspace and live service already selected above. Six collection operations compose its original live-operation sequence:

| Tool | Customer operation |
| --- | --- |
| merchant_odata_collections | Page READY and INCOMPLETE saved collections for a liveServiceId. |
| merchant_odata_collection | Inspect the original collection and page each original-page/file inventory. |
| merchant_odata_collect | Create or reopen a complete collection under a stable collectionId. |
| merchant_odata_collection_rows | Read typed original rows and their nextOffset. |
| merchant_odata_collection_source | Read the complete portable Analysis source document, required file identities and an original projection mapping. |
| merchant_odata_collection_restore | Reconstruct the same complete collection from a declared source document or another declared workspace's original collection. |

Collection records retain sourceBinding, queryFingerprint, manifestSha256, original row/page counts, completion, key fields, field mapping and their precise Analysis source identity. The full collection manifest is a retained file. In the inspect response, pages, originalFiles, retainedFiles, reportedCounts and files each have their own pagination entry. Follow every required nextOffset. A page of metadata is a view into the complete saved collection.

### Select the original response chain

After receiving the saved merchant responses, retain their actual receivedIds in original request order. Optional buyerIds bind the corresponding original SF88 requests. The first request comes from the original product package; later requests use the previous original response's next-request. The native engine rejects reordered, repeated, missing, cross-query or nonterminal chains and duplicate declared entity identities.

For up to 500 pages, merchant_odata_collect accepts pages directly:

~~~js
const selection = {
  workspace: "reference",
  liveServiceId: "orders",
  collectionId: "northwind-orders-complete",
  title: "Northwind Orders — complete retained live query",
  pages: receivedPages.map(page => ({
    receivedId: page.receivedId,
    ...(page.buyerId ? {buyerId: page.buyerId} : {})
  })),
  fields: ["OrderID", "CustomerID", "OrderDate", "Freight", "ShipCountry"]
};
const collection = await call("merchant_odata_collect", selection);
~~~

Here call is the existing authenticated merchant MCP client's tools/call adapter, returning the native structured result. receivedPages is the original receiving history selected above; the example does not run another request.

A complete larger chain uses a private host-declared selection file. This keeps the existing 128 KiB MCP request ceiling while admitting the original collection engine's full 10,000-page range. The file has schema stellar-forge.odata-collection-selection.v1 and the complete liveServiceId, collectionId, pages, optional fields/title/limits. Its maximum size is two MiB. The [retained Northwind selection](examples/odata-collection-selection.json) contains all five original response IDs for the original orders service and its 830 rows.

Declare the file under that workspace's collectionSelections:

~~~json
{
  "collectionSelections": {
    "orders-complete": {
      "label": "Complete retained Orders selection",
      "file": "/srv/starforge/inputs/orders-selection.json",
      "sha256": "COPY_THE_ACTUAL_COMPLETE_SELECTION_FILE_SHA256"
    }
  }
}
~~~

The host calculates the hash from the complete selected file. The original status call exposes its alias, label and pinned SHA. Use the actual selected service and collection IDs:

~~~json
{
  "workspace": "reference",
  "liveServiceId": "orders",
  "collectionId": "northwind-orders-complete",
  "selection": "orders-complete"
}
~~~

A declared selection supplies all its pages, title, fields and limits; those fields are not combined with a different inline selection. The selected file's bytes and hash accompany the returned native result.

The original hard ceilings are 10,000 pages, 1,000,000 rows, 128 MiB of original response input and 128 MiB per principal output. A selection can choose lower explicit limits. The original complete Analysis projection also enforces its receiving row and total-size limits before publication. Choose a different explicit source query if a complete selection exceeds its product limits.

Keep the collectionId and exact selection across an interrupted reply. Inspect or repeat merchant_odata_collect with that same original selection to complete an INCOMPLETE record. An existing ID rejects different source pages, title, fields or limits. A separate customer edition receives its own ID.

### Transfer the complete original Analysis source

merchant_odata_collection_source returns the original source document and a complete files list. Each entry supplies path, bytes, sha256 and exact merchant_odata_file arguments. The source manifest and all its content-addressed payloads must retain their relative paths. Those payloads include the original collection manifest/transform and compressed complete original source packets.

~~~js
const source = await call("merchant_odata_collection_source", {
  workspace: "reference", liveServiceId: "orders",
  collectionId: "northwind-orders-complete"
});
for (const file of source.files) {
  // The customer's existing file receiver writes file.path from the exact
  // returned chunk stream and verifies file.bytes and file.sha256.
  let offset = 0, readId;
  do {
    const part = await call(file.tool, {
      ...file.arguments, expectedSha256: file.sha256,
      offset, ...(readId ? {readId} : {}), limit: 65536
    });
    await receiver.accept(file.path, part.offset, part.data, "base64");
    readId = part.readId;
    offset = part.nextOffset;
  } while (offset !== null);
  await receiver.verify(file.path, file.bytes, file.sha256);
}
~~~

receiver is the host's selected durable file receiver. Its output directory and filesystem policy are host configuration. Retain the original download hash and accepted byte offset for recovery; after an MCP restart, omit the expired readId and continue with that same hash. The existing reader verifies the original file once per read, releases it at EOF, and supports explicit release of unfinished reads.

Register the received analysis/source.json through the original Python Analysis application. For this retained Northwind JSON projection, the host command is:

~~~sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /absolute/private/customer-analysis \
  --checkout /absolute/stellar-forge-checkout \
  response --name northwind_orders_live --input-kind document \
  --manifest /absolute/private/received-collection/analysis/source.json \
  --format json --expected-revision 0
~~~

Use the returned source document's actual format; larger original projections may use csv. Use the original current source revision when intentionally selecting another document under an existing source name. Registration copies and verifies the complete source closure inside the original Analysis workspace, retaining its document identity.

The host starts that same AnalysisWorkspace service and registers it with the existing native buyer as described in [Native agent customer analysis](../mcp-paid-agent/ANALYSIS.md). The native agent tool is sf43_discover_review_and_pay with action:"analysis". Its analysisWorkspace is the actual host-registered alias; source names, job IDs and saved revisions remain the original service's values.

Request the exact original mapping using the name and revision returned by registration:

~~~js
const mapping = await call("merchant_odata_collection_source", {
  workspace: "reference", liveServiceId: "orders",
  collectionId: "northwind-orders-complete",
  expectedSha256: source.manifest.sha256,
  source: registered.name, sourceRevision: registered.revision
});
await buyerCall("sf43_discover_review_and_pay", {
  action: "analysis", analysisWorkspace: "customer",
  analysisOperation: "response-preview",
  analysisRequest: {id: savedPreviewId, ...mapping.analysisInput}
});
~~~

Retain savedPreviewId before the call, then inspect the original job until COMPLETE. response-import takes the same preview ID and its actual preview_sha256. The native mapping preserves original Decimal/Int64 text, null/absent state columns and the declared scalar conversion. The collection's exact document format determines the mapping; a CSV fallback uses text values and explicit state columns.

### Use the same SQL, report and workbook workspace

The completed import returns its original immutable version_id and row_count. Activate that exact edition under a reviewed SQL view using the observed view revision. For the reference collection, the full source contains 830 rows. The original selected query and metadata remain attached to the imported edition.

The existing Analysis operations now perform the whole customer workflow:

1. Save a complete detail query using the actual imported column names, and a report query grouped by ShipCountry_state and ShipCountry with COUNT(*). Copy the original current views array into query/report requests.
2. Run the saved SQL under stable job IDs. query-export streams complete typed JSONL, CSV and SQLite from the reviewed result and selected source editions. Retain the completed native manifest and its exact file hashes.
3. Save a report definition pinned to the original query revisions. Run all sections in the same database snapshot, review the retained result, and publish it at the observed publication revision. report-export produces original HTML, JSON and the multi-section CSV ZIP.
4. Select the complete typed query export or published report section through workbook-sources. Save the complete workbook definition, including exact source IDs/hashes and source column ordinals. Build that reviewed definition, then download workbook.xlsx, handoff.zip and manifest.json through workbook-file.
5. Use the original whole-workspace archive operation to transfer imported data, source documents, view/query/report history, complete query exports and workbook delivery. Receiving reopens that same source and saved customer work.

Every new job uses a retained 32-character lowercase hexadecimal ID. An uncertain reply is resolved through that same original job. save-query uses its saved revision comparison; read the current or historical query before retrying an ambiguous save. The [complete worked collection receiver](../../stellar/scf-starforge-20261009/sf30-seller-sdk/odata/live/examples/COLLECTION_CUSTOMER.md) carries this entire native workflow through actual report/workbook files, source reconstruction and full customer packaging.

### Restore the original collection after customer use

The original analytical source retains the complete live collection and its original pages. A receiving live service must have the same source binding, metadata, public merchant origin and operation. Restoring a collection never silently substitutes another supplier or query.

On the same host, select a collection under another declared workspace and its exact Analysis source digest:

~~~js
await call("merchant_odata_collection_restore", {
  workspace: "receiving", liveServiceId: "orders",
  collectionId: "northwind-orders-complete",
  sourceWorkspace: "reference", sourceLiveServiceId: "orders",
  sourceCollectionId: "northwind-orders-complete",
  expectedSha256: source.manifest.sha256
});
~~~

This can read the original immutable source collection while its source workspace is closed. The receiving operation uses the destination's original live sequence and collection lease. Reopening the same ID verifies its complete retained outputs.

For a source transferred through Analysis or another host, declare collectionSources on the destination workspace with label, file and required sha256 pointing to the exact received source.json. Then merchant_odata_collection_restore selects sourceDocument by that alias. Its sibling files stay at their original relative paths. The native receiver verifies the full source closure and service identity before composing the saved collection.

A whole OData workspace transfer already includes every complete collection's original files, Analysis source and receiving history. The MCP transfer reader supports its existing 256,000,000-byte retained-file limit. Larger complete workspace transfers use the original file-based CLI export/restore documented in the [collection guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/odata/live/COLLECTIONS.md); the individual collection-source files remain independently readable through the tools above.

Closing the original merchant workspace drains accepted collection work with the same live/source operations, releases its file reads and closes its owned browser and merchants. Reopen then returns the same saved collections and customer artifacts.

## Transfer, download and reopen

merchant_odata_transfer with action:"create" and a stable transferId saves the complete original bundle. Pause active imports first. The bundle includes source bytes, catalogs, plans, editions, reviews, dataset exports, live packages, buyer handoffs, committed customer receiving files and complete collection/Analysis source files.

Repeated create returns that saved transfer. A later snapshot gets another transferId. action:"list" pages the retained transfers from oldest to newest.

Open the receiving alias and restore:

~~~json
{"workspace":"receiving","action":"restore","sourceWorkspace":"reference","transferId":"customer-handover-1"}
~~~

The native importer checks original file identities before the final state commit. A repeated restore of the same original transfer returns its committed counts. The receiving state retains that transfer identity while new work continues in place.

A host transfer file uses sourceImport instead. Runtime signing keys and credentials remain with their original configured host. Retained absolute SF88 execution paths keep their original meaning when moving a workspace between hosts.

merchant_odata_file supports:

| Kind | Selection |
| --- | --- |
| source | Original source SHA-256 as id. |
| dataset | Original export id and its filename. |
| live-package | Live service id and package filename. |
| buyer | Live service id, buyer recordId and filename. |
| receiving | Live service id, receiving recordId and filename. |
| collection | Live service id, collection recordId and an exact filename from its retained inventory. |
| transfer | Saved transfer id. |
| comparison | Returned comparisonId as id. |

The first chunk returns readId, file SHA-256, complete byte length, offset, base64 bytes and nextOffset. Continue with the same readId, expectedSha256 and returned offset. The shared reader loads the original file once and releases its retained bytes at EOF. Maximum chunk size is 196,608 bytes. An expired read resumes with the same original hash and byte offset. merchant_odata_file_release releases an unfinished read.

## Shared browser and lifecycle

merchant_odata_browser opens the industrial interface over the same original workspace and live operations object. Its source, query, edition, merchant and customer views reflect the agent's saved work. Closing the borrowed browser keeps the MCP-owned workspace and live services available.

merchant_odata_close takes the workspace's instanceId, drains accepted operations, pauses owned imports and closes its original merchants and browser. merchant_odata_open selects a new process instance over those same saved records.

## Original reference source

The OData product retains the public Northwind service document, CSDL and five provider pages for 830 Orders. The original source operator completed two editions, reviewed/compared them, queried the typed dataset and restored the complete package. The selected live-source operation also retains its merchant restart after page one, unchanged continuation and all 830 received rows. This MCP arm consumes those same source and customer records.

Source pins and current installed receiving adoption remain in the [original OData product thread](https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791764617053699).

## Pause an awaited import or close its host

The default capture returns while the original import continues. With wait:true, the call stays open until its selected page budget completes. An explicit capture pause or exact-instance workspace close can interrupt that awaited import through the original AbortSignal path. The committed source prefix and original next link remain available for resume. Closing the enclosing merchant host requests the same pause before draining its active call, then closes its owned browsers, merchants and files.

## Complete customer download and receiving command

The installed `starforge odata-collection-customer` command lists and inspects the original saved collections, downloads their exact source document and every declared analytical/source file, resumes durable byte checkpoints, and invokes the original native collection restore. It also reopens received rows and generates the native Analysis preview mapping from the actual registered source revision. See [Complete OData customer receiving](ODATA_COLLECTION_CUSTOMER.md) for the full CLI, JavaScript API, offline receiving and Analysis/report/workbook continuation. Its source-owned contribution keeps this workflow in the same installed merchant product.
