# OECD data attribution and customer distribution

The observation source is governed by [OECD Data Terms, section 3](https://www.oecd.org/en/about/terms-conditions.html). That section permits commercial reuse, subject to applicable dataset and third-party restrictions, with an accompanying dataset acknowledgment. The same acknowledgment requirement must pass through downstream licences. Retain the original dataflow, DSD, codelist and source annotations with the observation edition. The separate Creative Commons policy on that page concerns written content; it does not establish the statistical dataset's licence.

For the bundled original response, use:

> OECD (2026), Composite leading indicators, OECD Data Explorer, https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_CLI/USA+CAN+DEU+FRA+GBR+ITA+JPN.M.LI...AA...H?startPeriod=2024-01&format=genericdata (accessed 2026-10-12).

The complete receipt in [sources/bundle.json](sources/bundle.json) records readback at 2026-10-12T12:01:14.820Z. This is the retained acquisition/readback clock. The original XML Prepared field has no timezone and remains a separate publisher field. A later source refresh receives its own actual completion timestamp and citation.

## What travels with a customer edition

New briefings default to report version 2. The five complete output files are:

| File | Customer use |
| --- | --- |
| briefing.html | Standalone offline report, full original monthly observations, charts and explicit dataset citation/terms/downstream acknowledgment |
| briefing.json | Exact report document, native metadata, calculations, structured dataset citation and each original source acquisition identity/date |
| observations.csv | Original values and native source fields, followed by dataset source URL, accessed date, citation and terms columns |
| SOURCE_RIGHTS.json | Structured source acknowledgment tied to the exact capture, report, native snapshot and catalog edition |
| SOURCE_RIGHTS.md | Readable acknowledgment and all fifteen original source credits for accompanying the CSV or native dataset |

The original Macrobond customer packet keeps its exact native members and manifest. Its standard ZIP comment carries the complete acknowledgment, so the maintained native catalog importer continues to open it. The complete OECD project packet includes both explicit SOURCE_RIGHTS files and the original customer ZIP; distribute that packet when handing the full application edition to a customer.

The native dataset has a maintained exact three-file contract. `export-dataset` leaves those original data/config/lineage bytes unchanged and returns an accompanying `attribution` directory, file hashes and citation. Ship that companion with the native dataset. The complete economic receiver automatically retains all five report files in the actual customer delivery folder.

## Same-project adoption and reopening

Existing saved report versions retain their original operation identity and exact three output files. Replaying an existing operation selects its stored report version. Explicit `"report_version": 1` also preserves the legacy renderer. New operations default to version 2; the normalized selection records that version so a retry and a fresh customer import use the same format.

To add citation to an existing analyst project, select its current source project, set the original expected revision, and save a new analyst operation. The original published source data and buyer intents stay in that project. This creates a source-bound editorial edition with the complete citation and delivery files.

Example request for a new cited revision:

```json
{
  "operation_id": "YOUR_ORIGINAL_PROJECT:cited-edition",
  "capture_id": "YOUR_RETAINED_CAPTURE_SHA256",
  "project_id": "YOUR_ORIGINAL_SOURCE_PROJECT_ID",
  "expected_revision": 2,
  "report_version": 2,
  "countries": ["CAN", "DEU", "FRA", "GBR", "ITA", "JPN", "USA"],
  "start_period": "2024-01",
  "title": "Monthly leading-indicator customer briefing",
  "notes": "Independent analysis using the retained original OECD source."
}
```

Use actual values from `state`; the sample revision is an example. Submit through the existing browser, typed client, CLI request file or `oecd_save` MCP tool. Source-credit downloads are available in that same browser and `oecd_report_file` interface.

Version 2 project packets reopen with this application version. Version 1 packets continue to reopen byte for byte. During a fresh import, the renderer selects the exact acquisition hash retained in the report and checks it against the imported native source history before reproducing HTML, JSON, CSV and both acknowledgment files. Different pre-existing acquisition order in the destination does not change the original citation.

A custom source bundle needs an actual timezone-qualified acquisition receipt: `completed_at`, `readback_recorded_at`, `retrieved_at` or `accessed_at` inside the member's `receipt`. Preserve the original acquisition metadata; a local file-import timestamp does not identify when the publisher's data were accessed.

## Original source references

- [Dataset](https://www.oecd.org/en/data/datasets/oecd-composite-leading-indicators-clis.html)
- [Data Terms, section 3](https://www.oecd.org/en/about/terms-conditions.html), reviewed 12 October 2026
- [Original source edition and metadata](SOURCE.md)
- [Complete application guide](README.md)

Stellar Forge supplies the independent report selection, index-point calculations and presentation. Original observations and metadata retain their publisher attribution.
