# Release an existing S3 file product

The original S3 seller's configured object package can now use the same release
store, comparison, activation, restart, rollback, browser console and MCP tools
as an API, Python or DuckDB merchant. Each version retains its selected object
identity and complete public payment terms. A release remains usable after the
initial configuration directory moves or is removed.

## Prepare the selected products

Start with the original [S3 source](../sf30-seller-sdk/s3/README.md) and its
existing `configure` command. The command selects each approved object with the
official SDK and writes `source.json`, `service.json` and `objects.json` beside
the original generated handler. Keep the source configuration private and use
the existing AWS environment or configured provider chain.

From a source checkout:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/s3/cli.mjs configure \
  --source /private/products/source.json \
  --payment /private/products/payment.json \
  --origin https://downloads.your-merchant.example \
  --directory /private/packages/products-v1
```

Use the merchant's actual object selection, origin, recipient, asset and atomic
price in those existing input files. The S3 source supports whole files and
fixed-size paid chunks; all original limits and admission rules apply.

The release adapter reads the three JSON files. It verifies the original source
schema, ETags, exact sizes, optional version IDs, public object fingerprints,
route bindings, query contract and payment offers. Staging reads local files.
S3 access happens through the original source when the seller starts and when
an approved object or chunk is retrieved.

## Stage, compare and run

Initialize a new store once, then stage the configured directory:

```sh
starforge releases init --store /private/product-releases
starforge releases stage --store /private/product-releases --id v1 \
  --s3-package /private/packages/products-v1 --port 8423
starforge releases diff --store /private/product-releases --to v1
starforge releases activate --store /private/product-releases --id v1 \
  --expect 0 --reason "Initial reviewed products"
starforge releases run --store /private/product-releases --expect 1
```

For a checkout, replace `starforge releases` with
`node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs`.
The initial generations above are for a newly created store. Subsequent changes
use the generation reported by `status` or `diff`.

Add `--facilitator` with the existing facilitator URL while staging to run the
original native x402 payment path. The operator host needs the original S3 SDK
and native x402 dependencies; their versions and setup remain in the source
guides. The selected AWS provider is resolved on that host at startup. Its
credential values are never written into a release.

The release contains a private `s3/` directory with the original JSON bytes and
the shared release system's manifest, offers, service and operating record.
The runtime builds its handler bindings through the installed original S3
factory. Generated handler modules from the initial package are not imported
or copied. Package relocation therefore does not depend on the initial
checkout's absolute module path. The source configuration still intentionally
identifies the same object store and selected objects; copying a release is
not a transfer of object-store access.

## Change a product and restore a previous version

Run the original configure command into another new package for changed objects
or terms. Stage that package with a new release ID, compare it and select the
reviewed version. Selection does not interrupt the running seller. The same
console or owning MCP session performs the explicit restart and drain.

```sh
starforge releases stage --store /private/product-releases --id v2 \
  --s3-package /private/packages/products-v2 --port 8423
starforge releases console --store /private/product-releases --port 8425
```

Open the printed private operator URL. The release list labels S3 products and
provides the correct staging command. Comparisons include the exact public
object rows, byte counts, whole/chunk contracts, source selection digest and
atomic payment changes. Use **Activate**, **Start**, **Restart**, **Stop** and
**Roll back** through the existing console.

A versioned object can still be retrieved at its retained version ID after a
new current version appears. An unversioned object's replacement cannot be
recovered merely by restoring a release: its original ETag and byte count must
still match. In that case the original source returns the object-change error;
prepare a new product version or restore the object through its own storage
operations. Changing a staged JSON file likewise requires a new release.

## Use the existing merchant MCP provider

Initialize the same merchant provider with the configured source:

```sh
starforge merchant-mcp init --dir /private/s3-merchant-operator \
  --s3-package /private/packages/products-v1 \
  --name "Private file products" --seller-port 0
```

The original host configuration registers an `initial` source alias:

```json
{
  "label": "Reviewed file products",
  "s3Package": "/private/packages/products-v1",
  "runtime": { "port": 0 }
}
```

Continue with the existing authenticated provider and tools:

1. `merchant_sources` inspects the named source and public product contracts.
2. `merchant_stage` retains it under a new release ID.
3. `merchant_compare` returns the exact changes and current generation.
4. `merchant_activate` selects the inspected digest and generation.
5. `merchant_start` starts that selection; `merchant_catalog` and
   `merchant_client_export` expose the original public customer interface.
6. `merchant_restart`, `merchant_stop` and `merchant_rollback` retain the
   original instance ownership and change history.

MCP responses contain public aliases, selected fingerprints, sizes and hashes.
Bucket names, object keys, endpoint locations and package paths stay in the
private host source. The tools take a configured alias, not a source path or a
different payment choice supplied by an agent. The original merchant/fleet,
discovery and accounting tools remain part of the same provider.

## Continue the original buyer download

The retained public descriptor is at
`/private/product-releases/releases/v1/s3/objects.json`. It uses the unchanged
`stellar-forge.s3-description.v1` schema and can be shared with the customer.
Feed it to the original [object acquisition workflow](../sf88-operator-buyer-cli/OBJECTS.md)
and its saved browser workspace. The original buyer prepares each URL-bound
chunk, retains completed bytes, resumes remaining chunks and verifies the
assembled file. The ordinary merchant client export is also available for
customers integrating the original endpoint directly.

Application APIs are exported from `release-s3.mjs`: `prepareS3Release`,
`stageS3Release`, `inspectS3Release` and `startS3Release`. The normal store API is
`stageRelease(root, { id, s3Package, runtime })`. The standard release child
calls `launch`; existing supervisors keep their original ownership and shutdown
behavior. `describePinnedS3Config` in the original S3 source provides the same
object description without starting a client, for local retained-source review.
