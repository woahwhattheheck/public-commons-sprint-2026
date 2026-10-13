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
method includes water-quality-context-native-identity-20261013, which gives the
corrected build its own reusable artifact identity.

## Source acquisition

Use the original captured classified-reach files and retained domain before creating another capture. A catalogue copy may omit any already-received entry. Classification acquisition is opt-in through --source-id scdes-hydro24k-classification-context-current; the default catalogue run fetches only the four source documents. Its full-state capture preserves all original records and is clipped locally to the selected study. A new capture uses the exact service object-id inventory, complete original field metadata and native coordinate system. All original responses and HTTP receipts remain companion files. Repeated acquisition with the same source id verifies the saved pair and resumes it; changed publisher content receives a new source id.

Run from the existing opportunities/upstate_forever_2026 project root:

    python -B -m source_tools.water_quality_context acquire \
      --catalog source/water-quality-context/catalog.json \
      --output /absolute/receiving/water-quality-sources

The resulting sources.json follows upstate.sources/v1 and enters the original Workspace.import_sources method. The first acquired document request is a real source read, not a test. The implementation does not trigger Actions or a repository test suite.

## Workbook field binding

Do not infer column meanings from position. Inspect the publisher workbook:

    python -B -m source_tools.water_quality_context inspect-table /path/303dList2024.xlsx

Select the actual sheet/header row and supply explicit source-column names for site, huc12 and cause; optional bindings preserve description, county, use, use_support and TMDL fields. The module rejects lost leading zeros in HUC values so a workbook number cannot silently become a different watershed.

Example binding shape:

    {"site":"ACTUAL_SITE_COLUMN","huc12":"ACTUAL_HUC_COLUMN","cause":"ACTUAL_CAUSE_COLUMN"}

Use actual inspected names in the operator form. The placeholders describe the shape and are not an executable source binding.

Normalize an explicitly selected source:

    python -B -m source_tools.water_quality_context normalize \
      --input /path/303dList2024.xlsx --source /path/source-entry.json \
      --bindings /path/actual-field-bindings.json --sheet ACTUAL_SHEET \
      --header-row ACTUAL_ROW --output /path/assessment-2024.json

The TMDL importer reads the full original PDF, retains page/row text and extracts the actual status date from its repeated headers:

    python -B -m source_tools.water_quality_context normalize \
      --input /path/TMDLAttainmentStatus.pdf --source /path/source-entry.json \
      --tmdl-pdf --output /path/tmdl-attainment.json

If a future publisher layout changes, complete parsed records and the exact unmatched row text are retained in the normalized bank. Exit status 2 identifies a source-layout correction needed before declaring a complete table. The current module has not yet executed on the PDF in this runtime because the shared native exec server became unavailable during source preparation.

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

Suggested operator registration:

- action water_quality_context_create invokes build_workspace_context on the selected workspace.
- state water_quality_contexts reads workspace._list("water-quality-contexts").
- native descriptor traversal uses the existing _files function.
- display the returned summary and existing water-quality-context.html report/downloads.
The extension does not edit shared server/browser files, which have several active sprint owners.

## Join to the watershed decision-report producer

Join context.watersheds to physical watershed results using huc12. The JSON includes direct assessment_ids and classified_feature_ids, local/upstream counts, cause families and exact source editions. The paired physical report should append this context to its existing baseline/alternative quantities, retaining its original run IDs, matched valid-pixel coverage and units.

The high-quality-water context supplies official classification codes and original feature links. A downstream decision panel can make the adopted weights or protection method explicit rather than deriving them from a support label. The exact physical benefits still come from the native model runs.

## Dependencies and execution

Python 3.10+, the maintained model package, Shapely 2, pyproj, the existing vector-reader dependencies, PyMuPDF for the TMDL PDF, and openpyxl for current XLSX workbooks. Acquisition and CSV-only normalization use the standard library. No new external accounts or paid services are required.

Authored for TokenJunkieLabs.
