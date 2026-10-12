# Comic Relief: complete original inputs

This operation receives one complete IATI publisher XML and both complete international 360Giving editions. It produces the three original native handoff ZIPs consumed by the grant portfolio. The same native publisher and dataset engines own source identities, selection, financial values, reports, exports and receiving.

## Coverage and attribution

Comic Relief states that its 360Giving publication covers UK and international funding committed since 1 January 2015. This operation selects the two **international** editions. Its IATI publication covers funding through programmes jointly funded with the UK Foreign, Commonwealth and Development Office. Those cohorts overlap only where the original records and a reviewed relation establish a match.

Attribute the original data to **Comic Relief, CC BY 4.0**. Keep the publisher's transparency statement and the IATI registry's separately reported licence metadata as separate source records.

- Publisher: https://www.comicrelief.com/your-impact/transparency/
- IATI publisher cprojects: https://merged.dashboard.iatistandard.org/publishers/cprojects/
- Reporting organisation: GB-CHC-326568
- 360Giving publisher: 360G-CR
- Registry: https://registry.threesixtygiving.org/data.json
- Current publisher metadata: https://store.data.threesixtygiving.org/api/dashboard/publisher/360G-CR?format=json
- Licence: https://creativecommons.org/licenses/by/4.0/

| Input | Original source |
| --- | --- |
| IATI cprojects-grants | https://assets.ctfassets.net/zsfivwzfgl3t/3skHdjqaAyEIqNxBpQu9Jo/a659e1990757d50174979ab49959e739/unflattened_202408.xml |
| International 2015–2022; a002400000WUhUuAAL | https://docs.google.com/spreadsheets/d/1D9mrF9RZ-CzL09PKAnLFcv8vbaZmfO_LKcLwlNQaWN8/export?format=xlsx |
| International 2022–2026; a00P400000OMLeUIAX | https://docs.google.com/spreadsheets/d/1mTGkno76vcgUx9SrYmZA41f495IsFbaw/export?format=xlsx |

The July 2026 IATI dashboard and dated 360Giving status feeds are publication observations. The receiving operation derives its actual counts from the complete received files. The historical 2015–2022 status observation reports a 240,580-byte workbook; the separate retained Drive export has 210,128 bytes. Preserve both capture identities and compare complete values before treating them as the same edition.

## Original input directory

The operation's retained directory contains:

- comic-relief-cprojects-grants-original.xml
- comic-relief-international-2015-2022-original.xlsx
- comic-relief-international-2022-2026-original.xlsx
- 360giving-original-registry-20261012.json
- comic-relief-360giving-original-publisher-metadata.json
- a002400000WUhUuAAL-registry.json
- a00P400000OMLeUIAX-registry.json
- original-file-identities.json

The last file uses schema `comic-relief.original-inputs/v1`, operationId `scf-grant-portfolio-comic-relief-9b23-20261012`, and `files:[{name,path,bytes,sha256}]` for every original file. It also records actual `iati:{root,attributes,activities,transactions,budgets}` from that original XML. Each selected registry JSON is the complete matching record from the preserved full registry feed; it retains all original fields. The feed locator and record path remain in the original manifest.

The original International 2015–2022 item is a native Google Sheet and was exported through the connected Drive export operation. The 2022–2026 item is already an XLSX and was received as its original raw file. Preserve these acquisition differences.

### Receive the preserved originals

Run `materialize-originals.py` once inside this same complete operation, passing a private JSON document on stdin:

```json
{
  "operationId": "scf-grant-portfolio-comic-relief-9b23-20261012",
  "outputDirectory": "/absolute/operation/comicrelief-inputs",
  "sources": [
    {"name": "comic-relief-cprojects-grants-original.xml", "bytes": 2478357, "url": "https://fresh-authorized-download.example/original", "reference": "notion-file-block://the-original-file-reference"}
  ]
}
```

Supply all five named originals with the exact retained sizes: XML 2,478,357; 2015–2022 XLSX 210,128; 2022–2026 XLSX 39,278; registry JSON 758,668; publisher metadata JSON 4,479 bytes. The example's one source illustrates the fields; it is not a complete request. Replace `url` with an absolute `sourcePath` when the original native receiver already has that complete file. An available original SHA256 can also be supplied as `sha256`.

The private carrier contains current signed download URLs. They are excluded from the saved manifest and all normal output. The permanent operation guard coalesces one receiver; complete source identities are saved before final-file publication, so an interrupted receive checks the same preserved bytes. Each XLSX is read through its original ZIP CRC; the XML inventory comes from the full file; selected registry records remain complete and keyed to their original positions. A completed repeat verifies those original bytes and returns the same manifest.

## Use the official converter

The preparation calls the original `libcove.lib.converters.convert_spreadsheet` from libcove 0.31.0 and flattentool 0.28.0. Its settings are the original 360Giving root `grants`, title conversion, Meta sheet, vertical package metadata and hash-comment handling. The full native profile's retained 1.4.3 package/current-grant schemas and its referenced 1.4.2 grant schema are verified against their original Git blob identities. Existing jsonref resolution reads that complete local schema closure without changing any schema document.

The official DataGetter converter dependency set includes jsonschema 3.2.0. The existing native publisher uses jsonschema 4.x. Use two existing or isolated Python environments so each product retains its actual dependencies:

```sh
python3 -m venv /absolute/converter-python
/absolute/converter-python/bin/python -m pip install --no-cache-dir -r converter-requirements.txt
/absolute/native-python/bin/python -B prepare-inputs.py prepare \
  --sdk /absolute/selected/sf30-seller-sdk \
  --inputs /absolute/retained/comicrelief-inputs \
  --output /absolute/operation/prepared \
  --converter-python /absolute/converter-python/bin/python
```

The existing saved publisher owner identified the native schema closure at `/dev/shm/bi-migration-2d58/runtime`, used with `/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3` and that exact directory on `PYTHONPATH`. Reuse it when present in the accepting worker. The preparation explicitly removes this native `PYTHONPATH` only from its converter child so jsonschema 4.x cannot replace the official converter's 3.2.0 dependency.

Use the installed native environment and its existing Node runtime for the next stage. Conversion outputs include the **full** package JSON, full cell and heading source maps, all conversion warnings and a complete converter/schema/source identity. Each saved capture includes the original XLSX identity, exact registry record, current publisher metadata and conversion lineage. The native publisher receives the untouched XLSX as its `transport` input.

For a separately retained historical original 2015 workbook, add `--historical-2015 /absolute/original-historical.xlsx` to the **first** preparation. Both workbooks go through the same converter and schema closure. The full semantic comparison retains every added/removed grant and every changed field. It compares decimal numeric values and object members independently of formatting while preserving both original JSON and workbook byte identities. It reports grant order and package metadata separately. Never substitute the published historical count for the historical source bytes.

A conversion that declares schema extensions retains its source and reports the unresolved original extension closure. Add the actual published extension documents to the selected converter inputs before proceeding; do not discard extension fields.

## Build the original native inputs

```sh
SF30_XML_NODE=/absolute/installed/node \
  /absolute/native-python/bin/python -B native-inputs.py \
  --sdk /absolute/selected/sf30-seller-sdk \
  --prepared /absolute/operation/prepared/prepared-inputs.json \
  --output /absolute/operation/native
```

The complete operation uses:

1. IATI `IatiWorkspace.add_source` with the full XML; `save_portfolio` selects that source, all three original collections and no financial filter. It retains a draft cross-standard review, complete source profile and all original finance dimensions. `export_portfolio` produces the complete original portfolio ZIP.
2. 360Giving `PublisherWorkspace.upload` and stable `admit/execute` requests for each complete JSON/registry/capture/XLSX intake. It retains the original review and decision template, builds the full original native edition, follows every native query page, and exports the complete original handoff.
3. The existing IATI and 360Giving receiving APIs independently receive those ZIPs. Both recipient workspaces close, reopen and retain the same original source/build/report values.

The recipe does not silently confirm suggested grant corrections. Its source preparation retains the full original review and every finding; the portfolio application owns explicit cross-standard linkage and review. If actual original schema findings need a correction, preserve the original package and apply a separately saved native publisher decision/candidate with its original identity.

Final `native-inputs.json` supplies the three complete handoff paths, byte counts, SHA256 identities, original source/build/portfolio IDs, source request identities and receiving locations. The portfolio application imports those exact ZIPs through its original source-ingest action. The input operation reuses original request IDs and original immutable outputs on resume; the final completed result verifies every handoff before returning it.

## Original native source contracts

Selected reviewed engine leaves:

- IATI iati_workspace.py: 3efaded28463c0ec23d34de09401b6ec146164ec
- 360Giving publisher.py: 822efca45b456ed3589699b3350b9890c83ca3a4
- 360Giving operator/publisher_workspace.py: e6e1113e553680058501a1208911f5396e1ff9cf

IATI is merged in public PR1939 at f0c78f11743e5582403167bed6ce1090bda8cea9; its original installation/support selection continues in PR2029. The original 360Giving operator is merged in PR1965 at 738368670fcac0155b5b8a5c86b09a7ae59bb5c3. Native source compatibility must be reviewed before changing these selected leaves.

IATI retains original currency, transaction type, budget type/status, valuation date, reporting organisation, hierarchy and period. 360Giving award amounts retain their award meaning. A reviewed linkage never adds these different financial meanings into a common total.
