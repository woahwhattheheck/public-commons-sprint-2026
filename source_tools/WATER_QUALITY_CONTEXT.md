# Water-quality context in the Upper Savannah product

This extension imports actual publisher evidence, connects it to the retained HUC domain, and creates reusable water-quality layers and reports. It complements native NDR/SDR calculations and the paired-raster watershed decision reports. Existing model runs keep their numerical outputs and units.

## What the operator can do

Select the original HUC domain, one or more publisher assessment editions, and the existing classified-reach capture. Build a context, inspect each focus watershed, open the exact site records, download editable GIS layers/tables, and reopen the context from the original Workspace. The output exposes the original source identifiers, editions, official assessment causes, and geographic membership.

The printable report contains the whole selected domain, ARJWS/PRWD focus labels, nonattaining site counts, TMDL support status, intersecting classification codes and upstream high-quality-water context. It links directly to CSV, GeoJSON and full JSON. Neutral industrial styling supports both a screenshare and print.

## Original sources and their meanings

The RFP requires a high-quality-water protection map alongside nutrient, sediment and drinking-water products. Its four focus HUC12s are 030601010703, 030601010704, 030601020502 and 030601020507. Retain the complete reporting and upstream domains; these four focus watersheds do not replace the full study.

The source catalogue contains:

- The published 2024 South Carolina 303(d) workbook. SCDES says this assessment uses 2018–2022 sampling.
- The complete July 28, 2026 TMDL attainment PDF. A site covered by a TMDL can remain nonattaining after leaving the 303(d) list. The two published Choestoea focus records, SV-108 and SV-301, are available in the machine-readable inventory.
- Current publisher copies of R.61-69 and R.61-68.
- The current SCDES hydro_24k service at SCHydroClass/MapServer/2, discovered from the publisher's water-quality map settings. Reuse the complete retained source scdes-classified-streams-upper-savannah-20261012. Its native OBJECTID field, H2OCLASS, publisher HUC_12 and original geometry remain bound to the capture.

On October 12, 2026, SCDES publishes its 2026 303(d) list as a draft and September 2026 standards changes as proposed revisions. Those records stay distinct from published/current source editions. The context builder excludes draft/proposed assessment records by default; a deliberate include_draft selection retains their status in every row.

Official source pages:
https://gis.des.sc.gov/stormwater/js/a_settings.js
https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2
https://app.notion.com/p/3f7dd77231008124b767e1dccf8a706e
https://www.des.sc.gov/programs/bureau-water/south-carolina-303d-list-impaired-waters-tmdls
https://des.sc.gov/programs/bureau-water/water-quality-standards
https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/TMDLAttainmentStatus.pdf
https://des.sc.gov/sites/des/files/Library/Regulations/R.61-69.pdf
https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf

## Scientific interpretation built into the data

Assessment evidence joins by the publisher's exact HUC12. The original site, use, cause, support status, TMDL relation and source row remain available. No match means that the selected records contain no evidence for that HUC; the software keeps support unspecified.

Bacteria, turbidity, suspended solids, dissolved oxygen, biological condition and nitrogen/phosphorus assessment causes remain separate families. They are context for selecting and explaining action; a 303(d) or TMDL support label is not a numerical annual load measurement.

Classified reaches retain their original geometries, native IDs, names and class notations. Named-reach descriptions in R.61-69 remain linked to the selected source edition. The provisional GIS classification status is preserved, including where a listed waterbody changes class at a named location. The extension does not silently assign a whole river the class of one reach.

Spatial intersections and measurements use the existing model.rasters.vector_geometry reader in EPSG:5070. GeoJSON exports use EPSG:4326. Upstream context uses the original ToHUC graph and includes only the selected original domain. It is a HUC-scale geographic connection, so the report keeps it distinct from per-pixel flow routing or a protection score. An intersecting boundary reach can have links to adjacent HUCs; global feature totals count unique source features rather than summing per-HUC intersections. A classified line requires positive intersecting length, and a classified polygon requires positive intersecting area. Boundary-only touches do not assign a classification to the adjacent HUC.

## Native classification identity

The current publisher field definition names **OBJECTID** as esriFieldTypeOID,
with the display alias **OBJECTID_1**. A different field is named OBJECTID_1;
it is an ordinary nullable integer and has display alias OBJECTID. The captured
original sample has OBJECTID 218303 and OBJECTID_1 null. Field names and their
display aliases must remain distinct.

The importer now resolves the source ID from the original Esri metadata and the
retained source entry. An explicit classifications.id_field or --class-id-field
selects a native field for an older retained edition. If the source declares a
different typed OID, the error names both fields. Every selected feature still
requires a nonempty, unique original ID. When a vector driver exposes that OID
as its native feature ID and omits it from the properties, the importer restores
the field only after matching the feature ID to the original response's values.

The resulting classification_source.object_id_field and identity_binding retain
the chosen field, its exact field definition, resolution basis and any IDs
recovered from the driver. Source attributes retain their original names.
The current source's mapped_classification_status also enters the context
classification_status. The adopted named-reach regulations keep their own source
edition and interpretation.

For the complete existing ECO-SOURCE12 capture, use source ID
scdes-classified-streams-upper-savannah-20261012 from its original source
collection. Its 1,886 unique native records comprise 1,040 ORW, 247 TN and
599 TPGT features. The 4,978,867-byte original geometry, field dictionary and
complete 168,811-byte attribute CSV are retained with that source. The CSV's
SHA256 is ce95ef233822d1205f5fda534e95e361a933147301f787906b509f8b4525cf18.
Current source dictionaries and typed data are also in F0C9J6KRJDN.

The new optional acquisition ID names the current hydro_24k service so a saved
older Water_Classifications acquisition keeps its original URL and source
identity. Existing older source collections can be selected directly with their
actual metadata or explicit native ID field.

The standalone build command accepts --class-id-field, --class-field and
--class-name-field for exact source-column selection. Ordinary current-source
builds can omit these flags because the native ID is declared by the source and
the class/name columns retain their documented defaults. The saved context
method includes water-quality-context-native-identity-causes-20261013, which gives the
corrected build its own reusable artifact identity.

## Source acquisition

Use the original captured classified-reach files and retained domain before creating another capture. A catalogue copy may omit any already-received entry. Classification acquisition is opt-in through --source-id scdes-hydro24k-classification-context-current; the default catalogue run fetches only the four source documents. Its full-state capture preserves all original records and is clipped locally to the selected study. A new capture uses the exact service object-id inventory, complete original field metadata and native coordinate system. All original responses and HTTP receipts remain companion files. Repeated acquisition with the same source id verifies the saved pair and resumes it; changed publisher content receives a new source id.

Run from the existing opportunities/upstate_forever_2026 project root:

    python -B -m source_tools.water_quality_context acquire \
      --catalog source/water-quality-context/catalog.json \
      --output /absolute/receiving/water-quality-sources

The resulting sources.json follows upstate.sources/v1 and enters the original Workspace.import_sources method. The first acquired document request is a real source read, not a test. The implementation does not trigger Actions or a repository test suite.

## Published workbook field binding

The native 96,620-byte published workbook has one sheet, `303D LIST FOR WEB`, with its unique header on row 1. It contains 1,258 assessment rows and the publisher's EPA-addition footnote on worksheet row 1260. All source HUC12 values preserve their leading zero.

The current source's exact bindings are:

    {"site":"SITE","huc12":"HUC 12","cause":"CAUSE","description":"DESCRIPTION","county":"COUNTY","use":"IMPAIRED USE"}

The catalogue retains these bindings and the source's `scdes_303d_codes` encoding. The operator reads the original sheet and suggests those exact columns.

Run normalization from the existing project:

    python -B -m source_tools.water_quality_context normalize \
      --input /path/scdes-303d-list-2024.xlsx --source /path/source-entry.json \
      --bindings /path/field-bindings.json --sheet "303D LIST FOR WEB" \
      --header-row 1 --output /path/assessment-2024.json

The publisher's own code guide appears on PDF pages 8–9:
https://www.des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/303dList2024.pdf

Multiple listed causes become individual cause records. The current workbook's original punctuation variants `TN. TP, ECOLI` and `HGF PCB` follow the same documented code dictionary. Each record preserves the full original cause cell, combined source use, source worksheet row, exact raw fields and EPA footnote markers. The source-wide footnote remains in the normalized bank. Unique site totals remain deduplicated across causes and selected source editions.

For a future workbook edition, the existing inspection command displays its native sheet and header before binding:

    python -B -m source_tools.water_quality_context inspect-table /path/current-workbook.xlsx

The TMDL importer reads the full original PDF, retains page/row text and extracts the actual status date from its repeated headers:

    python -B -m source_tools.water_quality_context normalize \
      --input /path/TMDLAttainmentStatus.pdf --source /path/source-entry.json \
      --tmdl-pdf --output /path/tmdl-attainment.json

If a future publisher layout changes, complete parsed records and the exact unmatched row text are retained in the normalized bank. Exit status 2 identifies a source-layout correction needed before declaring a complete table. The current PDF parser handles the publisher's PEEDEE spelling, SHELLFISH use, multiword report identifiers, spaced In TMDL relation, and adjoining cause/status cells. The native PyMuPDF reader completed all 813 rows on 39 pages with zero unparsed rows. Its normalized bank records the native publisher PDF hash. The original PDF and workbook are also retained with the source collection.

## Original Workspace integration

Call:

    record = build_workspace_context(workspace, selection)

Selection contains:

- domain: collection_id, source_id, actual huc_field, actual to_field or an original topology_companion, and optional layer.
- classifications: collection_id, source_id, optional layer and id_field; class_field defaults to H2OCLASS and name_field to HYDNAME. The original ID comes from retained source metadata when id_field is omitted.
- assessments: any number of collection_id/source_id references, each with format tmdl_pdf, table or normalized; table selections include explicit bindings, optional sheet and header_row.
- title and include_draft.

The adapter reads every selected source through Workspace.source_file, creates the context under workspace.root, imports its complete output manifest, and saves an immutable water-quality-contexts record. Each record.files entry uses model.common.describe_file. The current operator's recursive _files handler can expose those authenticated download tickets directly. Complete workspace backup already retains the added files and records.

The selection and identity-method version identify the artifact folder. The immutable Workspace record has its own digest; this avoids a circular dependency between the output path and record content. Reopening a completed selection verifies the retained file descriptors and reuses it.

## Operator panel

The maintained operator loads `operator/extensions/water-quality.json`, the Python provider in `operator/extension_modules/water_quality.py`, and the browser module `operator/web/water_quality.mjs`. Its existing task queue runs `water.quality.context.build` and `water.quality.sources.acquire`. Source acquisition immediately imports complete native source manifests into the selected Workspace.

The Water-quality context panel offers source acquisition, ordinary source import, actual workbook/sheet/header inspection, original domain and reach selection, draft-edition selection, and a complete context build. The vector inspector exposes the typed native OID when a driver presents it as a feature ID. It preserves the separately named nullable field and its display alias.

Results include all selected HUCs, focus utility labels, local/upstream evidence, original assessment rows, class codes and source editions. Filters select utility, focus watersheds, cause, site or HUC. Original task details and authenticated downloads remain available through the existing operator. State is registered under `data.water_quality`; records use item kinds `water_quality_contexts` and `water_quality_acquisitions`.

## Current retained source data

The original 614,545-byte TMDL PDF and 96,620-byte published 2024 impairment workbook are attached to the existing ECO-SOURCE12 page:
https://app.notion.com/p/3f7dd77231008124b767e1dccf8a706e

That page also carries the full publisher text capture, an 813-row CSV, a 217-HUC join and a native `upstate.sources/v1` import manifest. The CSV preserves source page and every published column. Exact HUC joins yield 84 sites in 44 domain watersheds: 79 with Not Supported and five with Fully Supported labels. All 84 rows in that selected TMDL domain join have the ECOLI cause. Choestoea includes SV-108 and SV-301. Every one of the original 217 HUC identifiers appears in the domain output.

The 2024 impairment workbook remains a separate source edition. Its causes and support labels enter the context through explicit inspected bindings. The older Water_Classifications service and the current SCHydroClass service also remain distinct catalogue entries with their original native OID definitions.

## Join to the watershed decision-report producer

Join context.watersheds to physical watershed results using huc12. The JSON includes direct assessment_ids and classified_feature_ids, local/upstream counts, cause families and exact source editions. The paired physical report should append this context to its existing baseline/alternative quantities, retaining its original run IDs, matched valid-pixel coverage and units.

The high-quality-water context supplies official classification codes and original feature links. A downstream decision panel can make the adopted weights or protection method explicit rather than deriving them from a support label. The exact physical benefits still come from the native model runs.

## Dependencies and execution

Python 3.10+, the maintained model package, Shapely 2, pyproj, the existing vector-reader dependencies, PyMuPDF for the TMDL PDF, and openpyxl for current XLSX workbooks. Acquisition and CSV-only normalization use the standard library. No new external accounts or paid services are required.

Authored for TokenJunkieLabs.

## Source-water priority and assessment crosswalk

`source_tools.source_priority_assessment` joins the retained NRCS state-HUC context to complete normalized assessment editions through their original HUC12 values. It exports complete JSON, watershed CSV, original state-HUC CSV, edition CSV and a readable HTML comparison. Each state portion, source-water system type, original source identity and assessment edition remains explicit.

```sh
python -m source_tools.source_priority_assessment \
  --domain-hucs source/water_context/20261013/domain-huc12s.json \
  --nrcs-context source/water_context/20261013/full-domain-water-context.json \
  --assessment /path/303d-2024-native-normalized.json \
  --assessment /path/tmdl-attainment-native-20260728.json \
  --output /path/source-priority-context
```

`source/water-quality-context/native-inputs-sources.json` retains the exact manifest for the acquired 2024 workbook and July 2026 PDF. To import these originals, place that manifest beside the retained original files named by its entries, then use the ordinary source importer. The native files remain in the science workstream's existing source archive.

## Expanded classification names

The existing water-quality desk, watershed table, reach detail, context CSV/GeoJSON and HTML report pair classification codes with readable names. The raw H2OCLASS value, normalized codes, original feature IDs and selected source editions remain separate fields.

Classification **TN means Trout Natural**. Assessment-cause **TN means Total nitrogen**. Other trout classifications expand to Trout Put, Grow, and Take (TPGT) and Trout Put and Take (TPT). Classification names follow [the SCDES publisher copy of R.61-68, Section G](https://des.sc.gov/sites/des/files/Library/Regulations/R.61-68.pdf), with the May 23, 2025 amendment listed in its publication history. This display mapping preserves the existing source geometry, classification status and reach selection.

New context outputs add classification_labels on each classified feature/link, direct_classification_labels and upstream_of_high_quality_labels on each watershed, and a publisher reference in method.classification_label_source_uri. Existing saved contexts receive readable names in the browser through the same code mapping, so opening an accepted edition does not require rebuilding its geographic intersections.
