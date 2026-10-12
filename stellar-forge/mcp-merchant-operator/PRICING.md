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

## Compare and apply saved commercial scenarios

The same pricing aliases expose the original saved scenario workspace. Open the
existing alias, then choose a saved pricing review from
**merchant_pricing_source** with **view: "reviews"**. The scenario source is that
immutable review's seller, original observations and commercial terms. Later
live captures do not rewrite it.

| Operation | Required selectors | Result |
| --- | --- | --- |
| merchant_pricing_planning_source | workspace, version | Original selected routes, commercial inputs and source provenance |
| merchant_pricing_planning_preview | workspace, version, scenarios | Original-analyzer comparison and reviewSha256 |
| merchant_pricing_planning_save | Same inputs, requestId, label, reviewSha256 | Durable planId; optional explicit selectedScenarioId |
| merchant_pricing_planning_list | workspace | Paged summaries from the original newest-100 listing |
| merchant_pricing_planning_load | workspace, planId | The exact retained comparison, including after restart |
| merchant_pricing_planning_selection | workspace, planId, scenarioId | Complete commercial draft, paged by route |
| merchant_pricing_planning_apply | Selected plan/scenario and review hash; current seller/snapshot hashes; original save ID, label and revision | A new original pricing review with the selected commercial terms |

A comparison accepts at most twelve named scenarios. IDs use 1–64 letters,
digits, underscores or hyphens, beginning with a letter or digit; **baseline**
is reserved. Labels have at most 120 characters. Each scenario contains sparse
route changes, an optional shared fixed cost, and optional goals:

~~~json
{
  "id": "growth",
  "label": "Supplier cost and volume plan",
  "sharedMonthlyFixedUsd": "12",
  "routes": {
    "forecast": {
      "monthlyPaidTarget": 9000,
      "unitPriceUsd": "0.02825",
      "perFulfilledUsd": "0.002"
    }
  },
  "goal": {
    "monthlyContributionUsd": "100",
    "marginPct": "70"
  }
}
~~~

Use the actual route ID from the selected source. Only routes included in that
saved review's scope accept patches. Available route fields are unitPriceUsd,
priceBasis, monthlyPaidTarget, perFulfilledUsd and perChallengeUsd. USD values
use exact decimal strings with up to six fractional places. Unknown costs
remain null; monthly paid targets are nonnegative safe integers. A changed quote
gets an explicit planning-assumption basis unless a source basis is supplied.
Target margin is a decimal percentage from zero to less than 100, with at most
four fractional places.

The original analyzer evaluates all scenarios. Whole-seller goals use
contribution after shared fixed cost. Price suggestions calculate the smallest
common micro-USD uplift at the selected targets; volume suggestions calculate
whole baskets preserving the selected route mix. Each ready suggestion contains
original-analyzer results. Unknown costs or a route-filtered review carry the
native explanation and required inputs.

### Page a comparison and its suggestions

Preview and load use **view: "scenarios"** by default. Every reply includes compact
baseline and selected-scenario totals; route arrays, terms and observation
payloads are read through explicit pages or complete files.

- **view: "routes"**, with scenarioId, returns route economics, complete commercial
  inputs and original ordered payment terms.
- **view: "goals"** returns that scenario's break-even and target suggestions.
- **view: "suggestionRoutes"**, with scenarioId and an exact suggestionKind,
  returns a ready suggestion's complete route inputs. Kinds are BREAK_EVEN_PRICE,
  BREAK_EVEN_VOLUME, TARGET_PRICE and TARGET_VOLUME.
- Use offset and limit (1–200), continuing at page.nextOffset. Omit the scenario
  selector to inspect baseline.

To adopt a suggestion, explicitly construct a scenario from its returned
commercial route inputs and preview that chosen scenario before saving.
Planning save retains the complete comparison even though its MCP response is
paged. Full plan.json includes all original explicit inputs, metrics, goals and
calculated terms. Older comparisons outside the newest-100 listing remain
available through their saved planId.

### Apply a selected saved plan

Capture current observations through **merchant_pricing_source** and retain its
current seller.sha256, snapshot.sha256 and pricing revision. Read the saved plan
and choose its exact scenario ID. Call **merchant_pricing_planning_apply** with:

~~~json
{
  "workspace": "dataset",
  "planId": "<retained-plan-uuid>",
  "scenarioId": "growth",
  "reviewSha256": "<saved-comparison-sha256>",
  "sellerSha256": "<current-seller-sha256>",
  "snapshotSha256": "<current-capture-sha256>",
  "requestId": "<stable-new-review-uuid>",
  "expectedRevision": "<current-pricing-revision-or-null>",
  "label": "Selected commercial plan"
}
~~~

Replace each placeholder with the inspected value, using JSON null for an absent
revision. Application delegates to the original pricing save, which validates
the current seller, captured observations and revision, and recovers an equal
retry by the same request UUID. Preserve the entire input after an interrupted
reply. Its returned version is the new pricing review and can feed the existing
exact-atomic repricing/source-release workflow below.

### Complete scenario exports

Use **merchant_pricing_manifest** with:

~~~json
{"workspace":"dataset","kind":"scenario","id":"<planId>"}
~~~

The immutable file set consists of plan.json, comparison.csv and
terms-<scenarioId>.json for each alternative. The original
merchant_pricing_file and merchant_pricing_file_release operations read and
release SHA-pinned chunks. Retain manifestFile.sha256 as expectedManifestSha256
and each selected file's digest across interruption or process restart. The CSV
preserves unknown values as empty cells and neutralizes formula-leading labels.

## Pricing CLI over the same MCP connection

The maintained **merchant-mcp** executable exposes **pricing**. It uses the
existing HTTPS or loopback MCP endpoint and bearer token environment variable.
Original workspace aliases, request IDs and private files are shared with the
browser and other MCP clients.

~~~sh
merchant-mcp pricing status --url "$MCP_URL"
merchant-mcp pricing capture --url "$MCP_URL" --workspace dataset
merchant-mcp pricing source --url "$MCP_URL" --workspace dataset --version "$SAVED_REVIEW"
merchant-mcp pricing preview --url "$MCP_URL" --input /private/scenario-preview.json
merchant-mcp pricing save --url "$MCP_URL" --input /private/scenario-save.json
merchant-mcp pricing load --url "$MCP_URL" --workspace dataset --plan-id "$PLAN_ID"
merchant-mcp pricing capture --url "$MCP_URL" --workspace dataset
merchant-mcp pricing apply --url "$MCP_URL" --input /private/scenario-apply.json
merchant-mcp pricing manifest --url "$MCP_URL" --workspace dataset --plan-id "$PLAN_ID"
merchant-mcp pricing download --url "$MCP_URL" --workspace dataset --plan-id "$PLAN_ID" \
  --manifest-sha256 "$MANIFEST_SHA256" --out /private/scenario-export
~~~

Private input files contain the exact MCP argument object and use mode 0600.
Writes keep caller-provided request IDs; repeating a command reads the same
input. A changed flag cannot silently override an existing input field.
Read operations accept the same page selectors. **review-preview**,
**review-save** and **review-load** expose the original pricing operations.
**open** and **close** explicitly manage the shared capture handle; ordinary
operations open the declared alias as needed and reuse its capture.

The download command uses the original retained downloader's private directory,
lease, manifest identity and checkpointed chunk offsets. Run the same command
and output directory after interruption. Completed bytes are verified and
retained. --chunk-bytes accepts 1–196608, and --token-env selects an existing token
environment variable. Standard output is structured JSON; download progress and
failures use standard error.

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

Pricing reviews, commercial plans and exact-price saves recover equal retries by
their original `requestId`. Keep the whole input unchanged, including the
original revision when that operation requires it. If another edit won the
revision, reload the saved source and review the intended change before saving
with a new request. Repricing save rechecks the seller and original package
against the displayed review; staging recovers its same stable release ID.

`merchant_pricing_manifest` accepts `kind: "review"` with a saved version
`id`, `kind: "decision"` with a saved decision `id`, or `kind: "scenario"`
with a saved plan `id`. Retain its
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
reviews, decisions and scenario plans.
