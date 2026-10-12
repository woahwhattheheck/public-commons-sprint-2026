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

## Transfer, download and reopen

merchant_odata_transfer with action:"create" and a stable transferId saves the complete original bundle. Pause active imports first. The bundle includes source bytes, catalogs, plans, editions, reviews, dataset exports, live packages, buyer handoffs and committed customer receiving files.

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
| transfer | Saved transfer id. |
| comparison | Returned comparisonId as id. |

The first chunk returns readId, file SHA-256, complete byte length, offset, base64 bytes and nextOffset. Continue with the same readId, expectedSha256 and returned offset. The shared reader loads the original file once and releases its retained bytes at EOF. Maximum chunk size is 196,608 bytes. An expired read resumes with the same original hash and byte offset. merchant_odata_file_release releases an unfinished read.

## Shared browser and lifecycle

merchant_odata_browser opens the industrial interface over the same original workspace and live operations object. Its source, query, edition, merchant and customer views reflect the agent's saved work. Closing the borrowed browser keeps the MCP-owned workspace and live services available.

merchant_odata_close takes the workspace's instanceId, drains accepted operations, pauses owned imports and closes its original merchants and browser. merchant_odata_open selects a new process instance over those same saved records.

## Original reference source

The OData product retains the public Northwind service document, CSDL and five provider pages for 830 Orders. The original source operator completed two editions, reviewed/compared them, queried the typed dataset and restored the complete package. The selected live-source operation also retains its merchant restart after page one, unchanged continuation and all 830 received rows. This MCP arm consumes those same source and customer records.

Source pins and current installed receiving adoption remain in the [original OData product thread](https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791764617053699).
