# Publish and receive a reviewed repository dataset

This adapter takes an approved edition from the repository workspace into the
existing SF30 dataset service, SF82 release, SF88 acquisition and SF100 customer
data room. The original engines retain the typed query, snapshot cursor,
payment terms, approval, request identity, version history and response files.

The repository source stays attached to the product: a merchant package retains
the exact source capture bytes, selected native UUIDs and variants, complete
metadata value arrays, projection configuration, named review and attribution.
Each customer delivery identifies the edition and includes the original buyer
pages, typed JSONL, CSV, review page and source lineage.

## Installed and source entrypoints

The maintained source package exposes the same commands after a local install:

```sh
npm install --offline --ignore-scripts --no-audit --no-fund /absolute/starforge-source.tgz
npx --no-install starforge dspace --help
npx --no-install starforge dspace-workspace --directory /private/repository-operator \
  --workspace /private/repository-workspace --port 0
```

Run the commands below from that installation directory. A source checkout can
invoke the same CLI with `node stellar/scf-starforge-20261009/sf30-seller-sdk/dspace/cli.mjs`.
The package includes the original merchant, version, buyer and delivery engines.

## Prepare a merchant

Use Node 24+ on the same Linux host as the private repository workspace. The
source importer and publisher do not need the upstream DSpace MCP server.
Customers continue to use the existing repository credentials and source
capture process when collecting another edition.

Create an edition in the workspace, review its native fields and intended
distribution, then select its exact approval. Read the retained identities:

```sh
npx --no-install starforge dspace state --workspace /private/repository-workspace
npx --no-install starforge dspace read --workspace /private/repository-workspace \
  --kind editions --id EDITION_ID --offset 0 --limit 50
```

The merchant preparation requires the edition ID, its SHA256 and the named
approval ID. If a subsequent review requests changes, update the edition and
review it before preparing its merchant package.

Supply the merchant's already agreed public payment terms in a separate JSON
file. Its keys follow the original SF30 contract: scheme, network, asset,
amount, payTo and optional maxTimeoutSeconds. Amount is an atomic-unit string.
The configured public origin is the merchant's actual HTTPS origin.

```sh
npx --no-install starforge dspace merchant prepare \
  --workspace /private/repository-workspace \
  --edition EDITION_ID --edition-sha EDITION_SHA256 --review REVIEW_ID \
  --package /private/repository-package \
  --versions /private/repository-versions \
  --payment /private/public-payment-terms.json \
  --origin https://data.institution.example --path /repository-data
```

Choose separate private directories for the original workspace, package and
version store. The immutable preparation retains its inputs before files are
written. Repeating the same command at the same package path completes matching
files and refuses changed inputs.

The prepared package uses the original SF82 files:

| File | Purpose |
| --- | --- |
| dataset.csv | Exact CSV bytes generated from the reviewed original objects. |
| dataset.json | Original SF30 typed columns, filters, ranges, sorts and page limits. |
| seller.json | Reviewed HTTPS resource and public payment terms. |
| source.json | Exact edition, review, source identities and complete provenance index. |
| binding.json | Original version-store path, field contract, baseline snapshot and source digest. |
| repository/ | Original dataset export, full edition and review, and complete source captures. |

The native capture may contain metadata or files beyond the selected edition.
The merchant retains that original capture for reproducibility; ordinary buyer
receiving includes its identity and attribution. Include complete source
captures in a customer handoff only when that complete source is part of the
agreed delivery.

## Start, publish and retain editions

For local operation, start the original SF82 dataset release:

```sh
npx --no-install starforge dspace merchant serve \
  --package /private/repository-package --stage /private/repository-stage
```

The result contains the real loopback URL, current native version and service
mode. The default original seller returns its offer and payment challenge. An
operator can supply the original runtime JSON with port and facilitator
settings to run its configured native payment service.

The original service endpoints expose its live health, offers and documentation:
`/_seller/health`, `/_seller/offers` and `/_seller/docs`. The resource and
payment identity remain the configured public HTTPS values.

To publish a corrected or later source, import the actual new capture, save a
successor edition and review it. Keep the same field contract, dataset name and
public terms for a refresh of the existing version store. Prepare the successor
into another immutable package directory, pointing at that original version
store.

```sh
npx --no-install starforge dspace merchant status --versions /private/repository-versions
npx --no-install starforge dspace merchant publish --package /private/repository-package-v2 \
  --expect CURRENT_SNAPSHOT_SHA256 --expect-revision CURRENT_REVISION
```

Publication delegates to the running original writer's compare-and-swap. Existing
buyers continue their pinned retained snapshot. A repeated request whose exact
snapshot is already current returns that observed state. The workspace's
`record-publication` action can retain the actual returned publication result
alongside the original edition.

To reselect a retained native edition:

```sh
npx --no-install starforge dspace merchant activate --versions /private/repository-versions \
  --snapshot RETAINED_SNAPSHOT --expect CURRENT_SNAPSHOT --expect-revision CURRENT_REVISION
```

The original SF82 supervised release store is also available through
`merchant stage`, `release-activate`, `release-rollback` and `release-run`.
Those commands keep original release IDs, generation reviews, restart and
rollback. Use `starforge dspace --help` for their exact inputs.

## Prepare the original customer

Load the actual running merchant's offer and select the original query fields,
filters and page limit. Query JSON contains string values, such as:

```json
{"fields":"item_uuid,item_name,metadata_json,source_sha256,source_url","limit":"20"}
```

Metadata JSON cells preserve arrays, language, authority, confidence, place and
additional native value properties. In metadata-values mode, each row retains
the original field and ordinal and complete properties_json. A null value
remains distinct from an empty string.

```sh
npx --no-install starforge dspace buyer offer \
  --package /private/repository-package --seller http://127.0.0.1:PORT \
  --query /private/repository-query.json
```

The offer result shows the exact current payment alternatives, offer digest and
approved dataset snapshot. Select the displayed alternative and prepare the
original buyer configuration:

```sh
npx --no-install starforge dspace buyer prepare \
  --package /private/repository-package --seller http://127.0.0.1:PORT \
  --query /private/repository-query.json --intent ORIGINAL_CUSTOMER_INTENT \
  --accept-index 0 --offer-sha DISPLAYED_OFFER_SHA256 \
  --out /private/repository-buyer.json
```

This produces the original SF88 draft and an adjacent repository selection
record. Configure the customer's existing operator workspace, signer and shared
budget with its normal setup. Initialize the acquisition with that workspace,
or with its complete original configuration:

```sh
npx --no-install starforge dspace buyer init --session /private/repository-purchase \
  --workspace /private/original-buyer-workspace \
  --max-pages 100 --max-total-atomic AGREED_TOTAL_CAP
npx --no-install starforge dspace buyer run --session /private/repository-purchase
```

Each new page uses the original buyer's actual quote approval and reservation.
A stop between pages resumes from complete retained files. The original attempt,
response and checkout evidence determine recovery after interruption. Use
`buyer status`, `recover`, `accounting` and `finalize` on that same session.

The snapshot selector comes from the approved edition. A query may choose
fields, equality or range filters and one advertised sort, but it cannot replace
the original merchant URL, asset, recipient or request identity.

## Complete customer receiving

After the original acquisition is complete:

```sh
npx --no-install starforge dspace buyer receive \
  --package /private/repository-package \
  --session /private/repository-purchase \
  --out /private/repository-customer-delivery
npx --no-install starforge dspace buyer inspect-delivery \
  --directory /private/repository-customer-delivery
```

The resulting directory contains:

- `dataset/dataset.csv`, `dataset/dataset.jsonl` and `dataset/review.html`.
- The original SF100 session, complete page archive and manifest.
- `dspace-lineage.json`, which binds the acquisition, named edition review,
  exact source identities, rights and original exporter.
- `delivery.json`, with exact portable file hashes and the observed native
  buyer and payment statuses.

Receiving delegates data-room creation to SF88/SF100 and verifies the original
page chain on reopen. Repeating it preserves the same files. The original buyer
classification and accounting result remain attached to the received pages.

Add `--include-source-captures` when the agreed delivery includes the complete
reviewed provenance. That also copies the original capture bytes, edition,
review and reproducible original projection under `source/`. Every member is
verified against the existing SF82 source closure while copying.

## Move the operating workspace

Export the complete repository project from the browser or CLI:

```sh
npx --no-install starforge dspace export --workspace /private/repository-workspace \
  --kind project --out /private/Repository_Datasets.sqlite3
npx --no-install starforge dspace receive --file /private/Repository_Datasets.sqlite3 \
  --workspace /private/received-repository-workspace
```

The receiver validates the original records, source bytes, metadata projection
and operation identities and publishes the new local database only after the
whole project is ready. Repeating receiving opens its original workspace,
including any later local decisions.

For a different merchant host, prepare a new immutable release from that
received reviewed edition with the destination host's own version-store path.
The original source/edition stays identical; the explicitly selected local
deployment binding changes. This avoids embedding the former host's private
directory into a new installation.

## Source and implementation

The source format is the retained `dspace-source-capture/v1` produced by the
maintained repository workspace. Native HTTP facts, exact body bytes, UUIDs,
metadata arrays, original files and provider-extracted source labels remain in
that capture. The parser accepts original JSON text and canonical base64 bodies.

The DSpace integration core and these merchant/customer modules are MIT. They
consume saved repository source data and use the maintained SCF engines. The
upstream DSpace MCP client retains its own license and separate installation.

Original operator contracts:
[SF30 datasets](../README.md),
[versioned publication](../dataset-refresh/WORKSPACE.md),
[SF82 releases](../../sf82-seller-pilot/README.md),
[SF88 acquisition](../../sf88-operator-buyer-cli/DATASETS.md),
[SF100 delivery](../../sf100-buyer-dataset-delivery/README.md).

The retained demonstration uses the actual DSpace public sandbox source and its
explicit internal demonstration review. An institution's commercial edition
uses its own reviewed data and distribution basis.

## Completed native receiving

The retained 12 October 2026 run used the complete Publications 2 capture and
its linked Person: 45 actual repository objects, 1,230 metadata values and 85
authors on the first publication. Its exact approved snapshot was
`c595fda0e17f62433e2b967d1421892dfbc97a8a3b3d63cd0c3cd33d3a892954`.

The original SF82 merchant prepared all seven source files (1,317,106 bytes)
and exposed its original offer. The SF88 customer retained two pages containing
14 records, then the merchant published a reviewed 44-record successor through
the original version writer. The customer resumed its original snapshot to all
seven pages and 45 records. Recovery rebuilt a missing derived result from the
existing original response and checkout evidence. All rows and metadata arrays
matched the approved edition.

The resulting native SF100 data room contains 21 checked files and 2,043,408
bytes, including original pages, source captures, full edition and review. Its
manifest digest is `370dd432dbd2813ad0b93c3b5e963c78561b15d55495f7ae9da5f922d33d675e`.
The running merchant then closed, reopened its successor and reselected the
retained original edition; the portable customer page chain reopened intact.
The demonstration HTTP pages carry the original `NO_PAYMENT_REQUIRED` outcome.

`native/merchant-customer-journey.mjs` retains this entire operation, including
continuation from its saved progress and original workspace action IDs. Run it
with `--workspace`, `--out`, `--demo-payment`, `--edition` and `--review`; the
output directory receives `MERCHANT_CUSTOMER_RESULT.json` and the complete
customer data room. Each run uses the reviewed source edition and its original
explicit source rights. The retained example terms are the existing local
SF30 demonstration configuration.
