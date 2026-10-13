# North Carolina final 2022 Upper Savannah assessment context

## What the original source adds

This complete edition supplies the North Carolina assessment-unit context for the Upper Savannah study. It retains all 110 original stream assessment units, 34 additional polygon representations of those same units, 77 parameter records and the one selected monitoring-station feature. The original service is published by NCDEQ and linked from its final 2022 integrated-report materials.

The 34 polygons share their assessment-unit IDs with the stream layer. Their original unit types are 29 Creek and five Creek Impoundment. They add geometry; they do not add 34 independent assessment units. Original AU_ID and AU_Number remain distinct, and neither is treated as a HUC12.

| Original stream-level assessment | Assessment units |
| --- | ---: |
| Meeting Criteria | 23 |
| Data Inconclusive | 4 |
| No Data | 83 |
| Total | 110 |

All 77 parameter records attach to 27 of the 110 selected units. Their original categories are 71 category 1, five category 3a and one category 3z1. The original parameter criteria statuses are 71 Meeting Criteria and six Data Inconclusive. These totals describe the retained final-2022 service selection.

The source is selected using publisher HUC8 values 03060101 and 03060102. Exact membership in the 217-HUC model domain is produced separately from the original feature geometries by the maintained assessment_reach_geography.py helper. Boundary contacts remain separate from positive line-length and polygon-area intersections.

## Findings to inspect in the existing study

| Assessment unit | Waterbody | Original record to inspect | Source status |
| --- | --- | --- | --- |
| 10475 / 3-10-3 | Big Creek | Fish Community: category 3a, Not Rated Bioclassification; Iron: category 3z1, Legacy RAMS Assessments | Both EPA_APPROVED |
| 10516 / 4-13-10 | Burlingame Creek | Benthos: category 3a, Not Rated Bioclassification | EPA_APPROVED |
| 10533 / 4-13-9 | Hogback Creek | Benthos: category 3a, Not Rated Bioclassification | EPA_APPROVED |
| 13394 / 4-13-5-(3)a | Trays Island Creek (Fairfield Lake) | Separate fecal-coliform records for Meeting Criteria and Screening Excursions, categories 1 and 3a | Both DRAFT; original cycle 2020, collection year 2018 |
| 10512 / 4-13-(0.5)b | Horsepasture River | Water Temperature (20ºC, AL, Tr): category 3a, Data Inconclusive | Original status is empty |

Use the exact native AU_Number in assessments.json when selecting a unit. Each listed parameter remains a separate record with its native ASMT_ID, OBJECTID, source path, SHA256 and original JSON pointer. The six inconclusive parameter records occur at five units; the original overall stream layer labels four units Data Inconclusive. Both source levels are retained.

The station feature is H6000000, agency NCAMBNT, at Horsepasture River at NC 281 near Union; its AU_ID is 10512. Station counts describe the selected station layer in this assessment service. The same study's measured microbial observations and other state monitoring layers remain separately identified sources.

The 83 No Data labels identify places where this edition offers no parameter assessment. They support a source-coverage discussion alongside actual monitoring data, watershed connections and model scenarios. Counts are not measurements of nutrient or sediment loads.

## Publication edition, assessment cycles and row status

The original NCDEQ final-2022 feature service contains 75 parameter rows with CYCLE 2022 and two rows with CYCLE 2020. Original ASMNT_STATUS values are 66 EPA_APPROVED, five DRAFT and six empty. The adapter preserves each cycle and status instead of promoting every row to the service's publication status.

The two 2020 records both concern fecal coliform at assessment unit 13394, with collection year 2018. They have separate assessment IDs 14374 and 14375 and different categories and reasons. The full parameter table retains both. The three other DRAFT rows concern benthos at Chattooga River and West Fork Overflow Creek, and fecal coliform at Horsepasture River.

The official 2022 methodology uses a primary 2016–2020 data window and identifies 2019–2020 as newer data. Prior decisions may carry forward when newer evidence does not change the assessment, and the methodology permits older 2011–2015 observations to supplement small current datasets. Every row's COLLECTION_YEAR and ASMNT_DATE remain available independently of this general method, its CYCLE and the capture date.

Source field text, including constituent spellings and units, is retained exactly. Classification abbreviations and parameter criteria are interpreted within their own publisher fields. The assessment source does not calculate new regulatory status from model outputs.

## Complete files and native use

The delivered sources.json contains two ordinary maintained source entries:

1. The normalized assessment table with its full original companions.
2. An OBSERVED_CONTEXT document using the existing upstate.observed-report/v1 recipe.

Import sources.json through the current Workspace source-import operation, then select the North Carolina final-2022 recipe in the existing Scientific Reports composer. The recipe includes the summary tables, all 77 parameter records, original row-status counts and source links. Every recipe input travels with the document entry, so the same input files are present after saved-project export and independent receiving.

Use the same original project for geography. Configure the shared helper with assessment_schema upstate.nc-integrated-assessment/v1, record_collection assessment_units, jurisdiction NC, record_fields.id native_reach_id and the receiver's exact original 217-HUC domain file. Use the 22 original stream pages and seven original polygon pages as separate source entries. The original AU_ID field is numeric; the maintained helper preserves its value and uses canonical integral text for the join.

Import the resulting geography-sources.json alongside the normalized sources.json. Its vector source supplies the ordinary Spatial Review layer, source geometry and all HUC relationships. Feeding geometry-relations.json and domain-hucs.json back to the normalizer adds exact domain totals and membership to the scientific recipe.

The maintained command is:

~~~sh
node source_tools/north_carolina_assessment.mjs \
  --input source/nc_assessment_2022/20261013 \
  --configuration source/nc_assessment_2022/20261013/normalization-inputs.json \
  --output PATH_TO_NC_CONTEXT
~~~

When the original geometry course completes, add --relations PATH_TO_GEOMETRY_RELATIONS and --domain-hucs PATH_TO_DOMAIN_HUCS, keeping the same inputs and normalized-source ownership.

Original capture files are retained as an intact subtree in original/. Source locators resolve directly from the normalized bank to those files, with capture_path separately retaining the acquisition-relative name. The bank indexes 144 original geometries by exact source path and /features/N/geometry pointer. It keeps geometry in the original response once rather than copying tens of thousands of coordinate values into the normalized bank. All 49 original response byte strings, full original capture catalog, three CSV previews and original source manifest remain unchanged.

## Primary and retained sources

- NCDEQ integrated-report files: https://www.deq.nc.gov/about/divisions/water-resources/water-planning/modeling-assessment/water-quality-data-assessment/integrated-report-files
- Original final-2022 service: https://services2.arcgis.com/kCu40SDxsCGcuUWO/ArcGIS/rest/services/2022_Integrated_Report_Overall_Stream_Assessment/FeatureServer
- Original NCDEQ service item: fd9604db2885417f887d27e9b30dc0d9.
- Official methodology, approved May 13, 2021: https://www.deq.nc.gov/water-quality/planning/tmdl/303d/2022/2022-303d-listing-methodology-final/download
- Complete original 56-file capture: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8MR8H2QM
- Exact maintained input configuration: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8V4ZDG7K
- Shared original-reach geography implementation: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8R23A5UN

The capture is dated October 13, 2026. Original requests and all byte identities are retained in original/capture.json.
