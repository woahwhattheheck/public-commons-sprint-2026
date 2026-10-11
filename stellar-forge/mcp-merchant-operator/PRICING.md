# Merchant pricing through the original MCP operator

The `merchant_pricing_*` tools use the same SF97 workspace as the browser and
CLI. An agent can review native seller observations, save a commercial pricing
analysis, change selected atomic payment amounts, retain the resulting seller
files, and stage the original API merchant package in its existing SF82 store.

## Host connection

Create a private connection JSON (mode 0600). Each alias names an existing
private workspace directory (mode 0700), its original seller configuration, and
either saved native observations or the original loopback operations listener.
Paths resolve beside this connection file.

```json
{
  "schema": "stellar-forge.pricing-workspace-connection.v1",
  "workspaces": {
    "dataset": {
      "label": "Dataset pricing",
      "directory": "./pricing",
      "config": "./api-package/compiled/seller-service.json",
      "snapshot": "./traffic.json",
      "sourcePackage": "./api-package",
      "releaseStore": "./releases",
      "releaseRuntime": { "port": 8423 }
    }
  }
}
```

Use `history` for an original retained history export. A connection can supply
both `snapshot` and `history`. For current observations, replace those file
selections with `opsUrl`, such as `http://127.0.0.1:8424/api/snapshot`; the
original model also exposes its retained UTC history selection.
`nativeOutbox` attaches the merchant's original native settlement outbox to
saved reconciliation reports.

`sourcePackage` selects the original saved SF61 API merchant package used to
compile this seller. `releaseStore` selects an existing SF82 store for staging.
`releaseRuntime` accepts an object or a private host JSON path and uses the
original port/facilitator/loopback options. The package retains its backend
bindings and environment-variable names. The host supplies existing credential
values through its environment.

Attach the connection to an existing host by adding
`"pricingConnection": "/private/pricing-connection.json"` to its
`merchant-mcp.json`, then restart that MCP process. Ordinary merchant
initialization accepts `--pricing` and an optional existing `--release-store`.
For a pricing host around the existing saved work:

```sh
merchant-mcp init-pricing \
  --dir /private/pricing-mcp \
  --pricing /private/pricing-connection.json
```

When all staged aliases use the same store, initialization selects that exact
store for the ordinary merchant release tools. With multiple stores or no
staging store, add `--release-store /private/existing-release-store`.
Each alias reports `operatorReleaseStore`; ordinary `merchant_inspect`,
`merchant_compare`, `merchant_activate` and lifecycle tools operate on the
MCP host's selected store. Other aliases retain their own explicit staging
store and can be operated by a host configured for that store.

Use the existing authenticated HTTP or stdio connection described in
[STDIO.md](STDIO.md). Workspace aliases are the only remote source selectors.
The original per-write revision checks allow the browser and MCP to share the
same saved workspace.

## Review observations and commercial inputs

1. Call `merchant_pricing_status` to discover the declared aliases, then
   `merchant_pricing_open` with `workspace`.
2. The reply includes the current pricing `revision`, seller SHA-256,
   observation SHA-256, merchant-wide commercial inputs, and the first route
   page. Each route includes complete payment options and its existing
   `commercial` values.
3. Call `merchant_pricing_source` with the returned `captureSha256` and
   `offset` to page that same source. Choose `view` of `routes`,
   `reviews`, `decisions`, `days`, `sessions` or `observations`.
   Omitting `captureSha256` captures current observations. A new live
   `selection` uses `kind: "SESSION"` or `"DURABLE_HISTORY"` and, for
   retained history, optional original `from`, `to` and `routeId` filters.
4. Build `commercial` using `merchantName`, `sharedMonthlyFixedUsd` and
   `routes` keyed by every seller route ID. Each route supplies
   `unitPriceUsd`, `priceBasis`, `perFulfilledUsd`, `perChallengeUsd`
   and `monthlyPaidTarget`. Enter USD values as decimal strings with at
   most six fractional places; unknown costs remain `null`.
5. Call `merchant_pricing_preview` with that commercial object,
   `sellerSha256` and `snapshotSha256`. Original route economics are
   paged; other views include `issues`, `historyDays`,
   `historySessions`, `historyRoutes`, `periodDays` and
   `periodVariants`.
6. Save those same analysis inputs with `merchant_pricing_save`, adding
   a stable UUID `requestId`, a `label`, and the current
   `expectedRevision` (initially `null`). Its returned `version`
   identifies the saved original report, seller, terms and observations.

`merchant_pricing_load` loads the commercial inputs from a saved `version`.
`merchant_pricing_compare` compares exact `leftVersion` and
`rightVersion`, including seller, commercial, observation and range
compatibility. The original report retains how merchant-entered valuations and
native observations contribute to each calculation.

## Save exact seller price changes

Call `merchant_pricing_repricing_source` with the saved pricing `version`.
It returns the original complete ordered payment choices, `sellerSha256`,
current `repricingRevision` and source/release availability.

Select each change explicitly. For example:

```json
{
  "routeId": "dataset",
  "paymentIndex": 0,
  "expectedAmount": "20000",
  "amount": "25000"
}
```

Call `merchant_pricing_repricing_preview` with `workspace`, `version`,
`sellerSha256` and the `edits` array. It validates the original and proposed
seller through the original compiler and returns exact per-option changes plus
`reviewSha256`. Payment order, asset, recipient, network, timeout, metadata,
route contracts and application bindings remain attached to their original
choices. Atomic amounts are explicitly entered decimal integers.

Call `merchant_pricing_repricing_save` with those same inputs, its exact
`reviewSha256`, a new UUID `requestId`, a `label`, and
`expectedRevision` set to the **price-decision** `repricingRevision`.
The saved result has a stable `decision` ID. Its files include the original
seller/terms/report, the reviewed decision, the repriced seller and terms, and
a launch configuration with original host-relative paths resolved.

For configured API source packages, the original compiler also saves
`source-package/`, `source-manifest.json` and `source-plan.json`.
Call `merchant_pricing_repricing_stage` with this saved `decision` and
`reviewSha256`. It returns the original retained release ID and digest.
On the selected operator store, use `merchant_inspect`,
`merchant_compare` and the current generation to activate the release;
explicit original start/restart controls apply it to a running seller.

## Retained files and interrupted operations

Both save tools recover equal retries by their original `requestId`. Keep the
whole input unchanged, including its original revision. If another edit won the
revision, reload the saved source and review the intended change before saving
with a new request. Repricing save rechecks the seller and original package
against the displayed review; staging recovers its same stable release ID.

`merchant_pricing_manifest` accepts `kind: "review"` with a saved version
`id`, or `kind: "decision"` with a saved decision `id`. Retain its
`manifestFile.sha256` and the selected file entry from `manifest.files`.
Use `merchant_pricing_file` with those selectors, `file`,
`expectedManifestSha256`, and optionally the expected file SHA-256.
Chunks return `readId`, file metadata, base64 bytes and `nextOffset`.

Continue with all original selectors, `readId`, `expectedSha256` and
`offset: nextOffset`. A `null` next offset completes the file.
Chunks are at most 196608 bytes. After expiry or process restart, omit
`readId` and resume at the saved offset with the same expected SHA-256.
Verify the assembled file's full byte count and SHA-256 against the manifest.
`manifest.json` itself is also readable. Every source-package file uses
this same retained-file path.

`merchant_pricing_file_release` releases an unfinished temporary snapshot.
`merchant_pricing_close` drains accepted work, releases temporary readers,
and closes this process's capture view. Reopening loads the original saved
reviews and decisions.
