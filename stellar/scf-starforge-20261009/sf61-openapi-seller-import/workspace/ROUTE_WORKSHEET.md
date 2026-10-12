# API route inventory and pricing worksheet

The API merchant workspace includes one route inventory for the original OpenAPI,
Postman-derived or reviewed HAR source. It connects route selection and exact
prices to the same merchant configuration, native compiler, saved package and
seller release workflow.

Open **Select and price routes → Route inventory and pricing worksheet** after
loading a source or reopening a saved merchant. The complete original inventory
is available in pages of 50 operations. Search by method, path or source summary;
filter by HTTP method, inclusion, missing prices or changed worksheet rows.

## Author routes and prices

Each supported row has an **Include** checkbox and an **Atomic price** text
field. **Open full settings** moves to the original route card for its backend
server, authentication, transport, public request, response, streaming, cache,
availability and durable-operation settings.

**Include filtered routes** and **Exclude filtered routes** apply to every
supported match, including matches on other pages. The button shows its complete
match count. The original merchant supports 1–64 selected routes; the source
inventory can contain up to 2,000 described operations.

Open **Change several prices** and select the intended group:

- included routes matching the filter;
- every supported route matching the filter;
- every included route.

Set one exact atomic-unit price, or change existing prices by a signed percentage
with at most two decimal places. Percentage changes use integer arithmetic.
Choose upward, downward or nearest-atomic-unit rounding explicitly. Nearest
rounds an exact half upward. A change must leave a positive price. Routes without
a price need a fixed price before a percentage can be applied.

These actions stage the worksheet. Its counters and changed-row filter show
the proposed edits. An unsupported method stays visible with the original
source error.

## Review and apply to the original merchant

1. Set the public offer and the required route settings in their original
   merchant controls.
2. Choose **Review configuration changes**. The existing authenticated
   `/api/preview` and original seller compiler validate the complete proposed
   merchant plan, including its source binding and all selected route policies.
3. Inspect every inclusion and atomic-price change. The original compiler's
   resulting backend target, network and exact price are displayed for every
   selected route.
4. Choose **Apply reviewed worksheet**. The current complete merchant plan must
   still match the reviewed one. Only route inclusion and atomic prices are
   copied into the original form.
5. Use **Save new package**, then reopen that package from **Saved projects**.
   The original source, plan, compiled offers and package manifest retain the
   selected terms.

Editing authentication, transports, prices or any other merchant setting after
the review requires another review. A worksheet does not replace an original
route record: its ID, server choice, environment references, request examples,
response contracts, query serialization, OAuth configuration, streaming,
durable operations, availability and cache policy remain in the original form
and compiler.

A reviewed HAR source keeps its existing exact selected-operation contract.
If its source binding requires a different operation set, make that authored
change in **Review operations here** first; then return to the worksheet for
the resulting merchant prices. The original HAR compiler resolves that binding.

## Retain and reconcile ongoing work

Worksheet edits are retained in this browser when supported by its local
storage. Each worksheet has its own record. Starting a new worksheet, opening
another source or reopening another merchant preserves the earlier records.

**Retained worksheets** lists the records for the current private workspace.
Use **Restore worksheet** to resume one against its exact API source, network
and asset. The original worksheet base travels with its proposed prices.
Changes made only in the worksheet carry into the current form's selection;
changes made only in the form remain current. If both places changed the same
inclusion or price differently, select the value to keep for that field.

The same reconciliation is available through **Reconcile current form** while
editing. Application updates and source revisions remain governed by the
original merchant workspace. A worksheet for an older source remains
downloadable; use the original **API contract revision desk** to review a new
source and carry its complete settings.

Applying a worksheet retains its file even before the new merchant package is
saved. A successful original package save marks the matching worksheet with
that package name. **Reset worksheet to current form** starts another working
copy. **Remove retained worksheet** removes only the selected browser record.

Browser records are scoped to the browser origin and private workspace.
Download the worksheet to move it to another browser, host or port. If browser
storage is full or unavailable, the current worksheet remains usable and its
download supplies the portable file.

## Complete portable worksheet

**Download worksheet** exports UTF-8 JSON with this declared schema:

| Field | Meaning |
| --- | --- |
| `schema` | `stellar-forge.api-route-sheet.v1` |
| `sourceSha256` | Exact original OpenAPI source hash from the native inspector |
| `title` | Original source title for operator identification |
| `currency.network` | Exact selected Stellar network |
| `currency.asset` | Exact selected payment asset |
| `rows[].method`, `rows[].path` | Original operation identity |
| `rows[].selected` | Explicit merchant inclusion |
| `rows[].amountAtomic` | Positive decimal text, or empty while authoring |

Prices are strings, including values beyond JavaScript's safe-integer range.
A numeric JSON price is rejected before it can lose precision. The complete
file is limited to 4 MiB and 2,000 distinct source operations.

**Import a source-bound worksheet** checks the original source, network and
asset. A partial file may update distinct known rows; omitted rows keep the
current worksheet values. Import stages the changes for the same complete
native review. Unknown operations and unsupported edits are rejected.

The reusable browser/Node model is `route-sheet-model.mjs`. It exports
`routeSheetSnapshot`, `importRouteSheet`, `changeRoutePrices`,
`rebaseRouteSheet`, `validateRouteSheet`, `routeSheetPlan` and `routeSheetText`.
Its exact `amountAtomic` strings match the original merchant-plan representation.
The browser passes the complete candidate through the maintained native
compiler.

## Compose the same worksheet in a merchant agent

The pure model is safe to import in Node and the browser. Installed Node consumers
use `@tokenjunkielabs/starforge-merchant/seller/openapi/route-worksheet`.
Use
`routeSheetSnapshot({sourceSha256,title,operations,rows,payment})` with the
original inspector and current authored rows; each row supplies method, path,
selected and amountAtomic. Apply a partial imported sheet with
`importRouteSheet(value,current,operations)`, or use
`changeRoutePrices(sheet,routeKeys,{kind,value,rounding})` for exact prices.
`routeKey(row)` supplies the unambiguous key.

`routeSheetPlan({plan,sheet,current,operations,operationPlans})` returns
`{sheet,plan,selected,changes}`. It checks that the current complete native
plan has exactly the current selected routes, prices, network and asset. It
retains each selected operation's complete original record and ordering, changes
only its price, and appends newly selected source operations from explicit
authored `operationPlans` records. Configure those new route records through
the original authoring path first; the helper never manufactures their
authentication or runtime settings. Deselecting a row removes it only from the
returned candidate plan.

Pass the complete returned plan and exact original `specText` to the existing
authenticated preview, retaining the original `capturedSource` binding for
HAR sources. Use the original draft/save/package operations and their retained
request identity for persistence. The worksheet itself has no replacement
server writer, ledger or package store.

For an existing compiled seller, the maintained SF97 repricing model accepts
exact `{routeId,paymentIndex,expectedAmount,amount}` edits. Preserve the complete
original seller and payment option order. Its
`prepareMerchantPlanRepricing({specText,plan,review})` maps that decision back
to the original merchant plan and compiler. USD commercial scenarios remain
explicit merchant-entered values in the original Pricing workspace; atomic
payment amounts are never inferred from them.

## Continue the saved seller and receiving handoff

After reopening the new package, use **Start challenge preview** and the
original **Check unpaid routes** control. Inspect the original offer and
backend configuration; stop that owned seller with **Stop managed seller**.

The original [complete package transfer](PACKAGE_TRANSFER.md) carries this
same saved source, merchant plan, compiled offers and route policies to another
private receiving workspace. Reopen the received package there and use the
worksheet against its unchanged source and payment asset.

For seller release publication, use the maintained merchant MCP
`merchant_openapi_stage` on the saved package and original SF82 release store.
The original inspect, compare, activate and start operations select the release
with its retained digest and selection generation. A later worksheet save is a
new merchant package; earlier releases remain available for rollback.

The existing HAR native receiving operation continues through its original
capture, review, console, agent and browser outputs. Open its retained
`received-merchant`, stage a deliberate price change in this worksheet, review
and save a new package, and reopen that actual package. Download and restore the
same worksheet, reconcile a real form-price edit, then carry the saved package
through the original receiving/release operations above.
