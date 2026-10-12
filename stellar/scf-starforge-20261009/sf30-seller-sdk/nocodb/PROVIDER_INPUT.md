# Original NocoDB provider input

This intake prepares the actual upstream Sakila SQLite database for import into an authorized **real NocoDB instance**. Preparation retains the upstream source; the subsequent service import and capture produce the actual provider observation.

## Source identity

- Original repository: nocodb/nocodb
- Commit: ba068da3a8e984ab807841b632df695cdfa4e8a0
- Path: packages/nocodb/tests/sqlite-sakila-db/sakila.db
- Original bytes: 4,964,352
- Original Git blob: 2f7281e5d055983635c50a3b1c09e274afbc5b2e
- Exact URL: https://raw.githubusercontent.com/nocodb/nocodb/ba068da3a8e984ab807841b632df695cdfa4e8a0/packages/nocodb/tests/sqlite-sakila-db/sakila.db

The preparation program checks the actual byte count and Git object hash, saves the original database and actual retrieval receipt, then reads a query-only in-memory copy. It retains every actor and film row and the actual schema with the original source key order. Row totals, null counts, empty-text counts and SHA-256 values are computed from the retrieved bytes; none is assumed from a standard Sakila installation.

## Prepare the source

Use an existing Python installation with sqlite3 and a directory with enough capacity for the complete original database and selected outputs.

```sh
PYTHONDONTWRITEBYTECODE=1 python provider_fixture.py --out /absolute/new/sakila-source
```

To reuse an already retained exact original:

```sh
PYTHONDONTWRITEBYTECODE=1 python provider_fixture.py \
  --db /absolute/original/sakila.db --out /absolute/new/sakila-source
```

The output is create-only. A failure preserves any received original bytes and never publishes a complete manifest. Keep the earlier incomplete directory and use a new preparation directory after the concrete storage/source problem is resolved.

Outputs are the original DB, actual source receipt, actor/film typed row files, convenience CSVs, proposed v3 table-create bodies and one complete manifest. Original SQLite NULL and empty text remain distinct in the typed row files; convenience CSV blanks alone cannot distinguish them. Use the typed source when importing data with that distinction.

## Real NocoDB intake

Use the already selected provider owner and existing authorized instance. Record its actual version/image digest, server, workspace/base and source IDs. Continue the selected provider owner's existing instance.

For a newly isolated fixture import, create dedicated actor and film tables within an authorized isolated base. The table-create bodies intentionally keep the original source key as a unique ordinary Number field; NocoDB generates its own native ID. Keep those two identities separate. Date/time fixture values are imported as source text, not reinterpreted as a local time zone.

The current published v3 routes are:

- POST /api/v3/meta/bases/{baseId}/tables with the retained selected table-create body.
- POST /api/v3/data/{baseId}/{tableId}/records with a record object or array of record objects.
- Each record has `{fields:{...}}`. Use the actual created field IDs or exact native titles. The v3 default bulk cap is ten records per request, configurable by deployment.
- A field outside `fields` is invalid; an unknown key inside `fields` can be ignored by the service. Bind the returned actual field map before sending rows.
- Retain the exact create/import request, native response and returned table/record IDs. After an uncertain write, reconcile that original operation and existing source keys before attempting another write. Do not replay an unknown POST as a new import.

The original `*.rows.json` contains the source rows for that actual import. Import only the selected original rows, with no invented fields, values or timestamps. NocoDB's generated native IDs and server timestamps are provider outputs, and are retained separately.

A normal authorized NocoDB browser import can use the retained CSV for a selection without ambiguous null/empty cells. The operator still retains the actual table and field mapping and verifies the resulting original rows. Record the actual provider import separately from this source preparation.

## Consume through the original source implementation

Use the installed `starforge nocodb-source` command from the complete distribution, or this maintained source directory's `cli.mjs`. See [source and publisher operation](README.md) and [deployment/customer receiving](DEPLOYMENT.md).

Create one private source file from that implementation's `example-source.json`, using the actual server/base/table/view, native sourceOrder and token environment reference. Initial `queries:{}` is allowed for discovery. No provider secret belongs in a source archive, command argument, customer document or public capture.

```sh
starforge nocodb-source discover --source /private/REST_SOURCE.json
starforge nocodb-source capture --source /private/REST_SOURCE.json \
  --out /private/new-provider-capture
starforge nocodb-source freeze --source /private/REST_SOURCE.json \
  --capture /private/new-provider-capture/capture.json \
  --out /private/new-frozen-source.json
```

Review the actual returned field IDs/types, public columns, source keys and null policy before capture. Use `$recordId` for the native root ID; external PK values belong to `id_fields`, not ordinary `fields`. Preserve numeric values as explicit number text where conversion would lose precision. A view-hidden field is absent, not a null.

The original capture implementation follows real continuation URLs and retains complete original metadata, count and page responses with hashes. Choose a page size that actually crosses multiple pages for the selected source. Use its existing import command to receive the complete original capture on another host; retain its original manifest and method/URL/time provenance.

The same source then enters the original publisher, review, immutable edition, merchant/release and receiving-client workflow. Update the original operation with the actual provider capture, publication and customer receiving result. The input manifest records `UPSTREAM_SOURCE_READY`.

## Current service semantics

The published v3 API has a table/view/filter count endpoint, `GET /api/v3/data/{baseId}/{tableId}/count`. The record path preserves the selected view and filter, omits primary keys from ordinary fields and may omit terminal next rather than returning null. The resolved page size can differ from the requested one.

Equal before/after counts and schema observations describe the completed paginated observation, not a transaction snapshot across requests. A changing source needs an agreed operating window or explicitly accepted observation semantics.

Official specification: https://nocodb.com/apis/v3/swagger-v3.json  
Retained published specification: 669,984 bytes, SHA-256 ac144bee5a391326598e9e1a0b18833d18c87b04dff196db07d07dfa4bd65681.
