# OData source meaning and complete customer analysis

The existing OData workspace publishes the selected CSDL meaning together with its
original typed dataset. The same source edition, CSV query engine, version store,
SF82 merchant release and SF88/SF100 customer delivery remain the operating path.

## Inspect and publish the retained source

Open an existing source workspace or restore its original OData transfer.
Imports retain the source service document, CSDL and every original page.
Choose a complete edition, inspect its entity keys and selected properties, and
accept the edition through the existing receiving review.

The installed SDK entry exposes the native semantic preview:

~~~js
import { openODataWorkspace, openODataPublisher } from '@tokenjunkielabs/starforge-merchant/seller/odata';

const workspace = await openODataWorkspace({directory: '/absolute/source-workspace'});
const dictionary = await workspace.semantics({
  id: 'orders-edition',
  fields: ['OrderID', 'CustomerID', 'OrderDate', 'Freight', 'ShipCountry'],
});

// Inspect dictionary.columns, primaryKey and csdl with the selected source.
const exported = await workspace.exportEdition({
  id: 'orders-edition',
  name: 'Reviewed orders',
  fields: ['OrderID', 'CustomerID', 'OrderDate', 'Freight', 'ShipCountry'],
  expectedSemanticSha256: dictionary.sha256,
  origin: merchantOrigin,
  payment: publicPaymentTerms,
});
const publisher = await openODataPublisher({workspace});
const staged = await publisher.prepare({
  exportId: exported.id, releaseId: 'orders-semantic-release', runtime: {port: 0},
});
~~~

Relative source imports are also supported through `odata/index.mjs`.
The publisher's existing status, activation, run, rollback and shutdown APIs apply
to this release. Its retained dataset snapshot binds both the CSV values and the
selected semantic document.

CLI commands use the same workspace:

~~~sh
npx --no-install starforge odata --workspace SOURCE semantics --id EDITION --fields OrderID,Freight,ShipCountry --out meaning.json
npx --no-install starforge odata --workspace SOURCE export --id EDITION --fields OrderID,Freight,ShipCountry --expected-semantics SHA256 --payment PAYMENT.json --origin ORIGIN
npx --no-install starforge odata --workspace SOURCE merchant prepare --export EXPORT_ID --release RELEASE_ID
~~~

The local operator exposes `POST /api/semantics` with `{id, fields?}`; the
existing `POST /api/export` accepts `expectedSemanticSha256`.
Merchant MCP adds `merchant_odata_semantics` with the declared workspace alias,
`editionId` and optional `fields`. Use its returned digest in the original
`merchant_odata_export` call. All original capture, release, live service,
buyer, file-read and receiving operations remain available.

## What each column means

Each selected OData property has two physical dataset columns:

| Physical column | Meaning |
| --- | --- |
| `Freight` | The retained source value in the reviewed physical encoding |
| `Freight_state` | `value`, `null` or `missing` in the source property path |

A null parent makes a nested property path null. A missing parent makes the path
missing. An empty string with state `value` remains distinct from both. Exact
source rows and original wire pages accompany the published projection.

The dictionary retains the CSDL qualified type, underlying type, original facets,
entity type and inheritance, selected complex type dependencies, enumerations
and type definitions. Complete source key paths map to their exported value
columns. The primary key is descriptive; the receiving SQL engine preserves its
existing immutable edition and reviewed alias behavior.

| CSDL representation | Original physical dataset encoding |
| --- | --- |
| Decimal and Int64 | Exact text, including the original decimal scale |
| Byte, SByte, Int16 and Int32 | Exact safe integer where selected by the original projection |
| Single and Double | Native finite number where selected by the original projection |
| Boolean | Native Boolean |
| Date, DateTimeOffset, TimeOfDay and Duration | Original temporal text |
| Complex values, collections and spatial values | JSON text |
| Enum and ordinary string values | Source text |

The CSVW companion describes the actual physical dataset. A Decimal value
published as an exact string therefore has physical string semantics; its CSDL
Decimal definition stays in `sourceDefinition`. For SQL calculations that need
decimal arithmetic, choose an exact decimal representation explicitly and
retain the original text column. Source field names alone do not supply a
currency or business unit.

The original dataset configuration supports at most 64 KiB. The preview exposes
the complete dictionary before export; a projection exceeding that existing
configuration budget needs fewer selected properties. This does not alter the
retained complete source capture.

## Original files and identities

A semantic export contains the existing dataset files and these companions:

| File | Binding |
| --- | --- |
| `semantics.json` | Complete reviewed source-to-physical dictionary |
| `table-schema.json` | The dictionary's exact CSVW companion |
| `capture/manifest.json` | Edition, reviewed query, complete keys, counts, receipts and original page references |
| `capture/metadata.csdl` | Exact original XML or JSON CSDL bytes |
| `capture/service.json` | Exact original service-document bytes |
| `capture/pages/SHA256.json` | Each original provider response |
| `capture/rows/SHA256.json` | Each original normalized page |

The existing `source.json.sourceFiles` descriptors bind every companion by path,
byte count and SHA256. SF82 validates and copies them into the same staged
dataset release. OData workspace transfer/reopen preserves the same files.

There are four distinct identities:

| Identity | Bound content |
| --- | --- |
| `definitionSha256` | Qualified source meanings, selected aliases/encodings, keys and physical CSVW |
| `sha256` in the dictionary | The definition plus its original metadata and capture identity |
| `source.captureManifestSha256` | Exact formatted `capture/manifest.json` bytes |
| File descriptor SHA256 | Exact retained file bytes |

The definition digest excludes the raw CSDL byte hash and capture manifest hash.
A refreshed row edition with unchanged meanings can therefore retain its
definition identity. Changes to the selected meanings create a new definition.

Semantic CSV configs add their complete dictionary under `semantics`. The
original CSV loader validates both semantic digests against its physical
columns. Its new semantic snapshots include that dictionary identity in their
existing hash policy. Configurations without `semantics` retain their original
snapshot and cursor identities.

## Receive the actual pages

The existing dataset offer advertises optional `semantics`. A matching digest
selects the reviewed meaning; a mismatch returns `409 DATASET_SEMANTICS_CHANGED`
during original admission. The existing snapshot/cursor also binds that meaning.
Each accepted page retains the complete dictionary in `body.semantics` and its
identity in `x-dataset-semantics-sha256`. The original page-byte check includes
the dictionary before payment handling.

Follow the original dataset cursor without changing the selected fields, filters,
sort, snapshot or semantics. Pass the actual response headers when using the
original SF88 `inspectDatasetPage` helper. Its page continuity and original
attempt-wire recovery retain the same semantic identity.

Finalize the original pages through SF100. The completed customer room contains
`dataset.jsonl`, `dataset.csv`, `manifest.json`, `review.html` and
`semantics.json`. The manifest binds the dictionary's exact bytes, selected
physical fields and source identity.

## Use the existing customer analysis application

Use the original Python customer workflow described in
[the SF88 semantic receiving guide](../../sf88-operator-buyer-cli/python/SEMANTICS.md).
It receives the finalized room through the native scanner, imports a version into
the existing SQLite database and keeps the exact dictionary with the reviewed
SQL aliases:

~~~python
from stellar_forge_buyer.analysis_native_delivery import open_finalized
from stellar_forge_buyer.sqlite_dataset import DatasetDatabase

delivery, native = open_finalized(checkout, node, finalized_room)
database = DatasetDatabase(customer_directory)
edition = database.import_delivery(delivery, columns={"Freight": "freight_decimal"})
meaning = database.semantics(edition["version_id"])
~~~

The existing native source-registration API can register that same room and
expected source/manifest binding. Use the current source revision and stable
import job ID when receiving it through the original application.

Saved queries carry source versions and dictionaries into complete query exports.
Published reports retain source meanings in their JSON, HTML and ZIP. Original
workbooks keep their query/report source handoffs, and database backup/reopen
retains the exact dictionary and selected aliases. The customer application
provides its existing authenticated dictionary inspection/download endpoints.

The maintained `python/examples/semantic_analysis.py` receives a finalized
native scan into that whole query/report/workbook/backup workflow. Supply the
actual scan JSON, private database/output directories and reviewed SQL column
mapping. Preserve its original IDs when continuing an interrupted operation.

## Source specifications

- [OASIS CSDL XML 4.01](https://docs.oasis-open.org/odata/odata-csdl-xml/v4.01/odata-csdl-xml-v4.01.html):
  entity inheritance, keys, structural properties and facets.
- [OASIS CSDL JSON 4.01](https://docs.oasis-open.org/odata/odata-csdl-json/v4.01/odata-csdl-json-v4.01.html):
  the corresponding JSON metadata representation.
- [W3C tabular metadata](https://www.w3.org/TR/tabular-metadata/):
  physical column definitions, null representations and primary keys.

The complete original CSDL is retained with the selected projection for
additional source annotations and provider-specific interpretation.

## Operator review

In Dataset exports, choose the accepted edition and optional property paths, then select **Preview field meanings**. The existing screen shows each receiving value/state column, the original CSDL type and declared facets, the exact source key, nullability, and storage encoding. **Download dictionary** saves the complete source-bound dictionary. Creating the export after a preview sends that dictionary's exact SHA256; changing the edition or property selection clears the preview. Every completed export retains its dictionary and original capture files. An earlier export remains downloadable with its original identity.

Release preparation reopens an existing initialized dataset store with its original settings, so the same retained export can continue through the original merchant preparation after an interrupted operation.

## Original Northwind receiving source

The original retained Northwind operation contains 830 Orders in five response pages. The semantic preview reparses metadata SHA256 `81a48488cd2911f7254170da5403628db22127ea59124d6597d04c6af18d7702` and retains 14 physical value/state columns, including the complete `OrderID` key. Its `Freight` field is CSDL `Edm.Decimal` with source scale retained; the original first value remains the text `"32.3800"`.

The same published loader opens the earlier configuration at its original snapshot `6df2673a539b6ca54ecb78907af204fd5a4fe20c011a64b102030ebc7d107817`. Adding the dictionary gives semantic snapshot `a1fd79affcc0b6abbf06725ddb82e13a3087d213ee22dc1c35fd75a92ee7a97e`. The actual 200-row native response retains the complete dictionary and both snapshot/semantic headers. The original refresh edition has the same definition identity, and a different requested meaning digest returns 409 during admission.
