# CKAN editions, merchant releases, and customer handoff

This adapter turns a reviewed, retained CKAN DataStore edition into the existing
Starforge dataset product. The original publisher owns extraction, candidate
history, review, publication, recovery, and version changes. The merchant package
joins the original SF61 compiler and SF82 release manager. Customer configuration
comes from the actual running seller's offer through the original SF88 preparation.

## Source identity and projection

The [CKAN Action API](https://docs.ckan.org/en/2.11/api/) separates package and
resource metadata from [DataStore records](https://docs.ckan.org/en/2.12/maintaining/datastore.html).
The capture retains successful provider response bytes, field metadata, page
requests, and resource metadata before and after paging. The publisher binds its
plan to that retained capture. A refreshed capture is a new source edition.

Keep source field names and their meanings in the projection. Dataset column
aliases must follow the original dataset loader's identifier rules. For example,
a CKAN field named `Service Tier` can be exposed as `service_tier`; `_id`
can be exposed as `record_id`.

The source projection supports the original dataset scalar types: `string`,
`integer`, `number`, and `boolean`. Choose `native` encoding to preserve an
already compatible value, `text` for an explicitly reviewed scalar-to-text
conversion, or `json` to retain structured values as JSON text. Nullability is
explicit. The original CSV loader represents an empty nullable cell as null, so
a source containing both real empty strings and nulls needs a projection that
preserves that distinction, such as JSON text.

A real source used during development was
[Toronto's Library Branch General Information](https://open.toronto.ca/dataset/library-branch-general-information/):

| Identity | Retained value |
| --- | --- |
| CKAN origin | `https://ckan0.cf.opendata.inter.prod-toronto.ca` |
| Package | `f5aa9b07-da35-45e6-b31f-d6790eb9bd9b` |
| Active DataStore resource | `7420a950-e62b-41da-826c-32d31c46e8f8` |
| Capture date | 2026-10-11 |
| Capture manifest SHA-256 | `cd035b97e42e71a41f2499298a528bcdbfb7288676b5a5511d8983336a84e3ca` |
| Records and provider pages | 112 records; 50, 50, and 12 rows |
| Provider total | 112, with `total_was_estimated=false` |
| Physical branch flag | 100 rows with value 1; 12 rows with value 0 |

These values describe that captured edition. Retain a fresh provider capture when
preparing a new edition. The captured package's license metadata is carried into
the merchant package alongside the original publisher response.

Toronto Public Library's [Open Data page](https://tpl.ca/about-the-library/open-data/)
identifies this same Branch General Information dataset on the City portal. Its
[current Open Data Policy](https://tpl.ca/policies-and-terms-of-use/open-data/),
effective October 28, 2024, applies to library data provided through that portal
and identifies the Open Government Licence of Toronto Public Library. These
publisher references accompany the captured API metadata as source provenance.

## Open the existing publisher

Import `openCkanPublisher` from `./model.mjs`. Its options and returned methods
are the original `openSourceDatasetPublisher` interface:

```js
const publisher = await openCkanPublisher({
  directory: '/srv/starforge/library-publisher',
  create: true,
  sourceFile: '/srv/starforge/library-source.json',
  targetDirectory: '/srv/starforge/library-versions',
});
```

The source file uses `stellar-forge.ckan-source.v1`, the canonical catalog,
package and resource IDs, a `connection` of kind `capture` with its file and
manifest SHA-256, and named projection queries. Reopen with the existing publisher
directory and omit `create`.

The original methods provide the whole retained workflow:

| Method | Purpose |
| --- | --- |
| `source()` | Read the source digest, fields and named projections. |
| `savePlan(input)` | Retain the selected source, complete capture and dataset policy. |
| `startExtraction(planId).completion` | Produce the complete typed candidate and retained result. |
| `inspect(runId, query)` | Query the candidate through the original dataset engine. |
| `review(runId, input)` | Bind the displayed candidate to initialization or the current version. |
| `publish(runId, reviewId)` | Initialize or update the original dataset version store. |
| `recover(runId)` | Reconcile a retained candidate with the original publication outcome. |
| `close()` | Close the owned workspace and its active work. |

For the Toronto edition, an appropriate reviewed projection includes integer
`record_id` from `_id`, string `branch` from `BranchName`, string
`branch_code` from `BranchCode`, integer `physical_branch` from
`PhysicalBranch`, and string `service_tier` from `Service Tier`.
`Address` and `WardName` contain nulls, so their corresponding aliases should
be nullable. Coordinate and area fields are text in this provider's response;
review any conversion explicitly.

The plan's `dataset.columns` must use the same types as its projection.
`filters`, `ranges`, `sorts`, limits, and extraction ordering use the
[original dataset policy](../../DATASET_API.md). A useful initial policy enables
equality on `physical_branch` and `service_tier`, and sorting on `branch`.
The actual query `where_physical_branch=1` selects the 100 fixed locations in
the captured Toronto edition.

The adapter retains all provider files when a plan is saved. Editing or removing
the original acquisition directory afterward does not remove the saved plan's
source. Each candidate continues to carry its source digest, capture digest,
projection, extraction ordering, CSV digest and original dataset snapshot.

## Command and browser interface

The adapter's `cli.mjs` delegates to the maintained publisher command, including
its browser workspace:

```sh
node sf30-seller-sdk/ckan/publisher/cli.mjs init \
  --workspace /srv/starforge/library-publisher \
  --source /srv/starforge/library-source.json \
  --state /srv/starforge/library-versions

node sf30-seller-sdk/ckan/publisher/cli.mjs serve \
  --workspace /srv/starforge/library-publisher --port 8456
```

Run commands from the SCF source directory or use the corresponding installed
distribution command. A publisher workspace has one owner at a time. Close its
browser process before opening the same workspace from the CLI. For individual
source, plan, extraction, review and publication commands, `--help` displays the
original interface. The template command starts with string columns; update its
column types to match the actual reviewed CKAN projection before saving it.

## Export a complete merchant package

Import `exportCkanMerchantPackage` from `./release.mjs`:

```js
const exported = await exportCkanMerchantPackage({
  publisher,
  runId,
  directory: '/srv/starforge/library-merchant-edition',
  expectedCandidateDigest: inspected.run.data.candidate.candidateDigest,
  payment: publicPaymentTerms,
  origin: 'https://your-existing-merchant.example',
  path: '/library-branches',
});
```

The candidate must have its current recorded review. `payment` uses the original
public SF30 fields: `scheme`, `network`, `asset`, `amount`, `payTo`, and
`maxTimeoutSeconds`. The original compiler validates these terms and the
complete route before the new export directory is written.

The result contains `directory`, `manifestSha256`, `handlerSha256`,
`resource`, `dataset`, `capture`, and the exported file count. Retain the
manifest digest with the selected package.

The package contains:

- The original package/resource responses and every captured DataStore page.
- The rewritten portable source configuration, original source bytes, reviewed
  plan, candidate and review.
- The typed CSV and original dataset configuration.
- OpenAPI, explicit payment selections and original handler bindings.
- A byte-identical copy of the dependency-free original dataset loader.
- The small edition-selection adapter, generated handler entry and package manifest.

The generated handler imports adjacent retained runtime files. It verifies its
runtime and package identity before opening the dataset. It uses the original
dataset admission and query methods for filtering, ranges, ordering, byte limits
and cursor behavior. An optional `snapshot` parameter selects the package's
exact dataset snapshot; a different snapshot receives the original
`DATASET_SNAPSHOT_CHANGED` response before the application runs.

`inspectCkanMerchantPackage(directory, expectedManifestSha256)` reopens that
package and verifies the declared source, runtime and dataset files.

## Stage, run, and manage through SF82

Initialize the original release store once:

```sh
node sf82-seller-pilot/release-cli.mjs init --store /srv/starforge/library-releases
```

Stage the complete exported edition:

```js
const staged = await stageCkanMerchantRelease('/srv/starforge/library-releases', {
  packageDirectory: exported.directory,
  expectedManifestSha256: exported.manifestSha256,
  id: 'library-20261011',
  label: 'Toronto library locations — captured 2026-10-11',
  runtime: { port: 8423 },
});
```

The helper first copies the entire verified edition to
`RELEASE_STORE/ckan-packages/MANIFEST_SHA256`. It then calls original
`stageRelease` with the retained OpenAPI, selections, bindings and handler.
All application data and runtime imports resolve inside that retained package.
The acquisition workspace and export's original location can be archived without
changing the staged release.

The return value includes the original `release`, durable `packageDirectory`,
`manifestSha256`, resource, dataset and source metadata. Additional runtime
options, including the existing facilitator configuration, follow SF82's
validation. The package owns its handler binding.

Use the original SF82 console to compare editions, activate, start, stop,
roll back, configure discovery, and generate the original customer handover:

```sh
node sf82-seller-pilot/release-cli.mjs console \
  --store /srv/starforge/library-releases --port 8425
```

See the [release guide](../../../sf82-seller-pilot/RELEASES.md) and
[customer handover guide](../../../sf82-seller-pilot/CLIENT_HANDOVER.md).
A refreshed CKAN capture produces a new package and release. The existing
release manager continues to own process lifetime and selection.

## Prepare the actual customer request

After the original seller is running, use its actual local listener and the
retained staged package:

```js
const buyerSource = {
  packageDirectory: staged.packageDirectory,
  expectedManifestSha256: staged.manifestSha256,
  seller: runningSeller.url,
  query: 'where_physical_branch=1&sort=branch&limit=50',
};
const offer = await readCkanMerchantBuyerOffer(buyerSource);

const prepared = await prepareCkanMerchantBuyer({
  ...buyerSource,
  intentId: 'library-locations-20261011-001',
  acceptIndex: 0,
  offerSha256: offer.offerSha256,
  out: '/srv/starforge/library-buyer.json',
});
```

The offer method reads the original seller's health and offers endpoints,
verifies its resource and snapshot selection, and returns current payment
alternatives and their digest. Preparation reloads the same offer, checks the
selected digest, and calls the original `prepareDatasetBuyer` /
`prepareReview` path. Its result is the original SF88 configuration with the
exact edition and query in the resource URL. Omit `out` when the operator
workspace will download the returned `configText`.

Continue in the [existing buyer workspace](../../../sf88-operator-buyer-cli/README.md)
for the buyer's account, signer, spend policy, delivery file, execution and
reopening. The original customer library retains acquired dataset pages.
Keep `page.nextCursor` unchanged when requesting the next page with the same
field selection, filters, order and snapshot.
