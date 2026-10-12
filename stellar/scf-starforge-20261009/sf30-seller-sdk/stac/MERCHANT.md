# STAC merchant and customer operations

One retained STAC edition becomes an existing Starforge merchant and customer
workflow. The merchant serves its scene dataset, exact edition manifest, source
records and captured assets. The customer retains its selection, acquires the
original pages and files, builds the original SF100 data room, and exports a
receiving directory that opens offline.

The original SF30 seller, SF61 offers, SF82 lifecycle, SF88 operator, Dataset and
Object buyers, and SF100 delivery remain the execution engines. The application
adds the STAC selection, collection-aware scene association, local file handler
and portable handoff. Original policy, approval, signer, attempt records,
recovery and financial accounting remain in those engines.

## Source and installed entry points

Use the existing STAC CLI from a checkout:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/stac/cli.mjs COMMAND ...
~~~

In the installed distribution, use the same path below the package source
directory:

~~~sh
node /ABS_INSTALL/node_modules/@tokenjunkielabs/starforge-merchant/source/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/cli.mjs customer-open --directory /srv/stac/receiving
~~~

Both forward commercial commands to
[runStacCommercialCommand](customer.mjs). The wrapper loads explicit local JSON
files. Operator profiles and buyer configuration stay in the private customer;
the analyst browser keeps its ordinary workspace state.

All directory arguments are absolute. Use separate directories for the
original edition, merchant, private customer and receiving bundle. Export the
actual reviewed edition through the existing workspace:

~~~js
const exported = await workspace.exportEdition({
  editionId: reviewedEditionId,
  directory: '/srv/stac/edition'
});
~~~

The workspace owns the upstream catalog, collections, search pages and selected
asset requests. Merchant staging and customer acquisition do not repeat them.

## Prepare and start the merchant

The payment JSON contains the operator's reviewed original public terms:
scheme, network, asset, amount, payTo and maxTimeoutSeconds. The original native
seller validates those terms.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/stac/cli.mjs merchant-stage \
  --edition /srv/stac/edition \
  --directory /srv/stac/merchant \
  --origin https://YOUR-MERCHANT-HOST \
  --path /stac \
  --payment /srv/private/stac-payment.json
~~~

Staging streams size and SHA-256 verification for every declared edition file.
It loads scenes.csv through the original typed CSV dataset, retains its
snapshot and native configuration, and runs the original SF61 compiler. The
merchant directory holds merchant-inputs/, merchant/ compiler output,
dataset.json and the immutable merchant-plan.json.

The scene dataset exposes item_key, collection, item_id, datetime,
start_datetime, end_datetime, cloud_cover, platform, constellation,
geometry_json, properties_json, assets_json, links_json, decision_status and
decision_note. Cloud cover is a nullable number. The other fields are strings
with declared nullability; dates remain original strings. Native filters,
ranges, ordering and paging operate on this projection. Full original Features
remain in items.geojson.

| Native route | Behavior |
|---|---|
| .../scenes | Original snapshot-bound dataset query and pagination |
| .../edition | Exact retained manifest.json bytes |
| .../files/{fileId} | Declared file selected by the SHA-256 of its relative path |

The original SF61 importer compiles the dynamic template. The original SF30
compileSellerRoutes, selectServiceRoute and materializeSellerRequestOffer
resolve its concrete request before original SF88 prepareReview. The original
offer-file hash and concrete request hash are retained separately.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/stac/cli.mjs merchant-serve \
  --directory /srv/stac/merchant \
  --port 8423 \
  --facilitator https://YOUR-FACILITATOR
~~~

For an existing loopback facilitator, use its http://127.0.0.1:PORT URL and add
--allow-local-facilitator. --challenge-only selects the original challenge
mode. An embedding application can supply its existing nativeFactory to
startStacMerchant instead. These modes are mutually exclusive.
SIGINT/SIGTERM drain the native listener through its original close handling.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/stac/cli.mjs merchant-status \
  --directory /srv/stac/merchant
~~~

Status and normal restart use the original SF82 package. Repeating identical
staging reopens the same package. Another source edition, public origin or
payment selection requires a separate merchant directory.

## Configure the original buyer

The explicit --buyer-config JSON is passed to the original Buyer constructor:

~~~json
{
  "runtimeDirectory": "/ABS_INSTALL/node_modules/@tokenjunkielabs/starforge-merchant/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli",
  "stateDirectory": "/srv/private/stac-native-buyer",
  "operatorProfile": "/srv/private/original-operator-profile.json"
}
~~~

Use the deployment's existing operator profile. The original Buyer applies its
policy, signer, trusted payer and supported transport settings. The commercial
wrapper does not create or print credentials or an approval substitute.

Reopen a private customer with that same Buyer state and runtime. Portable
receiving needs only the receiving directory and installed source, so it can
move to another machine.

## Select the query, files and total cap

The optional query JSON contains original string-valued dataset parameters.
An empty object uses all columns and the default page size. Native filters,
ranges, sort, limit and fields retain their original semantics. A projected
field list must contain item_key so each acquired row can be joined to its
original Feature. The first request and all native cursors retain the selected
dataset snapshot.

The optional files JSON is an array of exact manifest-relative paths. Without
--files, the customer acquires every non-asset source member. To receive assets,
include their declared paths along with the desired source members. Every
selection includes the original item document at edition.paths.items.

This derives an explicit selection from the actual edition:

~~~js
import {readStacEdition} from './merchant.mjs';
const {manifest} = await readStacEdition('/srv/stac/edition');
const assetPaths = new Set(manifest.assets.map(asset => asset.path));
const files = [
  ...manifest.files.filter(file => !assetPaths.has(file.path)).map(file => file.path),
  ...manifest.assets.filter(asset => asset.assetKey === 'thumbnail').map(asset => asset.path)
];
// Save the selected array to the explicit --files JSON path.
~~~

The required total cap covers the complete proposed native acquisition:

| Part | Reserved maximum |
|---|---|
| Edition manifest | One original maximum payment |
| Dataset | maxPages multiplied by the original page maximum |
| Each member up to 1 MiB | One original maximum payment |
| Each larger member | ceil(bytes / chunkBytes) multiplied by the original chunk maximum |

The application adds these in exact integer atomic units before a purchase,
rejects a plan above the user's declared total, and passes the individual caps
to the original acquisition engines. The plan uses the one reviewed merchant
payment unit. Native reports retain actual financial outcomes independently.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/stac/cli.mjs customer-create \
  --directory /srv/private/stac-customer \
  --merchant /srv/stac/merchant \
  --id reviewed-stac-edition \
  --buyer-config /srv/private/stac-buyer.json \
  --query /srv/private/stac-query.json \
  --files /srv/private/stac-files.json \
  --max-pages 20 \
  --max-total-atomic REVIEWED_TOTAL_IN_ATOMIC_UNITS \
  --chunk-bytes 1048576
~~~

Creation retains the complete public selection and exact native preparations.
It acquires no pages or files. The printed selection contains actual caps,
content hashes, source, offer and concrete request identities. Reopening the
private customer subsequently needs no merchant source directory.

## Acquire, inspect, recover and deliver

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/stac/cli.mjs customer-run \
  --directory /srv/private/stac-customer \
  --buyer-config /srv/private/stac-buyer.json

node stellar/scf-starforge-20261009/sf30-seller-sdk/stac/cli.mjs customer-inspect \
  --directory /srv/private/stac-customer \
  --buyer-config /srv/private/stac-buyer.json
~~~

Acquisition first receives the exact manifest through the original Buyer and
validates its identity, then runs the original Dataset buyer and selected
member buyers. Small files use an original one-shot Buyer operation. Larger
files use the original explicit Object plan, native chunk session and full
object hash verification.

Inspection returns the original dataset, operation and object reports. Their
financial states are not combined into a new payment status. Complete saved
response bytes remain associated with the unchanged original result record.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/stac/cli.mjs customer-recover \
  --directory /srv/private/stac-customer \
  --buyer-config /srv/private/stac-buyer.json
~~~

Recovery invokes native recovery and reads original saved results. It obtains
no new pages or chunks. An explicit subsequent customer-run continues through
the same native IDs and attempt records. A marked one-shot operation is not
replayed. Original operator recovery cases retain their existing evidence.

A host can pass an AbortSignal to run() and receive phase/member progress.
Original Dataset/Object inspection provides their existing native progress.
Cancellation leaves the original acquisition available for recovery.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/stac/cli.mjs customer-deliver \
  --directory /srv/private/stac-customer \
  --buyer-config /srv/private/stac-buyer.json \
  --out /srv/stac/receiving
~~~

Delivery uses original SF100 output and Object assembly, retains the first
complete original acquisition/delivery records, and copies actual saved
response bytes. It publishes the receiving manifest after all outputs.
Repeating delivery reopens the same bundle. An interrupted copy verifies and
reuses its already copied files.

Another source edition uses an explicit new customer selection and ID. The old
customer and its original snapshot remain independently reopenable.

## Offline receiving and original Features

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/stac/cli.mjs customer-open \
  --directory /srv/stac/receiving
~~~

~~~js
import {StacDelivery} from './customer.mjs';

const delivery = await StacDelivery.open('/srv/stac/receiving');
for await (const row of delivery.rows()) {
  // Actual acquired query rows with original native scalar types.
}
for await (const feature of delivery.features()) {
  // Complete original Feature, with geometry, properties, assets,
  // extensions, links and all its other retained fields.
}
console.log(delivery.members());
await delivery.file('ORIGINAL_DECLARED_ASSET_PATH').saveAs('/srv/export/asset.bin');
await delivery.copyTo('/srv/stac/receiving-copy');
~~~

rows() and features() are async iterators. Features follow the acquired query's
order and selection. Their keys are encodeURIComponent(collection) + '/' +
encodeURIComponent(nativeId). The reader compares the acquired JSON projection
to the original Feature, preserving its complete content.

The full-Feature JSON reader supports a configurable ceiling up to 256 MiB.
The original item document also has the verified file/chunk interface for
applications processing larger source documents.

| Bundle member | Retained content |
|---|---|
| selection.json | Original edition, query, files, concrete requests and cap identities |
| native-bindings.json | Original preparation and initialized native config/session joins |
| native/dataset-acquisition.json | Unchanged original COMPLETE acquisition report |
| native/dataset-delivery.json | Unchanged original SF88/SF100 delivery report |
| native/ID.json | Unchanged original Buyer or Object delivery records |
| dataset/ | Original dataset.jsonl, dataset.csv, review.html and manifest.json |
| edition/manifest.json | Exact purchased edition manifest |
| edition/ORIGINAL_MEMBER | Actual purchased source and selected asset bytes |
| manifest.json | Full receiving file sizes/hashes and bundle identity, published last |

The original COMPLETE acquisition supplies the config hash, session ID,
snapshot and selected result count. The delivery retains the original
sourceDirectory and sourceBindingSha256. The receiving reader joins these
before opening the original file readers.

Native reports preserve their original absolute paths. pathMapping exposes the
separate local file resolution used after a copy. Original financial states
and source bindings remain in native; relocation does not imply an acquisition.

The original edition can reference assets this customer did not select.
members() lists files actually received, and file() opens only those files.
Original license metadata, provider citations, asset roles/type and scale/
offset remain in the manifest, original source records and Features.
Redistribution follows the operator's reviewed rights and deployment.

## Large asset delivery

The merchant supports retained files up to 2 GiB. It hashes each source during
startup, records its exact file identity, and reads at most 1 MiB per request.
Metadata is checked before and after each read. It does not keep an open
descriptor for every edition member or buffer a whole raster per request.

For a file up to 1 MiB, a request with no query returns its exact complete bytes
with HTTP 200. Larger files require the original offset and length query.
Chunk responses use HTTP 206 and these established native headers:

| Header | Identity |
|---|---|
| Content-Range | Exact returned window and complete file length |
| X-Content-SHA256 | SHA-256 of this returned chunk |
| X-SF30-Object-Snapshot | Immutable selected file snapshot |
| X-SF30-Object-Bytes | Total original file size |
| Content-Type | Selected normalized transport MIME |

The original Object plan separately pins the complete file hash and verifies
it during assembly. Range and conditional headers use original asset admission;
this application uses the original object's offset/length query protocol.
These are retained local files and use no S3 descriptor.

## Embedded native journey

[examples/native-merchant-customer.mjs](examples/native-merchant-customer.mjs)
exports runNativeMerchantCustomer(). It accepts the actual exported edition,
the existing native merchant factory or facilitator, and an original Buyer or
createBuyer({session,staged}) callback. The callback lets the host configure its
original approved transport after the listener chooses a port.

The example stages and starts the merchant, acquires the original dataset and
selected files, delivers, closes the merchant, opens receiving offline, and
optionally copies it. It returns actual scene count, asset descriptors and
original native records. It does not query the upstream provider or create
an operator profile.

Source contracts: [seller routing](../resource-server.mjs),
[SF61 dynamic routes](../../sf61-openapi-seller-import/DYNAMIC-ROUTES.md),
[buyer preparation](../../sf88-operator-buyer-cli/prepare.mjs),
[Dataset](../../sf88-operator-buyer-cli/node/dataset.mjs),
[Object](../../sf88-operator-buyer-cli/node/object.mjs),
[object session](../../sf88-operator-buyer-cli/object-session.mjs),
and [dataset delivery](../../sf88-operator-buyer-cli/dataset-delivery.mjs).
