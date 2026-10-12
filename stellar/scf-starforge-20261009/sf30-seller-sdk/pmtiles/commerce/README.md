# Sell and receive complete PMTiles outputs

This component publishes the exact bytes of an existing PMTiles map release as
an SF30 paid object, runs that seller through the original SF82 release store,
and purchases it through the original SF88 object engine. A merchant can sell
a selected map/style/resource or the complete source/runtime/workspace
operations ZIP. The customer can adopt a purchased resource into a map
workspace or reopen the complete purchased operations package.

Start from the [PMTiles operations guide](../README.md). The original map
workspace must have a published release and the selected resources must belong
to that release. Complete-package sales select an already completed
[portable operations package](../PORTABLE_HANDOVER.md) captured from that same
published release.

## Install and select

The existing PMTiles selection now includes the additive
`pmtiles-commerce` contribution:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/source-checkout --ref ACTUAL_COMMIT_SHA \
  --selection pmtiles-operations \
  --out /absolute/selected-merchant-source
~~~

Use the original source builder's returned archive and digest with the
maintained runtime installer. Select native, operator, schema, OpenAPI and MCP
dependencies as described in
[PMTILES_OPERATIONS.md](../../../distribution/selections/PMTILES_OPERATIONS.md).
Keep the actual READY installation's source manifest and dependency lock.

The contribution adds `starforge pmtiles-output` and the named exports
`./pmtiles/output`, `./pmtiles/output-package`,
`./pmtiles/output-buyer`, `./pmtiles/output-source` and
`./pmtiles/output-cli`. The ordinary merchant MCP provider also exposes the
complete workflow through its existing authenticated connection; see
[PMTILES_COMMERCE.md](../../../../../stellar-forge/mcp-merchant-operator/PMTILES_COMMERCE.md).

The paid seller uses the existing native facilitator and selected Stellar
asset/recipient. The customer uses its existing SF88 runtime, signer, policy
and original private operator configuration. Supply those actual selections
before purchasing.

## What the merchant retains

Preparation captures the original workspace ID, published release ID and
manifest, immutable edition version, native runtime identity, resource rights,
complete file byte count and SHA-256. A package sale also captures the original
portable request, package manifest, frozen workspace handover and archive hash.

The complete private output directory contains:

| File | Purpose |
| --- | --- |
| `request.json` | The exact selected release, original resources/package, prices and native payment terms |
| `selection.json` | Original release and file references captured before copying |
| `objects/SHA256` | The complete retained selected bytes |
| `source.json` | Exact source and bounded fixed-chunk hashes |
| `seller-service.json` | The original SF30 routes and native payment offers |
| `offers.json` | Those selected offers |
| `objects.json` | The original generic object descriptor consumed by SF88 |
| `catalog.json` | Public offer, complete-download price, rights and original product identity |
| `package.json` | Final complete-file manifest, published after the package is retained |

Share the exact `catalog.json` and its returned SHA-256 with the customer.
Each route includes its immutable snapshot:
`/maps/OFFER_ID/OBJECT_ID/SNAPSHOT_SHA256`. Preparing replacement bytes gives
them a different route. Reusing a request ID reopens the original selection.

Objects up to the selected chunk size are whole-object requests. Larger
objects use fixed byte chunks through `offset` and `length`; the last chunk
contains the remaining bytes. The default is 921,600 bytes, with a maximum of
1,048,576 bytes per request. Range headers, arbitrary query fields and
unaligned requests are rejected before paid handling.

A price is in atomic units **per whole object or per chunk**, according to
the catalog's `pricing.unit`. The catalog retains the exact request count
and `completeDownloadAtomic`. A customer must explicitly provide a total
budget covering that complete download. Preparation supports up to 64 selected
outputs, 32 GiB aggregate bytes and 131,072 total indexed chunks. It rejects a
smaller chunk size that exceeds this bound before copying or indexing.

## Native merchant command

All paths below are absolute. Private request/configuration JSON files are
owned `0600` files. Workspace, output and release-store directories are
separate private directories. Create a private connection:

~~~json
{
  "schema": "starforge.pmtiles-output-cli.v1",
  "workspaceDirectory": "/private/regional-maps",
  "expectedWorkspaceId": "ACTUAL_WORKSPACE_ID",
  "outputDirectory": "/private/regional-output",
  "releaseStore": "/private/regional-seller-releases",
  "runtimes": {
    "native": {
      "port": 4310,
      "facilitator": "https://ACTUAL_FACILITATOR_ORIGIN"
    }
  }
}
~~~

Use the actual existing facilitator. A local facilitator is selected through
the original SF82 `allowLocalFacilitator` option. The public HTTPS seller
origin must route to this selected seller listener, and the buyer's existing
transport/policy must allow that same origin.

Create the original preparation request:

~~~json
{
  "requestId": "regional-output-20261012",
  "expectedWorkspaceId": "ACTUAL_WORKSPACE_ID",
  "releaseId": "ACTUAL_PUBLISHED_MAP_RELEASE",
  "releaseManifestSha256": "ACTUAL_MAP_RELEASE_MANIFEST_SHA256",
  "offerId": "regional-map",
  "title": "Regional map operations",
  "origin": "https://ACTUAL_SELLER_ORIGIN",
  "payment": {
    "network": "stellar:testnet",
    "asset": "ACTUAL_SELECTED_ASSET",
    "payTo": "ACTUAL_SELECTED_RECIPIENT"
  },
  "chunkBytes": 921600,
  "objects": [
    {
      "id": "map",
      "resourceId": "ACTUAL_ARCHIVE_RESOURCE_ID",
      "amount": "50000",
      "filename": "region.pmtiles"
    },
    {
      "id": "operations",
      "package": {
        "requestId": "ACTUAL_COMPLETED_PACKAGE_REQUEST",
        "stagingDirectory": "/private/original-package-staging",
        "archiveSha256": "ACTUAL_ORIGINAL_ARCHIVE_SHA256"
      },
      "amount": "50000",
      "filename": "region-operations.zip"
    }
  ]
}
~~~

Replace the example prices with the reviewed atomic amount for each request.
For a production sale select its actual network, asset and recipient. The
native receiving example uses the original isolated testnet profile.

~~~sh
starforge pmtiles-output prepare \
  --connection /private/output-connection.json \
  --request /private/prepare-output.json
~~~

Retain the returned `requestId`, `manifestSha256`, `catalogSha256` and
complete public object/pricing descriptors. Read `package` or `catalog`
using `{"outputRequestId":"regional-output-20261012","manifestSha256":"ACTUAL_SHA256"}`.

Stage the exact package:

~~~json
{
  "requestId": "regional-output-stage-20261012",
  "outputRequestId": "regional-output-20261012",
  "manifestSha256": "ACTUAL_OUTPUT_PACKAGE_MANIFEST_SHA256",
  "releaseId": "regional-paid-20261012",
  "label": "Regional paid map release",
  "runtime": "native"
}
~~~

~~~sh
starforge pmtiles-output stage \
  --connection /private/output-connection.json \
  --request /private/stage-output.json
~~~

The result contains the original SF82 release and digest. `compare` takes
`beforeReleaseId` (null for the first release), `releaseId` and
`releaseDigest`. It compares the original routes, prices, runtime and
retained PMTiles source before activation.

Read `status` for the current original SF82 generation. Activate with a new
stable request:

~~~json
{
  "requestId": "regional-output-activate-20261012",
  "releaseId": "regional-paid-20261012",
  "releaseDigest": "ACTUAL_SF82_RELEASE_DIGEST",
  "expectedGeneration": 0,
  "reason": "Publish the selected complete map operations"
}
~~~

Run `activate` with that private request. A later activation uses the actual
current generation. The saved operation binds its original selection-history
event, allowing an interrupted response to reopen without applying the
selection again.

Start the native seller in the foreground:

~~~json
{
  "requestId": "regional-output-start-20261012",
  "releaseId": "regional-paid-20261012",
  "releaseDigest": "ACTUAL_SF82_RELEASE_DIGEST",
  "expectedGeneration": 1
}
~~~

~~~sh
starforge pmtiles-output serve \
  --connection /private/output-connection.json \
  --request /private/start-output.json
~~~

The original SF82 manager owns its child process and listener. Ctrl-C stops
admission and drains that owned seller. Release selection and customer
receipts remain saved. A browser/MCP session can use `output_start` and
`output_stop` instead, retaining the exact native instance ID.

`request` reads a lifecycle request's retained original result. A completed
start receipt describes the instance that originally started; use fresh
`status` to decide whether a seller is running and owned now. Replaying an
old completed start never starts a replacement process. After a deliberate
stop, use a new start request with the actual selected generation.

## Customer acquisition and complete receiving

Create a private customer connection:

~~~json
{
  "schema": "starforge.pmtiles-output-cli.v1",
  "buyer": {
    "runtimeDirectory": "/private/existing-sf88-runtime",
    "stateDirectory": "/private/existing-buyer-state",
    "operatorProfile": "/private/existing-operator-profile.json"
  },
  "purchasesDirectory": "/private/purchased-map-outputs"
}
~~~

Use the buyer's original configuration, including its signer/policy and
transport selections. For this purchase, its original `operation` must use
the catalog's exact HTTPS URL and native payment terms, GET, the request ID as
`intentId`, and `expect.maxAtomic` equal to the selected per-request amount.
The merchant MCP host alias derives these fields while preserving the
selected buyer's origin, recipient, asset, timeout and price ceiling.

~~~json
{
  "requestId": "customer-regional-operations-20261012",
  "catalog": "/private/received-catalog.json",
  "catalogSha256": "ACTUAL_CATALOG_FILE_SHA256",
  "objectId": "operations",
  "configuration": "/private/original-selected-purchase-config.json",
  "maxTotalAtomic": "ACTUAL_REVIEWED_COMPLETE_DOWNLOAD_BUDGET"
}
~~~

~~~sh
starforge pmtiles-output purchase-prepare \
  --connection /private/customer-connection.json \
  --request /private/purchase.json
~~~

Preparation retains the exact catalog, profiled configuration, generic object
descriptor, total budget and original SF88 object ID. Continue with
`purchase-run` and a private request containing
`{"purchaseRequestId":"customer-regional-operations-20261012"}`.
After an interrupted payment/receipt operation, use `purchase-recover` on
the same original request before continuing. `purchase-status` reads the
original native progress.

The original object engine retains every request and payment receipt, verifies
each selected chunk and assembles the complete expected SHA-256. Completed
replay reuses those original files and receipts. Receiving binds the stable
assembly identity; a later receipt-status reconciliation can update the
original report without changing the selected archive or creating another
customer receiving request.

For a complete operations ZIP, prepare:

~~~json
{
  "requestId": "receive-regional-operations-20261012",
  "purchaseRequestId": "customer-regional-operations-20261012",
  "directory": "/private/received-regional-product",
  "workspaceDirectory": "/private/received-regional-workspace",
  "pythonExecutable": "/usr/bin/python3"
}
~~~

Run `purchase-receive` using the customer connection. The original PMTiles
receiver verifies the complete source/runtime/workspace manifest and returns
the original serve command. It preserves current work in an already received
workspace when that same request is reopened. Keep the purchased archive,
original SF88 state and complete receiving directory together in the customer
handover.

For a purchased map/style/resource, add the target
`workspaceDirectory` and `expectedWorkspaceId` to the customer connection.
Call `purchase-adopt` with a new `requestId` and the original
`purchaseRequestId`. The existing PMTiles ObjectDelivery path retains its
original source rights, payment/assembly identity and complete file digest.
Use the ordinary map edition/review/publication workflow to select that
resource for a later release.

## Native receiving and source ownership

`exercisePMTilesOutputCommerce` in the repository-root merchant
`pmtiles-commerce-native-receiving.mjs` is a callable phase of the existing
complete PMTiles native operation. It consumes that operation's actual saved
producer, published release and native profile. The selected private commerce
input supplies the existing facilitator, original SF88 runtime/operator,
testnet payment terms and explicit total budgets.


Add this selected object as `outputCommerce` in the original
`starforge.pmtiles-native-receiving.v1` input before that operation retains
`original-input.json`:

~~~json
{
  "schema": "starforge.pmtiles-output-native-selection.v1",
  "origin": "https://ACTUAL_SELLER_ORIGIN",
  "payment": {
    "network": "stellar:testnet",
    "asset": "ACTUAL_SELECTED_ASSET",
    "payTo": "ACTUAL_SELECTED_RECIPIENT"
  },
  "runtime": {
    "port": 4310,
    "facilitator": "https://ACTUAL_EXISTING_FACILITATOR"
  },
  "buyer": {
    "runtimeDirectory": "/private/original-sf88-runtime",
    "stateDirectory": "/private/selected-pmtiles-buyer-state",
    "configuration": "/private/original-buyer-configuration.json",
    "configurationSha256": "ACTUAL_PRIVATE_CONFIGURATION_SHA256",
    "operatorProfile": "/private/original-operator-profile.json",
    "operatorProfileSha256": "ACTUAL_PRIVATE_OPERATOR_PROFILE_SHA256"
  },
  "mapAtomic": "ACTUAL_POSITIVE_ATOMIC_PRICE",
  "operationsAtomic": "ACTUAL_POSITIVE_ATOMIC_PRICE",
  "mapBudgetAtomic": "ACTUAL_REVIEWED_MAP_DOWNLOAD_BUDGET",
  "operationsBudgetAtomic": "ACTUAL_REVIEWED_PACKAGE_DOWNLOAD_BUDGET"
}
~~~

The operator profile and its hash are optional together when the original
buyer configuration already supplies the complete profile. Preserve the
selected existing signer environment and ownership directory. The phase
validates this selection before the whole input is frozen, retains private
configuration/profile copies, and verifies their original byte hashes. Its
catalog determines the actual request counts; both explicit budgets must
cover the complete selected downloads. The same operation records the native
payment and customer receiving results.

The phase creates the complete original operations package, publishes the
selected immutable output through SF82, purchases both the original map and
operations ZIP, receives the full customer product, and reopens the original
requests. It checks a cold merchant reopen against current runtime status and
the historical start receipt. The result retains the actual original object,
assembly, release and received-package identities.

The map operations ZIP continues to declare its original SCF map runtime and
workspace closure. The complete installed merchant carries the paid-output
and MCP/SF88 source and dependencies. The generic object descriptor change
preserves the existing S3 descriptor contract and uses the same original
native object engine.
