# Paid PMTiles outputs through merchant MCP

The existing PMTiles provider now exposes the complete paid-output lifecycle.
It uses the original map workspace, SF30 payment routes, SF82 release manager
and SF88 customer object/receipt engine. The host selects the original seller
runtime and buyer profiles; tool inputs select the actual saved resources,
prices, catalog and complete-download budget.

Read the [paid-output operating guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/commerce/README.md)
for native preparation, pricing, CLI and customer receiving. Read
[PMTILES_WORKSPACE.md](PMTILES_WORKSPACE.md) for the original connection,
workspace, map edition, package and authenticated MCP server setup.

## Add host selections to the original connection

Add `commerce` beneath an existing named workspace:

~~~json
{
  "commerce": {
    "runtimes": {
      "native": {
        "port": 4310,
        "facilitator": "https://ACTUAL_FACILITATOR_ORIGIN"
      }
    },
    "buyers": {
      "customer": {
        "stateDirectory": "/private/original-buyer-state",
        "runtimeDirectory": "/private/original-sf88-runtime",
        "configuration": "/private/original-buyer-configuration.json",
        "operatorProfile": "/private/original-operator-profile.json",
        "operatorWorkspace": "/private/original-funded-operator"
      }
    }
  }
}
~~~

Use the actual selected paths, existing facilitator and native recipient/asset.
Private configuration/profile files are owned `0600` JSON. Buyer state,
source workspace, runtime and merchant exports remain separate canonical
directories. The host's existing `receivingTargets` selects where complete
customer packages can be reopened.

The buyer configuration's original operation fixes the permitted HTTPS
origin, scheme, network, asset, recipient, timeout and maximum per-request
price. `purchase_prepare` retains the selected original profile and changes
only the operation's intent ID, exact catalog object URL and lower selected
price cap. Its native signer, operator policy and transport remain the
original configured selections.

The existing merchant configuration supplies its original `releaseStore`.
Connections without commerce keep the ordinary map workflow.

## Prepare a sale

Use `starforge pmtiles-mcp call TOOL_SUFFIX --url ORIGINAL_MCP_URL --request
/PRIVATE/request.json` with the existing bearer token environment. All full
tool names start with `merchant_pmtiles_`.

`output_prepare` accepts the original release and one or more output rows:

~~~json
{
  "workspace": "regional",
  "requestId": "regional-map-output-20261012",
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
      "resourceId": "ACTUAL_MAP_RESOURCE_ID",
      "amount": "50000"
    },
    {
      "id": "operations",
      "packageRequestId": "ACTUAL_COMPLETED_MERCHANT_PACKAGE_REQUEST",
      "archiveSha256": "ACTUAL_COMPLETE_PACKAGE_ARCHIVE_SHA256",
      "amount": "50000"
    }
  ]
}
~~~

A resource row selects an original resource in the current published release.
A package row selects the provider's original completed `package` request
and exact archive. The provider resolves that retained package through its
existing private export path. A row selects exactly one source.

The returned catalog explains whether the amount is per whole object or per
fixed chunk, the exact request count and complete-download total. Select the
real reviewed atomic prices. The default chunk is 921,600 bytes; preparation
rejects more than 131,072 aggregate chunks before copying/indexing.

`output_package` and `output_catalog` take `outputRequestId` and
`manifestSha256`. The catalog returns its exact file hash and the original
generic object descriptor/hash. Each paid URL embeds the immutable snapshot.

## Run the original seller

| Tool suffix | Additional fields after `workspace` | Result |
| --- | --- | --- |
| `output_status` | none | Current original selection/generation, native runtime and available host aliases |
| `output_request` | `requestId` | The retained exact lifecycle request and its first completed result |
| `output_stage` | `requestId, outputRequestId, manifestSha256, releaseId, runtime`; optional `label` | Original SF82 immutable release and digest |
| `output_release` | `releaseId, releaseDigest` | Verified original release, payment and source binding |
| `output_compare` | `beforeReleaseId, releaseId, releaseDigest` | Original route/payment/runtime/source comparison; initial predecessor is null |
| `output_activate` | `requestId, releaseId, releaseDigest, expectedGeneration, reason` | Original generation-checked selection and history event |
| `output_start` | `requestId, releaseId, releaseDigest, expectedGeneration` | Original native instance; explicit current-process ownership |
| `output_stop` | `requestId, releaseId, releaseDigest, instanceId` | Drain of this operator's exact owned seller |

Use fresh `output_status` for current control availability. An old completed
start receipt records its historical instance and original RUNNING state.
Reading or replaying that request does not create another process. After a
deliberate stop, start the selected release with a new request ID and its
actual current generation.

The original provider serializes accepted calls for each workspace. Closing
the workspace or MCP server first stops admission, drains its accepted
commerce work, closes the owned SF82 seller, then closes the original map
controller/browser and retained files. A different live seller manager is
observed without acquiring ownership.

## Purchase and deliver the complete product

`purchase_prepare` selects the configured buyer, exact product and total
budget:

~~~json
{
  "workspace": "regional",
  "requestId": "customer-map-operations-20261012",
  "buyer": "customer",
  "outputRequestId": "regional-map-output-20261012",
  "manifestSha256": "ACTUAL_OUTPUT_PACKAGE_MANIFEST_SHA256",
  "objectId": "operations",
  "maxTotalAtomic": "ACTUAL_REVIEWED_COMPLETE_DOWNLOAD_BUDGET"
}
~~~

For another merchant's sale, supply its complete `catalog` object and exact
`catalogSha256` instead of the local output request/manifest. The original
host payment boundary still applies.

`purchase_status`, `purchase_run` and `purchase_recover` take
`workspace, buyer, purchaseRequestId`. They use the same original SF88 object
session, fixed chunk plan and receipt store. Reopen the retained purchase
after interruption, recover its original uncertain payment/receipt operation,
then continue that exact object. The complete file must match the selected
snapshot, byte count and SHA-256.

### Original accounting continuation

`purchase_accounting` and `purchase_finalize` take the same `workspace`,
`buyer` and `purchaseRequestId`, with optional `offset` and `limit`. The
configured buyer's `operatorWorkspace` supplies the original financial
workspace. Both return the unchanged native response under `accounting`;
follow `accounting.native.range.nextOffset` for the complete original
session. The default range is 0/100 and the maximum limit is 250.

`purchase_accounting_recover` takes those same three selectors and optional
`commandId`. It reads the original retained command after a lost response,
including the last complete response if a later command was interrupted.
The native finalizer preserves its existing idempotent outcomes and original
reservation/payment identities. See the full
[accounting and native environment guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/commerce/NATIVE_ENVIRONMENT.md).

`purchase_adopt` adds `requestId` and imports the completed original
ObjectDelivery into this map workspace, preserving rights and source identity.

`purchase_receive` adds `requestId` and a configured `target` alias.
It passes the complete purchased ZIP to the original PMTiles portable
receiver under that target. The response includes the actual received
workspace, source/runtime identity and original serve command. Repeating the
same request reopens the retained customer result and preserves later edits
in that receiving workspace.

## Complete original native phase

The optional `outputCommerce.nativeEnvironment` selector retains the complete
private environment descriptor and its SHA256 before the original input is
frozen. It starts the maintained facilitator and original HTTPS transport,
passes the original operator custody to native buyer children, then drains
them after seller/MCP completion. Its descriptor also selects the original
accounting workspace. Existing services can instead supply
`outputCommerce.buyer.operatorWorkspace` directly.


The callable `exercisePMTilesOutputCommerce` receives the same actual
producer and native runtime after the original browser/MCP/Applications
owners have drained. Its complete private selection is frozen before paid
work. It runs the original facilitator and SF88 purchase path through these
tools, then reopens the customer package and the historical/current seller
states. Its artifact records the original payment/object/assembly identities,
complete retained bytes and exact customer receiving receipt.

The full source belongs in the complete selected merchant installation. The
map operations ZIP retains its declared original map runtime/source/workspace
closure; install the merchant selection when the receiver also needs paid
seller or MCP operation.
