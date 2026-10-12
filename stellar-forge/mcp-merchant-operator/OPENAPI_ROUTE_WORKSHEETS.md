# API route worksheets in the merchant agent

The merchant agent and browser share the original source-bound route worksheet.
Use it to select and price routes across an entire API, reconcile ongoing work,
and publish the resulting merchant through the existing SF61 package and SF82
release operations. The five worksheet tools join the existing 31 OpenAPI tools.

## Start from the existing merchant

The host uses its existing `openapiWorkspaces` configuration and private console
connection. The browser, HAR operator and agent continue to use that console.

For a saved merchant, select `workspace` and `baseName`. The original reader
opens its complete source and merchant plan and checks their retained file
identities. For a new merchant, choose exactly one `specText` or `specFile`
and exactly one `plan` or `planFile`. These are the original complete native
source and merchant-plan representations.

The inventory can describe 2,000 operations. The original compiler accepts
1–64 selected routes. Price values are decimal strings throughout the worksheet,
MCP requests, merchant plan and compiled payment terms.

```json
{
  "workspace": "merchant",
  "baseName": "current-api",
  "filter": {"method": "GET", "inclusion": "included"},
  "limit": 100
}
```

Call `merchant_openapi_routes` with these arguments. Continue its
`inventory.nextOffset` until null. Pages contain the original operation identity,
current selection and price, proposed selection and price, source support status,
and the complete current authored operation record when one exists. Filters and
action match counts apply across every page.

The returned `context.sourceSha256` identifies the complete source bytes.
`context.planSha256` is the SHA256 of the complete current plan in canonical
key order; it is a review identity, distinct from the original package's
formatted plan-file digest. Supply these as `expectedSourceSha256` and
`expectedPlanSha256` to keep subsequent steps on that reviewed context.

## Stage exact bulk prices and inclusion

Each action declares its complete filter and changes selection, price, or both.
Actions apply in order to the staged worksheet. A supported match is counted
once, whether or not its row is on the displayed page.

```json
{
  "workspace": "merchant",
  "baseName": "current-api",
  "actions": [
    {
      "filter": {"method": "GET", "inclusion": "included"},
      "price": {"kind": "percent", "value": "12.50", "rounding": "up"}
    }
  ],
  "filter": {"changed": true}
}
```

Use `merchant_openapi_routes` to inspect this complete change and page the
changed rows. A fixed price uses
`{"kind":"fixed","value":"25000"}`. To include or exclude matched routes, add
`"selected":true` or `"selected":false`.

Filters support case-insensitive source search, exact HTTP method, inclusion,
priced/unpriced rows, changed rows and supported operations. An empty filter
explicitly selects all supported operations for an action. An action matching
no supported operations returns a useful error.

Percentage calculations use the shared worksheet's BigInt arithmetic.
`up`, `down` and `nearest` choose the atomic-unit rounding; nearest rounds an
exact half upward. A price of `9007199254740993` increased by `12.50` percent
and rounded upward becomes `10133099161583618`. Unpriced routes need a fixed
price first. The native compiler remains responsible for the asset and integer
limits of the complete resulting offer.

Worksheet edits carry only inclusion and atomic price. The original complete
route records preserve IDs, ordering, upstream server choices, authentication
and environment references, request examples, response contracts, transports,
query handling, streams, durable operations, availability and cache policy.

Newly selected routes need their complete authored native records in
`operationPlans` or a host-declared `operationPlansFile` of kind `plan`.
Configure those records through the original authoring controls first.
The worksheet merges the supplied records and sends the complete candidate to
the original compiler.

## Review and save the whole merchant

1. Call `merchant_openapi_route_sheet_review` with the same original context,
   imported worksheet and ordered actions. Include new route records if needed.
2. Inspect the native compiled routes and all changes. Continue
   `changes.nextOffset` for a long review, or inspect the staged inventory with
   `filter.changed:true`.
3. Call `merchant_openapi_route_sheet_save` with the same arguments, a new
   `name` and the returned `review.sha256` as `expectedReviewSha256`.
4. Reopen using the existing `merchant_openapi_load` and
   `merchant_openapi_package_inspect`.

The review binds the complete original source, current plan, candidate plan,
worksheet, native compiler preview and any original HAR capture binding.
Changing any reviewed setting requires a new review. The save recompiles through
the authenticated console and uses its original atomic publisher. Repeating
the same name and reviewed content returns the same completed package.

A saved package is immutable. A price change creates another package; it does
not replace an earlier release. Source contract revisions remain in the
original revision desk, where their route mappings and settings retain the
original source lineage. Commercial scenario figures remain in the original
Pricing workspace; these tools operate on explicitly authored atomic prices.

### HAR sources

The agent asks the original HAR console to locate the exact source before
reviewing it. An explicit original `capturedSource` may also be supplied.
The same binding travels into the authenticated preview and original save;
the HAR console checks its retained review and selected operation contract.
When the approved operation set must change, use the original HAR review first,
then price the resulting source.

## Save and move a complete worksheet

`merchant_openapi_route_sheet_file` emits the same UTF-8 JSON imported by the
browser's **Import a source-bound worksheet** control. Its `file` describes the
complete source-bound worksheet, byte count and SHA256. Continue with the same
context and edits, the original `expectedWorksheetSha256`, and `nextOffset`
until `complete:true`. The maximum chunk is 196,608 bytes.

Every chunk rereads the selected original context and reproduces the same
worksheet. A changed source, plan or imported file cannot silently become the
next chunk of an earlier download. The client checks every offset, the complete
file hash, schema, source, currency and canonical worksheet bytes.

Use the installed client:

```js
import { downloadOpenApiRouteWorksheet } from
  '@tokenjunkielabs/starforge-merchant/merchant/openapi-route-worksheet';

await downloadOpenApiRouteWorksheet({
  url: process.env.MERCHANT_MCP_URL,
  tokenEnv: 'MCP_ACCESS_TOKEN',
  workspace: 'merchant',
  request: {
    baseName: 'current-api',
    actions: [{
      filter: {method: 'GET', inclusion: 'included'},
      price: {kind: 'percent', value: '12.50', rounding: 'up'}
    }]
  },
  path: '/private/delivery/api-route-worksheet.json'
});
```

The client publishes a complete private file after verification. An exact retry
reopens the same bytes. A different existing destination is preserved and the
client asks for a new filename. Interrupted chunk reads can be run again with
the same request and expected worksheet hash.

For agent import, declare that complete file in the existing host configuration:

```json
{
  "worksheet": {
    "path": "/private/delivery/api-route-worksheet.json",
    "kind": "packet",
    "sha256": "THE_COMPLETE_FILE_SHA256"
  }
}
```

Place this entry under the selected workspace's existing `files` object, then
pass `"worksheetFile":"worksheet"`. Files can contain the complete 4 MiB
worksheet. Source and plan file handles use their existing kinds. Small
worksheets up to 32 KiB are also returned as `inlineWorksheet`.

The merchant HTTP request size remains the original host's configured size.
Use declared file handles for large source, plan, worksheet and authored-record
inputs. The JSON chunk transfer carries every worksheet row without increasing
the shared listener's request size.

## Reconcile saved work with the current plan

Keep the original base worksheet together with the proposed worksheet before
continuing other authoring work. Export the unedited context to keep that base,
then export or import the staged worksheet.

To resume, call `merchant_openapi_route_sheet_reconcile` with the current
`baseName` or complete source/plan, `worksheetFile` and
`baseWorksheetFile`. Both files must refer to the same original source,
network and asset. Complete source revisions use the original contract desk.

Changes made only in the worksheet carry forward. Changes made only in the
current merchant remain. If both changed one field differently, the result
contains its exact `conflicts.items[].id`, original value, current value and
worksheet value. Choose `SHEET` or `CURRENT` for each ID in the `choices`
object. IDs contain escaped NUL separators in JSON; copy the returned strings
exactly.

Repeat the request with those choices. Reconciliation, review, export and save
use the same context, so the settled worksheet remains reproducible. Unresolved
fields stay visible in reconciliation until a choice is supplied. Once resolved,
review and save the complete resulting merchant through the ordinary tools.

## Command line

Use the installed `starforge merchant-route-worksheet` command, or run the source CLI:

```sh
node stellar-forge/mcp-merchant-operator/openapi-route-worksheet-cli.mjs review \
  --url "$MERCHANT_MCP_URL" --request-file /private/worksheet-review.json
```

Commands are `inventory`, `reconcile`, `review`, `save` and `export`.
The request file contains the corresponding tool arguments, including workspace.
Keep the bearer token in its environment variable; `--token-env` chooses that
variable's name.

```sh
starforge merchant-route-worksheet export \
  --url "$MERCHANT_MCP_URL" --request-file /private/worksheet-export.json \
  --out /private/delivery/api-route-worksheet.json
```

An export request contains the source/plan context and worksheet actions.
`--worksheet-sha256` pins the complete reviewed output, and
`--chunk-bytes` selects a smaller transfer chunk if needed.

## Continue the original package handoff

After worksheet save, use the existing complete package export, manifest, file,
download, receiving and reopen operations in [OPENAPI_WORKSPACES.md](OPENAPI_WORKSPACES.md).
The source, plan, compiled payment terms, cache and operation settings travel
together. The received package reopens in the browser and agent with the same
worksheet source identity.

Use `merchant_openapi_stage` for the original SF82 release store, then its
ordinary compare, activate, start and stop commands. The running seller's
unpaid request returns its native HTTP 402 offer with the reviewed exact terms.
The original runtime owner and release history remain the operational controls.

Each merchant operation reads its declared managed console URL once and retains that original console through dependent source reads, inspection, review and publication. A reconnect between operations uses the updated URL. Declared source, plan and worksheet file handles and receiving directories stay attached to the same configured workspace.

## Run the complete original merchant workflow

From this source checkout, choose an existing private directory and run:

```sh
node stellar-forge/mcp-merchant-operator/openapi-route-worksheet-journey.mjs /absolute/existing/private-directory
```

This original-console operation expands the maintained weather example to 1,302 API operations. It uses actual authenticated merchant HTTP, declared source/plan/worksheet files, full inventory pages and a worksheet larger than the ordinary MCP request limit. It then downloads and reopens the complete worksheet, changes integer atomic prices beyond JavaScript's exact-number range, adds a fully authored route, reconciles two price conflicts with retained selections, and saves through the original package writer. The same operation changes the managed console URL during save to exercise connection pinning, then verifies that the next operation uses the updated connection.

The continuation exports every original package member, downloads and reopens the complete package, receives it through a second original console, and operates the SF82 release through compare, activation, HTTP 402 and owned shutdown. It exercises the CLI export in that same workflow. Its private result.json records the operated source and outcomes; the driver closes its original consoles and merchant host when it finishes.

The five worksheet definitions are part of the existing static OpenAPI tool catalogue. Listing configured tools keeps the merchant's on-demand provider loading: the worksheet compiler and original console runtime load when an OpenAPI operation uses them.
