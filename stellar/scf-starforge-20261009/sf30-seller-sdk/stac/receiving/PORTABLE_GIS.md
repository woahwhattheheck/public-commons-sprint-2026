# Portable scene catalog and offline explorer

This component adds a portable GIS view to the original STAC customer delivery.
The STAC workspace remains the source of selected editions, source metadata,
reviews and downloads. The original SF88/SF100 customer path remains responsible
for payment, receipt, assembly, exact file hashes and reopen. The explorer does
not need the merchant workspace or a Buyer.

## What a recipient can use

Open `scene-explorer.html` in the received directory. It embeds its metadata,
styles and scripts and makes no provider or map request. Keep the complete
received directory together so local asset links and previews keep working.

The explorer provides scene search, Collection selection, acquisition-date and
cloud-cover filters, source-footprint selection, original Item metadata, asset
receipts, and Collection attribution. Date filters match overlapping source
intervals. Unknown source dates and cloud values remain visible. The table pages
the display; its count and export still refer to the complete filtered selection.

The footprint view is a longitude/latitude schematic of the original source
geometry. Display wrapping handles the antimeridian; it does not modify exported
coordinates. It does not calculate areas or distances, render new satellite
pixels, or reproject a raster. Null geometry remains null. A browser preview uses
an original retained PNG, JPEG, WebP, AVIF or GIF, when the receiver supplied one.

A **retained** asset has an exact local relative path, byte count and SHA-256 from
the original receiver. An asset may be declared in an Item but not included in the
purchase, not requested, unavailable, or associated with a failed acquisition.
Those states stay visible with the original outcome and metadata. A credentialed
or requester-pays source URI is a source reference, not a newly available local
file. Reopen with the original customer API when current file verification is
needed; the static HTML records the earlier receipt and does not silently make
a new verification claim.

## Generated files

| File | Purpose |
| --- | --- |
| `scene-explorer.html` | Standalone scene, footprint, metadata and asset review |
| `stac-catalog/catalog.json` | Root of the local STAC traversal |
| `stac-catalog/collections/*.json` | Source Collection metadata with local traversal links |
| `stac-catalog/items/*.json` | Original Item metadata with local links for received assets |
| `scene-footprints.geojson` | Original parsed Feature objects and unchanged geometry/properties |
| `scene-collections.json` | Original parsed Collection objects, including rights and providers |
| `scene-assets.json` | All declared scene assets, original receiver outcomes and exact local descriptors |
| `scene-export.json` | Derived file hashes, source edition identity and received-file references |

The **Export filtered GeoJSON** action exports the current display selection and
records the selected filters in a foreign member. The complete GeoJSON link
always refers to the unfiltered received scene set.

Scene identity combines the source Collection ID and Item ID. Collection-scoped
IDs do not collide when two Collections use the same Item ID. More than one
version of the same identity must be resolved by the original edition selection;
this component does not select a newer source edition implicitly.

Local Collection metadata retains the provider's original extent, summaries,
license, providers and extensions. Those values can describe the source
Collection beyond the scene subset in this delivery. The root Catalog and its
local `item`/`child` links enumerate this delivery's selected scenes only. Original
source links remain in the preserved metadata. An unresolvable or executable
source URI is not converted into a false local file location.

Local STAC Items preserve source properties, geometry, asset keys, roles, MIME
types and extension values. Derived traversal links point within the portable
directory. A received asset's href points to its unchanged local bytes; other
usable asset hrefs remain explicit source references. Root Catalog metadata does
not inherit Item-only extensions.

The GeoJSON and metadata JSON serialize the original parsed objects. The
original customer delivery separately retains exact source response bytes and
their native hashes. Whitespace, number-token spelling and source response page
layout are properties of those original files, not of a derived serialization.

## Integration boundary

`catalog.mjs` exports:

```js
buildPortableSceneCatalog({
  edition,          // original manifest: unchanged id, digest, capture and query
  items,            // original parsed STAC Features
  collections,      // original parsed STAC Collections
  receivedAssets,   // original receiver's selected asset outcomes
  sourceDelivery,   // original customer bundle/selection identity
})
```

Each asset outcome binds the original `collection`, `itemId` and `assetKey`.
`sourceHref`, when supplied, must equal the original Item's href. An optional
`editionId` must match the selected edition. The positive file descriptor is:

```js
{
  collection,
  itemId,
  assetKey,
  sourceHref,
  file: { path, bytes, sha256, contentType },
  outcome,
  reason,
  receivedAt,
  receipt
}
```

A missing file uses `file: null`; its original outcome and reason remain intact.
Paths are relative to the received directory that contains the explorer.
Repeated references to the same local file preserve the same size/hash.
An asset outcome outside the received scene subset remains in the inventory with
its exact binding instead of creating an invented scene.

The pure function returns `{manifest, model, files}`. Every `files` entry contains
`{path, contentType, body, bytes, sha256}`, where `body` is a Buffer. The existing
customer writer can retain those exact derived bytes. This pure boundary does
not read, copy, fetch, or write an original source or asset.

`explorer.mjs` exports `renderSceneExplorer(model)`. It accepts the complete model
returned by the projection and returns one standalone HTML string. All source
content is rendered as text. Only verified relative file references are used for
local previews, and source web links require an explicit user action.

## Export and reopen through the original delivery

`delivery.mjs` is the native adapter:

```js
import { StacDelivery } from '../customer.mjs';
import {
  projectStacDelivery,
  exportPortableStacDelivery,
  openPortableStacDelivery,
} from './delivery.mjs';

const delivery = await StacDelivery.open(receivedDirectory);
const saved = await exportPortableStacDelivery(delivery, portableDirectory, {
  progress: event => console.log(event.phase, event),
});
const reopened = await openPortableStacDelivery(saved.directory, {
  expectedManifestSha256: saved.manifestFile.sha256,
});
console.log(reopened.manifest.summary);
```

Use the original product CLI to obtain `receivedDirectory`; the example above
is an integration caller located beside this guide. An application can use the
same three exports directly. `projectStacDelivery` returns the pure projection
without writing a destination. It reads only an already opened original
`StacDelivery` and accepts `signal`, `progress` and the original `features`
metadata limit as `maxBytes`.

The adapter takes Collection objects directly from `delivery.edition.collections`
and untouched original Features from `delivery.features()`. Native asset identity
uses the original encoded Collection/Item key plus asset key. A local asset is
available only when that exact declared file also appears in `delivery.members()`.
Its location remains `edition/<original-member-path>` and its bytes/hash/MIME
must match the original selected file.

A captured asset omitted from the customer selection stays `NOT_ACQUIRED`.
A declared asset with no captured local file also stays unacquired. The original
provider's requester-pays, missing-storage-profile and non-public-HTTPS reasons
remain explicit `UNAVAILABLE` outcomes. The adapter does not call an unknown
download attempt a failure. Original capture records, acquisition reports,
selected native responses and source hashes remain in the original delivery.

`exportPortableStacDelivery` first calls the original `copyTo`. That copies
and verifies native files through the original receiver and supports resuming
already complete files. Only after its original bundle manifest is complete are
derived files retained through `stacRetain`. `scene-export.json` is written last.
Every fixed derived name is reserved, including this final manifest; no derived
file can replace an original received member. Repeating export resumes immutable
equal bytes. A different source identity or changed existing file is rejected
instead of being overwritten.

Progress events keep the original `receiving` phase and add `catalog`,
`portable-export` and `portable-open`. Byte and file progress refer to their
own phase; a projected scene count is never substituted for downloaded bytes.
The export result carries the source bundle/edition, generated paths, summary,
and exact final manifest path/byte count/SHA-256.

`openPortableStacDelivery` reopens and verifies the original customer bundle,
binds its edition/digest/selection/native identity to the portable manifest,
checks every derived file hash and confirms all advertised local assets against
the original selected files. Supplying `expectedManifestSha256` also checks
the exact manifest from the saved export receipt. The result exposes the
original delivery, a verified manifest file, `file(relativeDerivedPath)`,
`members()` and original `features()`. Opening, copying and rendering make
no merchant request, provider request, new signature or payment.

Keep the source edition and receiving receipt with an export when transferring
it. The standalone browser view displays the retained state; it cannot observe
later filesystem changes until the original APIs verify those files again.

## Original contracts and provenance

This module composes the project's original `StacDelivery.open`, `.features`,
`.members`, `.file` and `.copyTo` interfaces. It preserves the native SF88 dataset
and object receiving authorities and SF100 dataset delivery outputs. It adds no
second receiver, merchant, provider acquisition or edition store.

Source semantics were checked against the maintained first-party documents:

- [STAC Catalog specification](https://github.com/radiantearth/stac-spec/blob/master/catalog-spec/catalog-spec.md)
- [STAC Item specification](https://github.com/radiantearth/stac-spec/blob/master/item-spec/item-spec.md)
- [STAC Collection specification](https://github.com/radiantearth/stac-spec/blob/master/collection-spec/collection-spec.md)
- [STAC asset objects](https://github.com/radiantearth/stac-spec/blob/master/commons/assets.md)
- [Element84 Earth Search](https://element84.com/earth-search/)
- [Earth Search maintained source](https://github.com/Element84/earth-search)

The original API capture determines the actual STAC version, collection
metadata, pagination, query selection, asset availability and source rights for
each operation. Those facts are retained from the operation rather than inferred
from a generic catalog example.
