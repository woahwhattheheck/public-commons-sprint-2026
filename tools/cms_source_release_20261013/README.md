# Complete hospital source-release and comparison workbench

The package preserves the complete current California query of CMS Hospital General Information: 377 facilities, 38 original text fields and all four original API responses. It includes the editable release-review desk, exact original-source rebuild, full CSV admission, two-edition field comparison, source-bound change review and independent receiving.

## Open the working application

Open `review-desk.html` in a browser. Search every original field, filter by county/type/review, inspect all original cells and save a per-record review. Export review JSON/CSV before handing work to another computer.

Under **Compare an original source edition**, download the complete current release or receive a previous `*.release.json` transfer. The desk reconstructs both sources, opens every changed field and added/removed facility, and supplies a standalone comparison desk plus complete source bundle. The comparison desk includes both complete original sources and exact field mappings. Export its review JSON/CSV or complete source handover after reviewing changes.

The comparison checks literal strings. Empty cells, absent columns, "Not Available", leading zeroes and alphanumeric facility IDs remain distinct. A changed source rating is a published data change, not a clinical conclusion.

### Import the publisher CSV directly in the browser

Open **Import an original publisher CSV** beneath the comparison section. Choose the complete UTF-8 file; the desk shows its original filename, byte count, SHA-256, row count, exact headers and the first three literal cells from each column. National files remain complete in the source transfer while the comparison selects California records.

Review the proposed header matches and explicitly select each known CMS field. Suggestions use header spelling only. Unmapped fields remain available under their exact original headers; duplicate target mappings are rejected. Facility ID and State are required. Empty cells are displayed as empty strings, and no identifier or value is converted to a number.

Enter the actual source origin, resource/edition identity, publisher release date, capture date and public source URL. Retain a published modification date and archive/member identity when available. Choose whether this imported edition is the before or after side of the comparison, then confirm the complete mapping and source context.

**Receive CSV and open full comparison** builds the source-bound release, independently reconstructs it from the retained original CSV and opens every actual field change against the embedded release. Save **Download imported original edition** for independent receiving and **Download exact mapping request** for the existing CLI. The exported request names the original file member and can be used with the same unchanged original CSV in `ingest-csv`.

For a CSV exported from this embedded API release, choose that explicit derived origin. The desk keeps the original parent release ID and requires the file's exact canonical CSV SHA; a spreadsheet-resaved or mail-normalized copy cannot silently stand in for it. The publisher-original choice keeps its own source metadata and does not inherit the current API edition.

CSV selection and mapping happen locally. Changing the chosen file or metadata clears the prior intake confirmation; the currently displayed original release and previously exported editions stay intact.


## Original current edition

- Dataset: https://data.cms.gov/provider-data/dataset/xubh-q36u
- Resource: 90fa4cdf-f49d-556d-8790-d32fbbec40c6
- CMS release date: 13 August 2026; modified: 22 July 2026.
- Capture date: 13 October 2026.
- Original API query: California, complete 377 rows in four responses.
- Native original-field CSV: 125,363 UTF-8 bytes, SHA-256 `3247fa39b9afde13de92b182a80732d721780106108fde3b1013c531f71757b2`.
- Published whole-country counts describe a different scope from this California release.

## Command line

Use Node.js 20 or later; no third-party dependencies or install step is needed.

```sh
node release.mjs verify release
node release.mjs rebuild release /new/current-rebuilt
node release.mjs bundle release /new/current.release.json
node release.mjs receive /new/current.release.json /new/current-received
node release.mjs review release edited-review.csv /new/received-review.json
```

Every output directory/file must be new. Existing original editions and review returns are preserved. A rebuild reopens and verifies the exact source files before the new directory is committed.

### Receive an original CSV edition

Retain the entire original CSV, including all states if that is how CMS publishes the file. Create an explicit request:

```json
{
  "schema": "source-csv-request/1",
  "dataset_id": "xubh-q36u",
  "resource_id": "ACTUAL_ORIGINAL_RESOURCE_OR_ARCHIVE_MEMBER_IDENTITY",
  "scope": {"state": "CA"},
  "origin": "official-original",
  "original_member": "original/Hospital_General_Information.csv",
  "metadata": {
    "captured_on": "ACTUAL_CAPTURE_DATE",
    "source_released": "ACTUAL_PUBLISHED_RELEASE_DATE",
    "source_modified": null,
    "dataset_url": "https://data.cms.gov/provider-data/dataset/xubh-q36u",
    "source_url": "ACTUAL_OFFICIAL_CSV_OR_ARCHIVE_URL",
    "archive_url": "ACTUAL_OFFICIAL_ARCHIVE_URL",
    "archive_member": "ACTUAL_ORIGINAL_MEMBER_PATH"
  },
  "column_mapping": [
    {"source_header": "ACTUAL_FACILITY_ID_HEADER", "field": "facility_id"},
    {"source_header": "ACTUAL_STATE_HEADER", "field": "state"}
  ]
}
```

Enter actual YYYY-MM-DD dates and exact published header spelling. The example deliberately leaves unknown metadata as placeholders; it is not an admitted source request. Add every known field mapping from the original dictionary. `release_csv.mjs` lists the 38 actual current canonical CMS fields. Mapping is one-to-one; a source header or target field cannot be repeated. Facility ID and State mappings are required.

Every unmapped column remains present as `source_column:<exact original header>`. This preserves new or unfamiliar fields without pretending that they have a known meaning. Both original headers and explicit mappings appear in the manifest and comparison desk. The complete original CSV stays byte-for-byte in `original/`; selected California cells stay strings in the derived release. Source record ordinals, complete original row count and selected California count are retained separately.

```sh
node release.mjs ingest-csv /actual/Hospital_General_Information.csv /actual/edition-request.json /new/prior-release
node release.mjs verify /new/prior-release
node release.mjs bundle /new/prior-release /new/prior.release.json
```

Input is strictly decoded as UTF-8, preserving an original UTF-8 BOM. Other encodings require a separately attributed conversion before admission; the tool never silently replaces invalid bytes. Original empty values and identifiers are not trimmed, coerced or filled.

### Compare and deliver both complete editions

```sh
node release.mjs comparison /new/prior-release release /new/edition-comparison
node release.mjs review-changes /new/edition-comparison/comparison-complete.json /actual/edited-change-review.csv /new/reviewed-comparison.json
node release.mjs render-comparison /new/reviewed-comparison.json /new/reviewed-comparison.html
```

The complete comparison directory contains:

| File | Purpose |
| --- | --- |
| comparison-review.html | Standalone industrial review application with both original sources |
| comparison-complete.json | Full source editions, exact comparison and initial review |
| before.release.json / after.release.json | Complete independently receivable original editions |
| comparison.json | Field changes, full added/removed records, mappings and source metadata |
| changes.csv | Every original change with explicit presence flags and original row hashes |
| change-review.json / change-review.csv | One source-bound decision per actual change |
| README.txt | Receiving instructions |

The complete HTML and JSON can move to another machine without a backend. A completed review needs a reviewer; CHECK also needs a note. Imported review rows must retain the exact comparison/change IDs, facility and field. Review order is normalized to the original change order.

Added and removed fields are reported explicitly. Every changed facility can be opened alongside its complete before/after source record. Known source columns use the explicit canonical mapping. Unmapped header changes remain visible rather than being guessed into equivalence.

For data-only use, `node release.mjs compare BEFORE AFTER NEW_JSON` writes the same complete comparison model.

## Meaningful receiving already exercised

The full original 377-row/38-field current API-derived CSV was received through the CSV importer, reconstructed from its exact original input and reopened through the complete transfer. Its request is `current-csv-request.json`; origin is explicitly `derived-current-api-csv`, with the original API release ID and exact parent CSV SHA. The field comparison against the original API release yields 377 unchanged facilities and zero field changes.

```sh
node release.mjs ingest-csv release/data.csv current-csv-request.json /new/current-csv-received
node release.mjs comparison /new/current-csv-received release /new/current-csv-comparison
```

The complete actual May archive edition is included in `examples/may-2026-to-august-2026/`. Open its `comparison-review.html` directly, or receive its `may-complete-source.json` through the current reviewer's prior-edition upload. It retains all 5,432 original national CSV rows and selects 378 California facilities; the current API edition contains 377. Comparing all 38 fields yields 371 unchanged facilities, six changed facilities and one removed source record, with 17 field changes plus the removed row. The exact archive readme, dictionary, request and complete before/after source transfers accompany the example. May 13 is the archive's unpublication/replacement date; its publication and modification dates remain unavailable.

`RECEIVE_BROWSER.md` explains complete source or whole-archive intake with an existing browser runtime, actual desktop/narrow use, original downloads and independent reopening.

The original API release verify/rebuild/complete review course has also passed in Linux. The complete original CSV import, source transfer reconstruction and field comparison have been exercised in JavaScript. The standalone browser app checks its compressed and expanded source hashes and rebuilds the original release before enabling the review controls.

## Implementation and receiving scope

`release_core.mjs` preserves the original API release and review engine. `release_csv.mjs` supplies CSV intake, complete source transfer and edition/change-review contracts. `release.mjs` is the maintained CLI. `comparison-template.html` contains the complete browser engine; its one source-packet marker is filled from verified original release transfers. `review-desk.html` composes those same current sources. `csv_intake.mjs` supplies the original-file inspection, explicit mapping request and browser intake controller; the same source is embedded in the standalone viewer.

Incoming CLI and browser files are decoded as strict UTF-8. Invalid byte sequences are rejected; original CSV byte-order marks and line endings remain in the retained original source. UTF-8 decoding never silently replaces a source byte.


## Receive the complete publisher archive

The same working desk now accepts an entire original ZIP under **Import or receive a complete publisher ZIP**. Enter the actual publisher archive URL, choose the complete file, inspect its verified member inventory, and select the original CSV. The selected table opens in the existing explicit field mapper. Enter its actual resource and release dates, confirm mappings and receive the CSV. **Download complete archive intake** retains the untouched ZIP, every member's complete inventory and hash, the selected original CSV, exact mapping request and fully reconstructed release.

The full archive remains intact, including members unrelated to the selected table. Its DOS timestamps are preserved as archive metadata; the application does not turn them into publication dates. National CSVs remain complete originals while the release selects California. The ordinary release transfer still embeds the complete selected CSV. The separate archive-intake package additionally preserves the whole publisher ZIP.

Use **Receive a complete archive intake** to open that JSON on another computer. The receiver decodes and checks the original ZIP, expands and verifies every original member, rebuilds the selected release from its original CSV and mapping, and then opens the complete comparison in the selected before/after position. **Download untouched original ZIP** returns the exact archive bytes.

If the archive is a prepared package of this desk's current API-derived CSV, select that explicit derived origin in the mapper. Its original parent release and exact canonical CSV SHA remain mandatory; the archive package is labeled prepared-current-api-csv-package. Publisher-original archives retain their own actual archive URL and original edition.

### Native archive commands

The maintained local command uses Node.js 20 or later and built-in modules only.

```sh
node archive.mjs inventory /actual/hospitals.zip /new/archive-inventory.json
node archive.mjs receive /actual/hospitals.zip /actual/edition-request.json /new/archive-received
node archive.mjs reopen /new/archive-received/archive-intake.json /new/independent-receiver
node release.mjs comparison /new/independent-receiver/selected-release release /new/full-comparison

```

Use the same source-csv-request/1 mapping described above. For a publisher-original ZIP, metadata.archive_url and metadata.source_url must be its exact original public archive URL; metadata.archive_member must be the exact selected path from the inventory. Preserve original_member as the selected CSV's safe original/ release path. Every original header and cell follows the same unchanged CSV intake contract.

Native receiving writes a complete new directory containing the untouched ZIP, full inventory, exact mapping, complete archive-intake JSON, original CSV-source transfer, independently received release directory and operating guide. It then reads the saved archive package back through the same whole-source reconstruction before publishing the directory. Existing output directories are preserved.

The reader accepts standard single-volume stored or Deflate archives, ordinary ASCII or declared UTF-8 member paths and streaming descriptors with or without their signature. It checks central/local names, method, flags, lengths, CRCs, non-overlapping member extents and every expanded member hash. Unsupported encryption, ZIP64, split archives and legacy non-ASCII path encodings are identified explicitly. Archive capacity is 512 MiB compressed, 256 MiB per expanded member and 2 GiB total expanded inventory; members are verified sequentially. Source files are never executed.

The ZIP container reader follows [PKWARE APPNOTE 6.3.10](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT). archive_core.mjs supplies common inventory, complete-byte source contracts and receiving; archive_intake.mjs composes the browser with the existing CSV controller; archive.mjs is the local receiving command. Both browser and CLI retain the full archive independently of the selected release.

The original-data receiving course packages all four retained current API responses, their complete 125,363-byte CSV and mapping request: six members, 657,058 expanded source bytes. Stored and Deflate members and both streaming descriptor forms are exercised. Independent archive receiving reconstructs all 377 records and 38 fields with zero changed cells against the original API release. This course retains the explicit prepared-current-api-csv-package origin. Browser-controller review also exercises a later manual CSV selection during archive inflation and complete-intake receiving; both retain the newer selection.

## Publication dates, archive dates and source attribution

The native CSV/API builders, standalone mapper, comparisons and complete archive receiving keep date meanings separate. A supplied `source_released` is a publisher publication date. When the source used for intake does not supply that date, set it explicitly to `null` and retain a publication attribution explaining the basis. A missing field or blank date is rejected; the importer does not derive a publication date from an archive filename, capture time or ZIP timestamp.

The mapper offers **Publication date supplied** and **Publication date not supplied**. The latter opens the attribution fields and requires an explanation and the actual public source URL. A separate archive date requires its publisher meaning and its own attribution. Existing known publication dates, including the retained August CMS edition, keep their original release and transfer identities.

Optional request metadata fields:

| Field | Meaning |
| --- | --- |
| `source_released` | Strict YYYY-MM-DD publication date, or explicit null with publication attribution. |
| `source_modified` | The independently supplied modification date; null if absent. |
| `captured_on` | The date the original source was captured. |
| `archive_date` | A separately attributed YYYY-MM-DD archive date; omit when absent. |
| `archive_date_meaning` | The publisher's actual meaning, such as unpublication, replacement or archive listing date. |
| `date_provenance.publication` | Required when publication date is unknown; optional attribution for a supplied date. |
| `date_provenance.archive` | Required when an archive date is supplied. |

Each attribution contains `note` (publisher wording or a clear source explanation) and `source_url` (the exact public HTTPS source). It can also contain the paired `source_member` and `source_sha256` for a readme or other member in the retained archive. Preserve the spelling and exact member bytes. Complete archive export/receiving requires that member to exist in the original verified ZIP inventory, match its SHA-256, and cite the same original archive URL. A standalone CSV transfer retains that attribution; the complete archive intake additionally retains and verifies the cited member itself.

For example, this partial metadata explicitly represents an unknown publication date; replace the explanatory text and URL with the source actually used:

```json
{
  "source_released": null,
  "date_provenance": {
    "publication": {
      "note": "The original source used for intake supplies an archive date but no publication date.",
      "source_url": "https://data.cms.gov/provider-data/archived-data/hospitals"
    }
  }
}
```

If an archive listing labels May 13 as an archive date, enter it only as `archive_date` with that actual meaning. If the original readme instead states an unpublication or replacement event, retain that wording and its member reference. The product does not decide a publication date from either event.

The comparison overview and both complete source panels display the distinct dates and their attribution. Unknown publication is printed as **Publication date not supplied**. The complete comparison JSON retains all date metadata on the original transfers and the publication/archive attribution on its before/after summaries. Native `release.mjs verify` reports the same date fields. The usual ingest, archive receive, rebuild and comparison commands remain unchanged; each reconstructs the original request and source bytes before accepting the saved edition.

Changing date metadata creates a distinct CSV edition because its complete mapping request is part of that edition's identity. It leaves the original source bytes and all literal cells unchanged. Previously saved transfers without the optional archive/attribution fields reopen with their original identities.
