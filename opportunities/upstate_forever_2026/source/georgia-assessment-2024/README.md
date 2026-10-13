# Georgia approved 2024 assessment context

This source family adds Georgia's original reach assessments to the existing regional source/map/report workflow. The assessment unit is a publisher-defined waterbody reach. Its identity stays separate from a monitoring station, a model catchment and a twelve-digit watershed.

## Source edition

Use the original 2024 workbook and GIS edition from Georgia EPD. EPA's approval letter is dated 3 September 2024. The publisher’s 2026 list is labeled draft and requires its own edition-specific transformation; these modules intentionally implement the approved 2024 method.

Primary sources:

- [Georgia's integrated lists and original 2024 workbook](https://epd.georgia.gov/water-quality-georgia)
- [Original2024 workbook](https://epd.georgia.gov/document/document/2024305b303dexcelversionxlsx/download)
- [August 2024 listing methodology](https://epd.georgia.gov/document/document/finallistingassessmentmethodology2024305b303dpdf/download)
- [Description of list fields](https://epd.georgia.gov/document/document/descriptionof305b303dlistofwaters2024updatedocxpdf/download)
- [Code key](https://epd.georgia.gov/document/document/data-sourcecode-key-abbreviations-2024-list/download)
- [Final 2024 highlights and changes](https://epd.georgia.gov/document/document/highlights-2024-listpdf/download)
- [EPA approval letter](https://epd.georgia.gov/document/document/epa2024303dapprovalletterpdf/download)
- [Original2024 GIS package](https://epd.georgia.gov/document/document/ga2024305b303dshapefilezip/download)
- [Published stream rows](https://epd.georgia.gov/document/document/2024305bstreamspdf/download)
- [Published lake rows](https://epd.georgia.gov/document/document/2024305blakespdf/download)

The methodology PDF has stale2022 metadata in some search tools; its actual document heading and footer identify the 2024 methodology. The code uses the actual document edition.

## Preserve the scientific meaning

Categories 1,2,3,3N,4a,4b,4c,5 and5R remain explicit. The full methodology places both 5 and 5R on the303(d) list. A row can contain different categories for different pollutants. The normalizer retains that row; it never creates every possible cause/category/use combination.

Overall “Not Supporting” can summarize one failing use while other uses meet their criteria. Raw designated uses, causes, categories, priority and notes therefore remain together. Historical TMDL notes are also preserved on currently Supporting rows. Priority is a planned TMDL drafting year or a literal label such as Low, rather than a conservation-ranking score.

The2024 methodology generally considers 2021–2023, with older decisions and parameter-specific periods retained where applicable. The general method window is metadata, not an invented sample period for every reach.

The final highlights explain that a Bacteria listing can carry an older fecal-coliform impairment until indicator-specific information is available. Bacteria, E. coli, enterococci and fecal coliform remain separate descriptions. Biological fish/macroinvertebrate impairment is not converted to a modeled sediment load. Source code NP means nonpoint source.

## Actual regional interpretation

The published Broad River row GAR030601040302 contains4a and5. Its notes distinguish the older bacteria TMDL from E. coli assessment of the added Recreation use. Other Broad reaches are Supporting; a river-name filter alone cannot describe the whole river.

Hartwell reach GAR030601030201 has a Fishing/PCB impairment while its notes say Drinking Water and Recreation meet their uses. Treating its overall status as drinking-water failure would change the publisher's conclusion.

Chattooga reach GAR030601020223 includes E. coli and fish-tissue impairments. Its Priority column and narrative contain different future fish-tissue drafting years. Both original fields are retained. The application does not silently select one date.

Georgia also has a Chattooga River in the Coosa basin. Exact ReachID and edition-specific geometry distinguish it from the Savannah basin reach.

## Original worksheet interface

ECHO-SOURCE12-PUBLIC owns the original workbook acquisition/export. Its native row and cell values should be kept complete. It directly accepts the exporter's commons.original-workbook-cells/v1 manifest.json plus all declared sheet JSON and original package members. The actual input URI/hash/byte count must match the selected workbook. Bind a unique original header, or use {column:"C", expected_header:"actual original header"} for an explicit original Excel coordinate. It also consumes the simpler retained-row interface:

```json
{
  "worksheets": [
    {
      "name": "exact original worksheet name",
      "header_row": 1,
      "columns": ["exact original headers"],
      "rows": [
        {"row_number": 2, "values": {"exact original header": "original value"}}
      ]
    }
  ]
}
```

Header and row numbers above illustrate the interface; receiving configuration must use the actual workbook's positions. Plain, unfiltered row objects are also supported when header_row and contiguous original row order are supplied. The preferred wrapper preserves explicit row numbers even when the exporter omits empty rows.

Configuration names the original workbook ID, URI, byte count, SHA256, assessment_cycle 2024, publication_status EPA-approved, approval_date 2024-09-03 and captured_at. Each selected worksheet specifies its exact name/header row and column bindings. Required bindings are reach_id, reach_name, basin, assessment and category. Optional bindings preserve reach_location, county, uses, data_provider, causes, sources, size, unit, priority and notes.

Missing configured headers fail explicitly. Non-assessment notes/footers are retained separately. Unknown categories or assessment labels are retained with an issue entry. Record identity binds workbook hash, worksheet, original row and ReachID.

## Normalize through the existing source workflow

```sh
node source_tools/georgia_assessment.mjs \
  --input ORIGINAL_EXPORT_DIRECTORY/manifest.json \
  --configuration EXACT_NORMALIZATION_CONFIGURATION.json \
  --original-workbook ORIGINAL_2024_WORKBOOK.xlsx \
  --output RECEIVED_GEORGIA_CONTEXT
```

The complete statewide selected sheets remain in assessments.json. report-section.json selects the publisher Savannah River Basin. sources.json is an ordinary upstate.sources/v1 manifest; original workbook, worksheet export and exact configuration are companions. Import it through the existing source importer.

The default report summarizes categories and actual watershed memberships, with a link to all original row details. includeReachTable:true can include the complete selected reach table without an arbitrary cap. Category and HUC counts can overlap, so they are not added as unique totals.

The report section uses the maintained scientific composer tuple shape, [heading, blocks]. It can join the existing Source route / assessment delivery producer as a jurisdiction-scoped section.

## Join actual reach geometry to original watershed polygons

The Python module uses model.rasters.vector_geometry, the current native reader, then Shapely intersection in EPSG26917. Its configuration identifies each actual original source path, SHA256, URI, CRS, layer where necessary, exact reach-ID field and optional native feature-ID field. All original sidecars have their own hashes. Domain configuration identifies the original polygon source and actual HUC field; expected_domain_hucs can require the retained 217-member set.

```sh
python source_tools/assessment_reach_geography.py \
  --assessments RECEIVED_GEORGIA_CONTEXT/assessments.json \
  --configuration EXACT_GEOMETRY_CONFIGURATION.json \
  --output RECEIVED_GEORGIA_GEOGRAPHY
```

The outputs are assessed-reaches.geojson, geometry-relations.json, geography-context.json and domain-hucs.json. geography-sources.json imports the mapped original reaches, original source bodies and sidecars, complete relation table and normalized assessment rows through the same maintained source workflow.

The relation table retains the native reach/feature IDs, original geometry and domain hashes, CRS, positive intersected length or area and measure unit. Boundary-only contacts are separate. A feature can cross multiple HUCs; its assessed-reach count must not be presented as a station count or a unique-HUC count. Reach geometry is displayed whole, with explicit domain membership; a partially intersecting reach does not label every water in a watershed.

Feed the relation files back into the normalizer with --relations and --domain-hucs to produce the domain-selected report edition:

```sh
node source_tools/georgia_assessment.mjs \
  --input ORIGINAL_WORKSHEET_EXPORT.json \
  --configuration EXACT_NORMALIZATION_CONFIGURATION.json \
  --original-workbook ORIGINAL_2024_WORKBOOK.xlsx \
  --relations RECEIVED_GEORGIA_GEOGRAPHY/geometry-relations.json \
  --domain-hucs RECEIVED_GEORGIA_GEOGRAPHY/domain-hucs.json \
  --output RECEIVED_GEORGIA_DOMAIN_CONTEXT
```

No monitoring coordinates, station identities or HUCs are derived from the digits of a Georgia ReachID. Original station-to-reach associations can be added as a separately sourced relationship table when available.

## Shared jurisdiction geography adapter

The geometry adapter is also used by the North Carolina source arm. Its configuration declares assessment_schema, jurisdiction, optional record_collection (defaults to records) and optional record_fields mapping (id, name, assessment, categories, cause, listed). Geometry outputs retain a generic assessment_unit_id plus the selected native ID field. Edition metadata comes from the original normalized bank; Georgia approval/category meanings are not applied to North Carolina. source_id_prefix names a distinct source entry per jurisdiction and edition.
