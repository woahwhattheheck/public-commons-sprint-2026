# Satellite imagery operations

This workspace takes an operator from an actual STAC catalog and scene query to
reviewed imagery, a versioned data product, and customer receiving. It uses the
maintained SF31 public HTTPS transport and SF88 private storage. Its merchant
and customer modules retain the original SF61 route compiler, SF30 seller,
SF82 lifecycle and SF88 buyer.

## Complete operator workflow

The local browser supports catalog discovery, saved AOI/time/cloud queries,
explicit search review, acquisition progress, cancellation and continuation,
scene footprints, original metadata and assets, recorded selection decisions,
edition comparison, public preview acquisition, reports and portable handover.
The neutral interface uses retained geometry and locally served acquired image
bytes. Opening a scene or an export never fetches a remote preview.

Run Node 22.16 or later with the normal Starforge source closure:

~~~sh
node sf30-seller-sdk/stac/cli.mjs init \
  --workspace /absolute/private/imagery \
  --title 'Imagery operations' \
  --endpoint https://earth-search.aws.element84.com/v1
node sf30-seller-sdk/stac/cli.mjs serve \
  --workspace /absolute/private/imagery --port 0
~~~

The server prints its local session URL. Open that URL in the same machine's
browser. It binds to loopback and requires its session cookie and CSRF token
for workspace changes. Source pages, reviews and completed assets survive restart.

For an explicitly configured CONNECT proxy, pass `--transport FILE` on
commands that make source requests. The JSON contains an original SF31
profile, or an array of profiles for the catalog and selected asset origins:

~~~json
[
  {
    "mode": "explicit-connect",
    "origin": "https://earth-search.aws.element84.com",
    "proxyEnv": "HTTPS_PROXY"
  }
]
~~~

An asset at another origin needs its own profile in that operator-owned file.
Normal public DNS/TLS is used when no transport profile is supplied.
Requests retain the actual host, SNI, method, query and POST body.

## Search, continuation and comparison

A query includes discovered collections, exactly one bounding box or GeoJSON
geometry, an RFC3339 instant or time interval, and optional maximum cloud cover.
The cloud predicate requires the catalog's declared STAC Query extension.
Bounding boxes can cross the antimeridian. Original three-dimensional
bounding boxes and source projection/raster fields are retained.

~~~sh
node sf30-seller-sdk/stac/cli.mjs discover \
  --workspace /absolute/private/imagery --operation-id discovery-1
node sf30-seller-sdk/stac/cli.mjs query-save \
  --workspace /absolute/private/imagery \
  --name 'Austin September scenes' --collections sentinel-2-l2a \
  --bbox=-97.85,30.15,-97.55,30.45 \
  --datetime 2026-09-01T00:00:00Z/2026-09-30T23:59:59Z \
  --cloud-cover-max 70 --page-size 100 --max-pages 1000
node sf30-seller-sdk/stac/cli.mjs review \
  --workspace /absolute/private/imagery --query SAVED_QUERY_ID
node sf30-seller-sdk/stac/cli.mjs acquire \
  --workspace /absolute/private/imagery \
  --review SAVED_REVIEW_ID --operation-id scene-capture-1
~~~

Each original request and response is retained before page progress is accepted.
The adapter follows provider `next` links, including GET/POST and STAC
`body`/`headers`/`merge` semantics. A page budget can end in `PARTIAL`;
`resume --edition ID` continues that edition from its saved next request.
Only exhaustion of provider pagination marks it complete. Coverage records
preserve matched count, returned items, duplicate count and completion reason.

Repeated scene identities across pages are deduplicated only when their complete
metadata hashes agree. A conflicting version in one traversal ends that capture
with original bytes retained. Per-operation and edition locks use the existing
Linux file-lock implementation; process exit releases the held descriptor, so a
resumed operation works across container PID namespaces. Cancellation aborts an
active local request or persists the request for its owning process. An old PID
lease from a pre-release workspace is preserved. Finish its original process;
for an interrupted legacy operation, export its retained handover and import it
into a fresh workspace before resuming the same edition.

Every application scene identity is:

~~~js
encodeURIComponent(item.collection) + '/' + encodeURIComponent(item.id)
~~~

The original STAC `Feature.id` is unchanged. Decisions and acquired assets also
expose `collection` and `nativeItemId`. Comparing two editions returns added,
removed, unchanged and changed entries from complete retained Features after
canonical JSON normalization. It reports metadata/source changes and preserves
both coverage records and query comparability. Radiometric or land-cover
analysis requires a separate source-appropriate processing workflow.

## Assets and portable receiving

Asset review displays the original href, MIME description, roles, license,
license links, providers and storage metadata. The adapter interprets storage
references and requester-pays flags. Public HTTPS assets can be acquired after
review. Requester-pays S3 data uses its separate official connection and payer
configuration. An S3 href is never rewritten as an anonymous HTTPS download.

Selected public assets stream to disk with an explicit size limit up to 2 GiB.
The default preview budget is 16 MiB. Completed records retain actual byte
length, response MIME and SHA256. The browser serves acquired raster previews
locally and supports authenticated ranged downloads. Original COG band
scale/offset/nodata, geometry, projection and acquisition fields stay intact.

[SOURCE-CONTRACT.md](./SOURCE-CONTRACT.md) provides the first-party collection
and rights references, including Earth Search v1/v2 identities, Sentinel
attribution, Landsat reprocessing and NAIP year semantics.

`exportHandover({editionIds,includeAssets:true})` produces a checksummed JSON
handover containing editions, source requests/responses, decisions and assets.
Import checks every file, retains original scene/edition identifiers and
records the source workspace. Reimporting an identical handover returns its
original receipt. The receiver can reopen, review assets and regenerate
comparisons and reports without a provider request.

The inline handover supports up to 256 MiB of decoded files. Large deliveries
use `exportEdition` and the original merchant/object path.

## Standalone edition and original commerce

~~~js
import { openStacWorkspace } from './workspace.mjs';
const workspace = await openStacWorkspace({
  directory: '/absolute/private/imagery', create: false
});
const { directory, manifest } = await workspace.exportEdition({
  editionId: 'SAVED_EDITION_ID',
  directory: '/absolute/private/deliveries/edition-1'
});
~~~

The immutable directory contains `manifest.json`, `scenes.csv`, `items.geojson`,
`decisions.json`, original requests/responses and acquired assets. The scene
CSV contains collection-aware identity, acquisition interval, cloud cover,
platform, constellation, geometry/properties/assets/links JSON and decisions.
Native JSON preserves null/empty distinctions that a CSV scalar cannot express.

Each declared file has its relative path, MIME, byte length and SHA256.
The manifest digest is SHA256 of canonical JSON for all top-level properties
except `id` and `digest`: object keys sorted recursively, array order retained,
no whitespace or trailing newline. The ID is `stac-edition-` plus the first
24 digest characters. The manifest does not list itself in `files`.
An unchanged export has the same identity; a conflicting destination is preserved.

[MERCHANT.md](./MERCHANT.md) covers the original three-route merchant, native
customer requests, recovery and acquired delivery. Small files use the original
one-shot buyer; large imagery uses maintained object byte windows and chunk
hashes under the same aggregate customer cap. The acquired local directory is
the input to customer receiving and the offline GIS explorer.

## Offline GIS for the received delivery

Export the original customer delivery and its scene explorer with the same CLI:

~~~sh
node cli.mjs portable-export --directory /private/received-stac --out /private/portable-stac
node cli.mjs portable-open --directory /private/portable-stac
~~~

Open `scene-explorer.html` in the portable directory for scene search, date/cloud
filters, original footprints, retained previews and source metadata. The directory
also contains a local STAC Catalog, complete GeoJSON and an asset inventory.
`portable-open` verifies the original customer delivery and every derived file;
use `--expected-manifest-sha256` to bind the exact export receipt as well.
[PORTABLE_GIS.md](receiving/PORTABLE_GIS.md) documents the receiving API and files.
The installed API is `@tokenjunkielabs/starforge-merchant/buyer/stac/receiving`.

## API and native example

`openStacWorkspace` exposes `getState`, `discover`, `saveQuery`, `reviewSearch`,
`acquire`, `resume`, `cancel`, `getEdition`, `reviewAsset`, `acquireAsset`,
`setDecision`, `compare`, `getAsset`, `getAssetFile`, `exportReport`,
`exportEdition`, `exportHandover`, `importHandover` and `close`.
The provider exports normalization, item-key, pagination, asset review, row/CSV
and canonical JSON helpers. `startStacServer` takes an opened workspace;
`runStacCLI` exposes the same operator workflow.

`examples/native-capture.mjs` makes real catalog/scene requests and retains all
provider pages, then records its actual selected preview for review.
`examples/native-complete.mjs` continues that same operation, acquires the
preview, captures a second live edition, compares them, exports reports and an
edition, imports the handover separately, verifies replay, and reopens the
receiver. Set `STAC_NATIVE_DIRECTORY` to the same private absolute directory
for both commands. The commercial example consumes that actual `edition-1`
directory instead of generating a provider response.

Original capture attempts and current decisions/operations are retained.
Eight recent internal state snapshots are kept so repeat operations do not
multiply complete catalog copies indefinitely. Financial state stays in the
maintained native buyer and seller.

## Processing history in the analyst workspace

Add a retained processing workspace to the existing server with `--processing-workspace DIRECTORY`; supply `--processing-config FILE` for its configured source. The [processing guide](./processing/PROCESSING.md) covers the original deployment connection, workflow inventories, selected run histories, pagination and recovery, analyst-reviewed scene associations, and complete processing/STAC export and receiving. The processing view stays mounted during workspace polling so an analyst can configure sources and review retained history without losing form edits. Its server uses the same authenticated local session as the scene workspace.

The library exposes `createProcessingController` through `@tokenjunkielabs/starforge-merchant/seller/stac/processing`, provider helpers through `seller/stac/processing/provider`, and complete portable processing receiving through `buyer/stac/processing`. Source credentials remain in the server's configured source-auth transport; raw captured records, explicit association choices and original handover members travel with the receiving case.
