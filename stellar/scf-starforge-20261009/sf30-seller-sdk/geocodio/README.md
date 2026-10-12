# Address quality workspace

This operator keeps source records, address lookups, Geocodio candidates, coordinate decisions, native dataset editions, and customer delivery in one retained workspace. It accepts a CSV, a JSON record array, the SimplyRETS property response, or an existing address intake.

The same address can appear in several project or listing records. Exact mapped address tuples share one provider lookup. Each original record keeps its ordinal, source identity fields, full original row, and its binding to that lookup. A shared provider address key is available for review; it does not merge business records.

## Start the operator

Use the maintained Starforge source tree and Node with its original `node:sqlite` support:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/geocodio/cli.mjs serve \
  --dir /private/address-workspace --port 0
```

Open the private local URL printed by that process. The server binds to `127.0.0.1`; the session token is carried in the URL fragment and then retained in that browser session. An original workspace has one writer. Close its server before reopening it from a separate process.

To run provider requests, set `GEOCODIO_API_KEY` in the process environment, or choose another existing variable with `--key-env NAME`. The key stays outside saved state, source packages, query parameters, and browser responses. Importing an already completed provider response works without a key.

The CLI also exposes the same original actions:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/geocodio/cli.mjs status \
  --dir /private/address-workspace

node stellar/scf-starforge-20261009/sf30-seller-sdk/geocodio/cli.mjs act intake.import \
  --dir /private/address-workspace --payload /private/intake-action.json
```

Every address-state mutation includes `expectedRevision` from the current state. The publisher uses its own original dataset revision, release generation, and buyer-operation bindings. A changed revision returns an actionable conflict so the operator can review the current selection.

## 1. Retain the source and declare its mapping

The Source pane supports four formats:

| Format | Retained input |
| --- | --- |
| CSV records | Exact CSV bytes, all source fields, and the declared address mapping |
| JSON record array | Exact JSON bytes and original numeric literal text, including large identifiers |
| SimplyRETS JSON records | The original property array with the SimplyRETS address, coordinate, and identity mapping |
| Retained address intake | The complete query-to-source binding, source identity, and original mapping |

For a retained intake, an optional original-source path preserves the original CSV or JSON bytes as well. Its byte count and SHA-256 must match the source identity in the intake.

Mappings use named source fields, optional dotted paths, explicit constants, and an explicit separator. A source row with missing address components or a country outside this US forward-geocoding profile remains in the source-exception set. Its original content remains available in the package.

The supplied HPD mapping uses `house_number` plus `street_name`, `borough`, and explicit NY/US constants. It retains `project_id`, `building_id`, `bbl`, `latitude_internal`, and `longitude_internal`. HPD's building-in-project records remain separate when they share an address.

The SimplyRETS mapping uses `address.streetNumberText` and `address.streetName`, the original unit, city, state, postal code, and country. It retains `mlsId` and `listingId` as separate identifiers and keeps `geo.lat` and `geo.lng` beside subsequent provider coordinates. The shared source JSON parser preserves numeric lexemes before address mapping, so an int64 `mlsId` never passes through a rounded JavaScript number.

### Intake action example

```json
{
  "expectedRevision": 0,
  "format": "simplyrets",
  "path": "/private/original-properties.json",
  "sourceURL": "https://api.simplyrets.com/properties?limit=500",
  "provenance": "Provider-published demonstration property response"
}
```

The original dataset/API receipt remains the authority for whether a source is a public demonstration, a public dataset, or a customer feed.

## 2. Prepare or import the original provider batch

The Provider batches pane prepares the missing address queries and shows the exact lookup count, saved body, original endpoint, and operation identity. The operator chooses an explicit maximum of at most 10,000 lookups for each batch.

Requests use Geocodio v2 synchronous `POST /geocode?limit=0`, structured address objects keyed by the retained query identifiers, and no field appends. Every returned candidate is preserved. No candidate cap, census append, or other enrichment is added implicitly.

`provider.prepare` returns a saved request ID, path, and body SHA-256. `provider.run` requires that same ID and SHA-256. It records the start before sending, retains the complete original response and HTTP receipt before parsing, and waits up to 15 minutes by default. The original request can be read without sending it.

A provider or transport interruption stays attached to the original operation. Requests with uncertain completion are not automatically resent. Import the completed response against the same original body to reconcile it. A 429 retains the provider's Retry-After value. Existing results are reused unless an operator explicitly prepares a refresh.

The Response import form accepts a keyed batch response with its original request JSON, or a single-address response with the selected original query. The action API additionally accepts ordered array batches when the caller supplies the complete ordered query IDs. Each response is bound back to the selected source queries before it enters the review view.

### Original request actions

```json
{
  "expectedRevision": 1,
  "maximumLookups": 782
}
```

Pass that payload to `provider.prepare`, then review its result. A subsequent `provider.run` payload contains `id`, `expectedRequestSha256`, and the new address-workspace `expectedRevision`.

### Import a completed batch

```json
{
  "expectedRevision": 1,
  "mode": "object",
  "requestPath": "/private/original-geocode-queries.json",
  "responsePath": "/private/original-geocode-response.json",
  "receipt": {
    "status": 200,
    "receivedAt": "2026-10-12T00:00:00Z"
  }
}
```

Use the actual receipt time and HTTP result. Add `requestId` when reconciling a request originally prepared in this workspace.

## 3. Review match quality and coordinate differences

The Match review pane shows the source address, original record count, review state, candidate score and type, and maximum distance from the source coordinates. Opening a row exposes every provider candidate, its stable address key and provider source, and each original coordinate pair with its distance.

The initial qualification policy requires:

- Accuracy of at least 0.9.
- A rooftop or point result.
- A stable address key and matching country.
- No alternative with a competing score within 0.02 at a different key or location.
- At most 100 metres from any valid original coordinate pair.

These are visible operator thresholds. Change them for the actual delivery's acceptance requirements. Geocodio accuracy is a provider match score; it is not a probability that a listing coordinate is correct.

Qualification organizes review. Applying qualified addresses is an explicit action over the exact displayed selection. Each individual decision or bulk decision records a reason and the policy used at that time. All previous decisions remain in the workspace.

Coordinate choices are explicit:

| Choice | Selected output coordinates |
| --- | --- |
| Preserve original coordinates | Use the original usable coordinate pair |
| Fill missing original coordinates | Keep an existing original pair; use the reviewed provider pair only when missing |
| Use reviewed provider coordinates | Use the chosen provider pair while retaining the original pair alongside it |
| Keep original source | Record the decision to retain the source without accepting a provider candidate |

A later response that changes the chosen candidate returns that address to review. The earlier decision remains in history. Shared stable keys across different source queries appear in a separate review view.

## 4. Build and query a native edition

Choose all source records or only reviewed records, then select the original fields to carry into the dataset. The edition uses the existing SF30 CSV dataset parser and query engine.

Every output includes the source ordinal, retained query ID, review state, candidate identity and quality, source coordinates as original text, provider coordinates, displacement, coordinate choice, selected coordinates, and review reason. Original fields such as `mls_id`, `listing_id`, `bbl`, or `project_id` remain string columns.

The native query capabilities include:

- Equality filters for review state, accuracy type, coordinate choice, and stable address key.
- Numeric ranges for accuracy and displacement.
- Sorting by source ordinal, accuracy, and displacement.
- Snapshot-bound cursor pagination and a configurable page limit.

For example:

```text
where_review_state=ACCEPTED&gte_accuracy=0.9&sort=-displacement_m&limit=50
```

The exact last successful query is retained. The delivery contains both the first-page replay parameters and the last accepted page/cursor context.

## 5. Export and reopen the delivery

The Delivery pane creates:

| File | Purpose |
| --- | --- |
| `dataset.csv` and `dataset.json` | Original native dataset bytes and query configuration |
| `source.json` | Geocodio-specific source, mapping, response identity, review basis, and native snapshot |
| `query.json` | Reviewed query selection and continuation information |
| `address-review.json` | All candidate and coordinate-review details |
| `seller.json` | Original SF30 merchant configuration when public terms are configured |
| `starforge-geocodio.json.gz` | Complete portable workspace, original files, decisions, and editions |
| `raw/...` | Exact original intake/source, request, response, and edition files |
| `README.md` | Delivery-specific handover |

The optional `source.json.sourceFiles` descriptors list the exact relative path, byte count, and SHA-256 of the auxiliary source closure. The original SF82 source-files extension carries that closure through stage and verified reopen. The source manifest retains its `stellar-forge.geocodio-source.v1` schema.

Restore `starforge-geocodio.json.gz` into an empty workspace. Every portable file is checked against its retained identity; native dataset configurations must reference their adjacent CSV; each restored native snapshot is reproduced before the workspace is accepted.

## 6. Publish and deliver through the original product

The Publisher pane reuses the maintained publisher view and the original SF82 release and SF88 customer engines. It opens lazily in the address workspace's `publisher` directory.

Prepare an exported edition containing its public merchant terms. The original publisher validates the CSV, configuration, source bytes, native snapshot, and seller contract; creates the original versioned dataset binding; and retains the Geocodio source unchanged.

From that same pane:

1. Review the draft and native query.
2. Stage the original seller release.
3. Activate the release using the displayed generation.
4. Start the original seller and inspect its actual listener.
5. Review a customer offer against a selected snapshot and first-page query.
6. Prepare the original buyer intent and choose its explicit page, row, byte, and total-payment limits.
7. Run, recover, account for, and export the same retained acquisition.

An unpaid-page continuation uses the original saved attempt and normal approval path. It preserves completed pages and offers an explicit **Continue unpaid page** action when the original customer engine reports one.

The CLI keeps `publisher.release.start` alive until SIGINT or SIGTERM, then drains the original seller and releases its workspace. Browser hosts can borrow an existing operator or the original workspace/publisher models; closing a borrowed listener does not close those models.

## Programmatic composition

```js
import {openGeocodioOperator, startGeocodioWorkspace} from './server.mjs';

const operator = await openGeocodioOperator({directory: '/private/address-workspace'});
const browser = await startGeocodioWorkspace({
  directory: '/private/address-workspace',
  operator,
  port: 0
});
// Use operator.state(), operator.act(), and retained file readers.
await browser.close();
await operator.close();
```

The operator exposes `state()`, `act(action,payload)`, `readExport(id,name)`, `readPublisherExport(kind,id)`, and `close()`. Existing models are borrowed when explicitly supplied. The original address revision and publisher revision remain distinct.

## Source references

- [Geocodio API reference](https://www.geocod.io/docs/): v2 authentication, structured batches, lookup counts, candidate fields, score/type semantics, and stable address keys.
- [Geocodio terms](https://www.geocod.io/terms-of-use): current provider-use terms.
- [SimplyRETS API specification](https://docs.simplyrets.com/api/simplyrets-openapi.yaml): `mlsId` int64, `listingId`, original address fields, and property coordinates.
- [SimplyRETS FAQ](https://simplyrets.com/faq): feed mapping, synchronization, quality review, and business/integration contact.
- [NYC HPD Affordable Housing Production by Building](https://data.cityofnewyork.us/Housing-Development/Affordable-Housing-Production-by-Building/hg8x-zxpr): original building-in-project source semantics.

MIT. The original parser, dataset engine, publisher, release lifecycle, and buyer engine remain maintained in their existing modules.
