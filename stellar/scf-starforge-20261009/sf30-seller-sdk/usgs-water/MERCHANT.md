# USGS Water Data native merchant and buyer

This module prepares a complete USGS capture as a portable, immutable edition. Its query service uses the original SF30 CSV dataset; SF61 exports its actual offers and service bindings; SF82 owns normal startup and restart readback; the original SF88 Node Buyer executes and reopens a customer purchase.

The edition contains the retained original provider responses, normalized features, typed query projection, optional hydrology analysis, and optional workspace review. Moving the edition directory preserves its relative source paths and content identity. The seller never recollects USGS data during a paid request.

## Application API

Import from `sf30-seller-sdk/usgs-water/merchant.mjs`.

| Export | Result |
| --- | --- |
| `prepareWaterEdition({directory,capture,analysis?,review?})` | Complete edition manifest plus absolute `directory` |
| `readWaterEdition(directory)` | Verified retained manifest plus `directory`, `status: "READY"`, `editionId`, and native `snapshot` |
| `stageWaterMerchant({editionDirectory,origin,path?,payment})` | Original SF61 compiled seller, immutable merchant plan, three route paths |
| `startWaterMerchant({editionDirectory,port?,nativeFactory?,facilitator?,allowLocalFacilitator?,challengeOnly?})` | Original live session, including `url`, `merchantUrl`, `mode`, `close()`, `snapshot`, and `paths` |
| `waterMerchantStatus(editionDirectory)` | Original SF82 readback of its retained listener and compiled offers |
| `createWaterHandlers(editionDirectory)` | Original dataset and preloaded exact JSON responses for trusted embedding |
| `createWaterNativeFactory({facilitator,allowLocalFacilitator?})` | Factory using original `createNativeSellerServer` and the installed x402 SDK |
| `prepareWaterPurchase({editionDirectory,intentId,query?,file?,kind?,acceptIndex?,previous?})` | Saved original SF88 request config and edition binding |
| `purchaseWaterEdition({buyer,prepared,editionDirectory?,signal?})` | Original BuyerResult plus inspected delivery metadata and JSON |
| `reopenWaterPurchase({buyer,intentId,editionDirectory})` | The same original saved result, reopened against the edition |

`directory` is the workspace destination chosen by the caller. `editionId` is derived from retained source, projection, schema, and optional analysis/review bytes. A workspace may give the parent directory a different human-readable edition ID. The native `snapshot` comes from the maintained dataset loader and binds its CSV bytes and query capabilities.

## Prepare a portable edition

The provider workflow is documented in [PROVIDER.md](./PROVIDER.md). Finish a selected provider operation, then prepare it:

```js
import { readCapture } from './sf30-seller-sdk/usgs-water/provider.mjs';
import {
  prepareWaterEdition, readWaterEdition, stageWaterMerchant,
  startWaterMerchant,
} from './sf30-seller-sdk/usgs-water/merchant.mjs';

const capture = await readCapture('/absolute/project/captures/operation-1');
const edition = await prepareWaterEdition({
  directory: '/absolute/project/editions/water-review-1',
  capture,
  analysis: hydrologyAnalysis,
  review: { reviewId: 'review-1', reviewSha256, note, comparison },
});
console.log(edition.editionId, edition.snapshot, edition.rowCount);
```

The optional analysis and review arguments are JSON. The project layer can pass its retained analysis directly. Every retained request, response record, body, and capture manifest is copied into `capture/`, with the original bytes and hashes. The JSONL retains all normalized provider fields plus original feature properties and geometry. `observations.csv` and `dataset.json` are the original SF30 query input.

Original source pages and analysis JSON appear in the explicit `downloads` list. Workspace review notes stay in the portable package as `review.json`; they are outside the source download route. File descriptors in the edition manifest retain their hash and byte count.

Each member is written privately and create-only. Repeating preparation with identical bytes reopens the same edition. Changed source, analysis, review, or schema requires another edition directory. The copied provider manifest can be reopened directly:

```js
const moved = await readWaterEdition('/absolute/archive/water-review-1');
const retainedCapture = await readCapture(moved.directory + '/capture');
```

No reference to the original acquisition directory is needed after preparation.

## Observation semantics and query behavior

The projection retains exact provider text for parameter IDs, time-series IDs, value, time, unit, approval status, and qualifiers. It also includes original `properties_json` and `geometry_json`, feature identity, page/index provenance, source URL and SHA-256, and duplicate/conflicting-duplicate markers.

The `value_state` field distinguishes absent, null, empty, decimal, text, and a provider type change. Nullable CSV fields represent an empty cell as null; `value_state` and the retained JSON preserve the source distinction. Decimal measurements remain strings. This prevents numeric coercion from changing official precision. The optional hydrology analysis owns scientific interpretation and comparisons.

Two separate range indexes support time selection:

| Query column | Meaning |
| --- | --- |
| `local_date` | Original literal `YYYY-MM-DD` date, without assigning a timezone |
| `continuous_epoch_ms` | Derived instant only when the original timestamp contains an explicit UTC marker or numeric offset |
| `time` | Original provider value, retained unchanged |

A local daily date is not converted into UTC midnight. Continuous values retain their original offset spelling even when the separate numeric index is used.

The original dataset supports these exact equality filters:

- `where_collection`
- `where_monitoring_location_id`
- `where_time_series_id`
- `where_parameter_code`
- `where_approval_status`
- `where_value_state`
- `where_duplicate`
- `where_conflicting_duplicate`

Use `gt_`, `gte_`, `lt_`, or `lte_` with either time range column. A query may choose one lower and one upper bound per column. `sort` accepts either time column, `source_page`, or `source_index`; prefix a minus sign for descending order. Equal values retain original CSV record order. Nulls sort last.

`fields` selects exposed columns. `limit` defaults to 50 and permits up to 250. Query responses fit the maintained 900 KiB dataset-page ceiling; a field selection can reduce unusually large property/geometry projections. The original dataset performs admission before payment. It returns its native dataset description, rows, total count, and next cursor.

Every page request carries the same immutable `snapshot`. Continue with the returned cursor unchanged and the same fields, filters, ranges, and sorting. Duplicate records are retained and marked; customers can explicitly request `where_duplicate=false`.

## Stage actual seller offers

Supply public payment terms in the original schema:

```js
const payment = {
  scheme, network, asset, amount, payTo, maxTimeoutSeconds,
};
const staged = await stageWaterMerchant({
  editionDirectory: edition.directory,
  origin: 'https://water.example.com',
  path: '/water',
  payment,
});
console.log(staged.paths, staged.offersSha256, staged.serviceConfigSha256);
```

The original compiler validates all payment fields. `amount` is the accepted atomic amount in the original scheme; use the actual supported network, asset, and receiving address. These values come from the operator's existing payment configuration.

The generated paths include the complete content-derived edition ID:

| Route | Response |
| --- | --- |
| `/water/<editionId>/observations` | Original native dataset page, one purchase per page |
| `/water/<editionId>/source?file=<retained-path>` | Exact bytes of a listed USGS GeoJSON or analysis JSON file |
| `/water/<editionId>/edition` | Exact immutable edition manifest |

The source route serves JSON, including GeoJSON, with its content hash and download name. Source files are selected only from the manifest download map; caller input is never turned into an arbitrary filesystem path. The maintained original asset admission rejects Range and conditional requests before settlement.

The staged package contains:

- `merchant-inputs/openapi.json`, `selections.json`, and `bindings.json`
- Original SF61 `merchant/offers.json`, `seller-service.json`, and `manifest.json`
- `merchant-plan.json`, binding edition identity, native dataset snapshot, public origin, paths, payment terms, and original export hashes

The original compiler output is preserved. A successful stage can be reopened without recompilation. A different price or public origin requires another edition directory so existing purchases continue to identify their original offer.

## Start and restart the native service

For an installed facilitator and x402 SDK:

```js
const merchant = await startWaterMerchant({
  editionDirectory: edition.directory,
  port: 8423,
  facilitator: 'https://your-facilitator.example',
});
console.log(merchant.mode, merchant.url, merchant.paths);
process.once('SIGINT', () => merchant.close());
```

The original server listens on loopback. The public HTTPS origin is the configured reverse-proxy origin. The ordinary facilitator path uses original SF82 launch/resume, original offer and service hash checks, and actual `/_seller/health` and `/_seller/offers` readback. Its normal startup stores `pilot-runtime.json` and `runtime-readiness.json`.

Call `startWaterMerchant({editionDirectory})` again in a new process to resume the saved facilitator settings. Call `waterMerchantStatus(editionDirectory)` for original SF82 listener readback. Call the returned session's `close()` to drain and stop.

For metadata and challenge inspection:

```js
const merchant = await startWaterMerchant({
  editionDirectory: edition.directory, port: 0, challengeOnly: true,
});
```

A trusted embedding can pass its already configured original native factory:

```js
const merchant = await startWaterMerchant({
  editionDirectory: edition.directory,
  port: 0,
  nativeFactory,
});
```

This embedding starts the original SF30 service directly with the exact compiled offer and application handlers. Its returned original `mode`, listener, and close method are live; SF82 status applies to sessions started by the ordinary facilitator/challenge path.

All source assets are read, checked, and retained once at startup. Subsequent purchases get copies of those same bytes. The original limits are enforced: 16 MiB per JSON response and 64 MiB combined retained JSON assets. The native dataset supports up to one million rows and 256 MiB per source projection file. The portable edition includes every captured member even if a capture exceeds a serving limit; choose a complete provider selection that fits the intended native service.

## Original SF88 customer purchase

Create the existing Node Buyer with its installed original runtime and operator profile:

```js
import { Buyer } from './sf88-operator-buyer-cli/node/client.mjs';
import {
  prepareWaterPurchase, purchaseWaterEdition, reopenWaterPurchase,
} from './sf30-seller-sdk/usgs-water/merchant.mjs';

const buyer = await new Buyer({
  runtimeDirectory: '/absolute/installed/sf88-runtime',
  stateDirectory: '/absolute/customer/water-purchases',
  operatorProfile: '/absolute/customer/operator-profile.json',
}).ready();

const prepared = await prepareWaterPurchase({
  editionDirectory: edition.directory,
  intentId: 'water-page-0001',
  acceptIndex: 0,
  query: {
    where_parameter_code: '00060',
    fields: 'monitoring_location_id,time,value,value_state,unit_of_measure,source_sha256',
    limit: '50',
  },
});

const purchased = await purchaseWaterEdition({ buyer, prepared });
console.log(purchased.result.status, purchased.rows, purchased.metadata);
```

All query values are strings, matching original native URL parsing. The example uses the conventional parameter code as a selector; availability depends on the captured selection. Inspect the retained metadata and selected series before purchase.

Preparation reads the original SF61 offers and calls the original SF88 saved-catalog preparation. The resulting native request retains the original accepted payment terms. Source-file purchases additionally pin exact SHA-256, byte count, and content type. The caller's Buyer supplies its existing trusted operator and signer. The buyer creates its own response destination and durable native operation.

Execution calls the original operation's review and execute methods once. `water-edition.json` beside the original operation binds its saved config hash to the edition, requested URL, snapshot, selected source member, and previous-page metadata. A successful result is read through the maintained BuyerResult file verifier, then inspected with the original native dataset-page inspector.

Reopen the same intent after a process restart:

```js
const reopened = await reopenWaterPurchase({
  buyer,
  intentId: 'water-page-0001',
  editionDirectory: '/absolute/archive/water-review-1',
});
console.log(reopened.result.status, reopened.metadata, reopened.rows);
```

Reopening uses the original operation's recover method and its retained response. If the original process has not recorded a result, it returns `state: "AWAITING_NATIVE_RESULT"`. A failed native result retains its original status. Use `reopenWaterPurchase` for an existing intent; the original Buyer directs duplicate intent creation to recovery.

For the next page, carry the actual page inspector metadata:

```js
if (purchased.metadata.nextCursor !== null) {
  const next = await prepareWaterPurchase({
    editionDirectory: edition.directory,
    intentId: 'water-page-0002',
    query: {
      where_parameter_code: '00060',
      fields: 'monitoring_location_id,time,value,value_state,unit_of_measure,source_sha256',
      limit: '50',
      cursor: purchased.metadata.nextCursor,
    },
    previous: purchased.metadata,
  });
  const page = await purchaseWaterEdition({ buyer, prepared: next });
}
```

The native inspector checks snapshot, query hash, field order, filters, counts, range bounds, cursor continuity, and exact saved response bytes. A new intent represents another page purchase.

For exact source delivery, choose a retained file from the manifest:

```js
const originalPage = edition.downloads.find(item => item.path.startsWith('capture/bodies/'));
const sourceRequest = await prepareWaterPurchase({
  editionDirectory: edition.directory,
  intentId: 'water-original-0001',
  file: originalPage.path,
});
const source = await purchaseWaterEdition({ buyer, prepared: sourceRequest });
await source.result.saveAs('/absolute/customer/usgs-original-page.json');
```

Use `kind: "edition"` for the exact edition manifest. `source.value` is the decoded original JSON; `source.result` remains the original saved delivery object and supports its ordinary byte, file export, and verification methods.

## Workspace and CLI customer controls

The workspace customer form selects observation pages, an exact source file from the edition's download list, or the edition manifest. Its next-page action carries the previous native page metadata, preserves the original query, adds the returned cursor, and assigns a fresh intent.

The equivalent CLI options are `--kind observations|source|edition`, `--file retained/member`, `--query query.json`, and `--previous page.json`. A previous-page file may be the complete JSON output of `buy` or `buy-reopen`, or just its native `metadata` object. Use the complete saved result directly:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/cli.mjs buy-reopen \
  --project /absolute/project --edition water-review-1 --intent water-page-0001 \
  --buyer-config /absolute/customer/buyer.json --out /absolute/customer/page-one.json
```

To prepare the next page, save the same query in `next-query.json` with `cursor` set to the returned `metadata.nextCursor`, then run:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/cli.mjs buy-prepare \
  --project /absolute/project --edition water-review-1 --intent water-page-0002 \
  --kind observations --query /absolute/customer/next-query.json \
  --previous /absolute/customer/page-one.json
```

Execute with `buy`, the same intent and selection options, and `--buyer-config`. A source purchase uses `--kind source --file <path from edition.downloads>`; an edition-manifest purchase uses `--kind edition`. Existing intents use `buy-reopen` and retain their original request and result.

## Native joined exercise

The maintained [journey.mjs](./journey.mjs) runs the complete application through its original native provider, project, seller, and buyer modules. From the repository root:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/journey.mjs \
  --directory /absolute/new-water-journey
```

Choose a new destination with a canonical absolute parent. The journey needs Node 22 or later, Python 3, OpenSSL, and the existing native x402 dependencies. [JOURNEY.md](./JOURNEY.md) gives the exact runtime versions and the optional `--source-bundle` input for a host carrying retained original USGS HTTP responses.

The joined workflow acquires the selected daily observations across four original provider pages, saves a period comparison and decision, prepares the complete edition, and compiles the three SF61 routes. It starts through the original SF82 launcher and SF30 native x402 service, then performs six original SF88 purchases: four observation pages, one exact source body, and the edition manifest. The original local commerce fixture supplies the facilitator and disposable operator credentials described in the journey guide.

The workflow moves the acquisition capture, exports the portable edition, and reopens all six native buyer results against the exported edition. Its `result.json` contains the actual capture and source hashes, dataset snapshot, edition identity, delivered page metadata, original local facilitator counts, and request counters for saved-result reopening. The `exports/` directory contains the purchased original bytes, the complete edition, and the saved decision in HTML, JSON, CSV, and GeoJSON.
