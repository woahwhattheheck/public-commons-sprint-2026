# Original-source output receiving operation

This driver operates the complete output-edition and portable-receiving application against original files published by the GeoParquet project. The fixture manifest fixes each file's Git blob identity and byte length. It checks those identities before creating a workspace and records a measured SHA256 for each input in the completed operation.

## Run the complete operation

Use Python 3.10 or later and a runtime with PyArrow installed. Run from this pinned source tree; the driver adds the source directory to its import path. The operation records the actual PyArrow and installed Wherobots SDK versions. Use an available existing runtime and retain its exact dependency versions with the resulting handover.

```sh
python3 -B /absolute/path/to/wherobots/source/interoperability/native_receiving.py \
  --out /absolute/private/path/wherobots-source-receiving
```

The output directory is a durable operation identity. Repeating the command reconciles the same original source collection, completed stages, edition IDs and receiving workspace. Each complete archive retains its original name and hash. A different driver or input collection requires its own operation directory.

## Complete workflow

1. Verify all original fixture bytes and retain the published source manifest, metadata and license in the original workspace.
2. Inspect the entire original GeoParquet 1.0.0 and 1.1.0 output files, including Parquet schema, original GeoParquet metadata, geometry encoding, coordinate reference system and actual row counts. Inspect the complete CSV with its explicit original header and WKT geometry.
3. Use the published native reader to make a complete two-part lossless JSON view of the 1.1.0 source and a GeoJSON text sequence of per-feature coordinate envelopes in the original CRS. Keep these transformations named separately from the original files. Retain the transform, source references and zero-byte completion marker.
4. Create the original 1.0.0 edition, reconcile an exact repeated capture, export its whole workflow and receive it into an independent customer workspace. Repeat that receiving operation against its same archive.
5. Create the 1.1.0 edition from the original versioned source, compare complete datasets by their reviewed keys, preserve the resulting change object and advance the original workflow's selected edition.
6. Export the entire selected CSV through the existing SF30 dataset source format, preserving the original column mapping, null/presence states, raw-source objects and package inventory.
7. Export all original records, objects, comparison data, complete editable application source and offline preview. Advance the same customer workspace with that complete handover, repeat the receive, compare every indexed row with the original workspace, close and reopen it, and recover both original editions and their comparison.

The completed output is `operation.json`, both source and customer workspaces, `first-handover.zip`, `complete-handover.zip`, the SF30 dataset directory, the separately retained source-derived files and the original operation stage receipts. Actual source counts, schemas, coordinate envelopes, versions, hashes and receiving identities are populated by the operation.

## Source collection and interpretation

| Original file | Primary source | Retained interpretation |
| --- | --- | --- |
| GeoParquet 1.0.0 example | [Published 1.0.0 example](https://github.com/opengeospatial/geoparquet/blob/v1.0.0/examples/example.parquet) | Baseline complete source edition; matching published metadata retained. |
| GeoParquet 1.1.0 example | [Published 1.1.0 example](https://github.com/opengeospatial/geoparquet/blob/v1.1.0/examples/example.parquet) | Following complete source edition; matching published metadata retained. |
| Project CSV | [Published CSV](https://github.com/opengeospatial/geoparquet/blob/main/examples/example.csv) | Exact original CSV bytes, header and WKT geometry; the manifest pins the captured blob. |
| JSON and GeoJSON sequences | Published `native_receiving.py` plus original 1.1.0 Parquet | Deterministic source-derived attribute and coordinate-envelope views, including complete multipart capture. |

The reviewed source-operation records use `mode: retained-public-source` and retain null native account and run IDs. Account-backed submission and original provider status/log/output capture use the product's existing native SDK workflow. The original sources and the derived views remain distinct throughout edition creation and customer receiving.

The project license is retained at `fixtures/GEOPARQUET-LICENSE.txt`. Source interpretation follows [GeoParquet 1.1](https://geoparquet.org/releases/v1.1.0/), [OGC Simple Features](https://www.ogc.org/standards/sfa/), [RFC 8142 GeoJSON sequences](https://www.rfc-editor.org/rfc/rfc8142), and [PyArrow's native Parquet reader](https://arrow.apache.org/docs/python/generated/pyarrow.parquet.ParquetFile.html).
