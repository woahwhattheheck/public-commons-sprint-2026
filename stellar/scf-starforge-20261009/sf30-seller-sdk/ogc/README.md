# Geospatial sources → the existing Starforge dataset merchant

This is the original SF30 dataset merchant's geospatial intake, available through
`starforge dataset ogc`. It discovers an OGC API Features collection, follows its
native pagination, retains its source, lets an operator review explicit field
projections, and exports an immutable dataset that the existing SF30 query
workspace, seller service, version publisher and buyer tools already understand.

The source implementation is `sf30-seller-sdk/ogc/`; `dataset-cli.mjs` delegates its
`ogc` subcommand here. There is one original CSV query engine and one original
seller compiler. Capture and export reuse the existing SF30 PostgreSQL publisher's
private-file primitives and kernel-owned `flock` lease. Node 22.16+ and Linux with
util-linux `flock` are required. No dependency installation is needed for intake,
review, native dataset queries or native payment-challenge operation.

## Operate a collection

Use the maintained `starforge` command, or replace `starforge dataset ogc` with
`node /absolute/path/to/sf30-seller-sdk/dataset-cli.mjs ogc` from source.

```sh
umask 077
WORK="$HOME/starforge-geospatial"
mkdir -p "$WORK"
chmod 700 "$WORK"

starforge dataset ogc discover \
  --url https://demo.ldproxy.net/daraa/ --out "$WORK/discovery.json"
starforge dataset ogc select \
  --discovery "$WORK/discovery.json" --collection AeronauticCrv \
  --name "Daraa aeronautic features" --limit 1000 --out "$WORK/source.json"
starforge dataset ogc capture \
  --state "$WORK/capture" --config "$WORK/source.json"
starforge dataset ogc inspect --state "$WORK/capture"
starforge dataset ogc review --state "$WORK/capture" --out "$WORK/review.html"
```

`select` chooses the collection's advertised JSON items link. Optional `--bbox`
(four or six coordinates) and `--datetime` apply explicit source filters; `--limit`
chooses the requested page size. These options affect the initial selection only.
Later requests use the source's returned `rel=next` URLs unchanged, including
opaque continuation values. A short page or an empty page with a next link does
not end the traversal. No offset arithmetic or guessed `/items` path is used.

Open `review.html` in a trusted local browser. It works without external scripts,
styles, fonts, maps or network access. Choose published properties, names, native
types, nullability, equality/range/sort capabilities and page limits. Inspect the
retained examples, then **Save reviewed plan**. The review checks the original
query-parameter budget and exposes empty-string/null behavior before export.
Reopen an existing plan to preserve its column order and its source binding;
multiple projections of a source property are supported when importing a plan.

```sh
starforge dataset ogc export --state "$WORK/capture" \
  --plan "$WORK/reviewed-plan.json" --out "$WORK/edition-001"
starforge dataset-workspace --dataset "$WORK/edition-001/dataset.json"
```

The second command opens the ORIGINAL query workspace over the completed dataset.
Its original filtering, ranges, sorting, projection, stable continuation cursors
and request export remain available. Every captured feature becomes one CSV row,
including features without IDs and repeated IDs; intake does not deduplicate or
silently skip source features. The source review reports these observations and
all provider `numberMatched` values separately from the retained row count.

## Prepare and run the original seller

Add the operator's public payment terms and canonical HTTPS resource origin when
creating a **new** edition. The payment file contains only `scheme`, `network`,
`asset`, `amount`, `payTo` and `maxTimeoutSeconds`; `amount` remains an atomic-unit
string. The existing SF30 compiler validates those terms.

```sh
starforge dataset ogc export --state "$WORK/capture" \
  --plan "$WORK/reviewed-plan.json" --out "$WORK/seller-edition-001" \
  --payment "$WORK/public-payment-terms.json" --origin https://merchant.example \
  --path /geospatial

export SF30_DATASET_CONFIG="$WORK/seller-edition-001/dataset.json"
# SF30 is the absolute sf30-seller-sdk directory in the maintained source package.
node "$SF30/serve.mjs" --config "$WORK/seller-edition-001/seller.json" \
  --handlers "$SF30/examples/dataset-application.mjs"
```

Use the original facilitator configuration, release lifecycle and seller
operations for paid delivery. The original service exposes its developer explorer
and OpenAPI document. Its usual local challenge-only startup is useful for
reviewing the actual compiled offers before operating a configured facilitator.
Existing version publication consumes the exported `dataset.json` directly; the
source adapter does not introduce another publisher or another payment protocol.

## Types, geometry and source rights

A plan uses the schema `stellar-forge.ogc-plan.v1` and the `sourceId` printed by
inspection. Its `columns` array gives output order. Each column has `name`,
`pointer`, `type`, `nullable` and `format`. Source pointers are RFC 6901 JSON
pointers, for example `/id`, `/properties/category`, `/properties/a~1b` or
`/geometry`; nested properties are supported.

`format: scalar` admits strings, JSON numeric tokens and booleans. `type: string`
preserves a numeric token exactly, including large IDs, exponents and decimal
text. `integer` requires a safe native integer. `number` uses the original native
IEEE-754 number type; use string for exact decimal values. `format: json` with
`type: string` preserves structured arrays/objects, including geometry and their
original numeric tokens. It also distinguishes JSON-encoded empty text (`""`)
from an empty nullable CSV field when a source string needs that representation.

The explicit plan setting `nullEmptyPolicy: native-empty-is-null` acknowledges the
existing CSV representation: missing, null and empty text become null in nullable
columns. A non-nullable string retains empty text. See [DATASET_API.md](../DATASET_API.md)
for the native query types, null ordering, capability limits and response limits.

OGC Core GeoJSON uses longitude/latitude coordinates; accepted explicit CRS
headers are CRS84 and CRS84h. Coordinates are retained rather than reprojected.
A direct standalone GeoJSON source can set `kind: geojson` and an explicit
`coordinateDescription` to retain provider-specific vertical units/signs. The
review displays that description instead of assigning an assumed height meaning.
For example, a provider documenting depth in kilometres must retain that meaning.
Collection links and an optional operator `license` note travel with the source;
review the selected provider's attribution and redistribution terms for the
intended data product.

The primary protocol contract is [OGC API Features Part 1, Core 1.0.1](https://docs.ogc.org/is/17-069r4/17-069r4.html),
particularly collection links, `bbox`, `datetime`, `limit`, returned counts and
`next` links. The [official OGC workshop](https://ogcapi-workshop.ogc.org/api-deep-dive/features/)
uses the Daraa collection in the command example above. This intake supports the
Core GeoJSON read path, not an implicit coordinate conversion or spatial-query
engine. Spatial filtering is selected at the source; the exported native dataset
serves its explicit typed columns and retained geometry.

## Continue, recover and move work

Repeat `capture --state DIRECTORY` after interruption or an HTTP failure. Completed
pages are content-addressed GeoJSON files. An immutable, hash-linked page record
is flushed before the compact capture header is advanced. Only that small header
is replaced for each page; earlier records are not rewritten. A response retained
immediately before a process loss is reconciled from its page record rather than
requested again. Kernel-owned writer exclusion releases when its process exits.

The capture header identifies exactly the accepted prefix. Every retained page
and link in that prefix is rechecked when opening it. Source records are published
by rename after their bytes have been flushed; interrupted scratch files do not
become accepted pages. Pagination cycles, declared `numberReturned` mismatches,
changed retained bytes, unexpected encodings and off-origin redirects/next links
produce actionable errors while leaving the accepted prefix available.

Source configuration supports `pageBytes` (default 16 MiB, maximum 64 MiB),
`totalBytes` (default 256 MiB, maximum 2 GiB), `maxPages` (default 100,000) and
`requestTimeoutMs` (default 60,000). Repeating the capture with the same selection
and adjusted operational ceilings continues the prefix; a ceiling cannot be
reduced below retained work. The exported native CSV supports the original hard
ceiling of 256 MiB and one million rows. No timer, schedule or background worker
is installed by these commands.

GETs use the selected origin only. Private authorization can be supplied through
`authorizationEnv`, the name of an environment variable containing the complete
Authorization header. Secrets are neither stored in the source configuration nor
sent to a different origin. Native response-body bytes after HTTP content decoding,
request/final URLs, selected response headers and fetch times are retained. A local
protocol exercise can explicitly set `allowLoopback: true` for HTTP 127.0.0.1.

The completed edition contains `features.csv`, `dataset.json`, `plan.json`, optional
`seller.json`, the complete `source/` capture and `export.json` with their hashes
and native dataset snapshot. No source file depends on the old machine's path.
Copy the whole private edition to another Linux operator directory, preserving its
0700 directories and 0600 files, then run:

```sh
starforge dataset ogc reopen --out /new/private/edition
starforge dataset-workspace --dataset /new/private/edition/dataset.json
starforge dataset ogc review --state /new/private/edition/source \
  --out /new/private/source-review.html
```

Repeating the same export reconciles its completed result. Interrupted exports
finish only against their original source/plan/terms operation identity. Changed
operator files or another operation's output are never silently replaced. A new
source selection or a different reviewed plan uses a new edition directory.

## Exact source transport from another equipped machine

`capture --recordings responses.json` uses original saved response bodies instead
of making network requests. Its index has schema `stellar-forge.ogc-recordings.v1`
and a `responses` array. Each entry contains a simple sibling `file` name,
`requestedUrl`, final `url`, `status: 200`, `contentType`, `sha256` of that file,
and the original `fetchedAt`. Optional `etag`, `lastModified` and `contentCrs` are
retained. URLs must match the initial selection and every actual returned next
link; a missing response stops at the retained prefix. Do not substitute extracted
web prose or synthesized feature data for a captured response body.

## Development operation

```sh
node ogc/journey.mjs /new/private/ogc-journey
```

This single cohesive journey runs a clearly labelled local protocol source through
collection discovery, a short first page, an empty middle page, cancellation,
503 recovery, writer exclusion and retained-page reconciliation. It exports and
queries the ORIGINAL dataset, exercises the ORIGINAL authenticated query workspace
and seller HTTP402 service, preserves `9007199254740993` and long coordinate tokens,
and reopens both portable output and its original recorded source after the source
server closes. Its local protocol fixtures are part of the journey rather than a
second implementation of any merchant engine.
