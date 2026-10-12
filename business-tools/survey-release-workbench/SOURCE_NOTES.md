# Original sources and survey semantics

## Complete published collection

The source is NYC DOHMH's public [Environment & Health Data Portal repository](https://github.com/nychealth/EHDP-data), production commit **08d6e68f6e1d744f31b54401ec3165520681bb95**, acquired on 12 October 2026. The [official portal describes and links this repository](https://a816-dohbesp.nyc.gov/IndicatorPublic/data-stories/redesign/).

The workbench includes every indicator file whose indicator metadata in that pinned revision references the Community Health Survey: **36 files, 85 distinct measures and 36,836 observations**. Observation periods span 2002–2022, including pooled periods. These are the actual published historical estimates in the selected snapshot, not newly collected survey responses.

The selection is at the indicator level. Original source descriptions and populations are preserved for each measure, including any combined source description; the interface does not infer that all records share one sample or population.

The complete original metadata file contains 269 indicators; the profile selects the 36 corresponding data files. The source manifest records original paths, UTF-8 byte sizes, SHA-256 values and available Git blob identities. All original JSON texts are retained, including the complete time-period and geography dictionaries.

The city's source files use parallel arrays: MeasureID, GeoID, GeoType, TimePeriodID, Value, CI, Note and DisplayValue. The adapter checks that their lengths agree and joins metadata on the full observation key. Geography IDs are only meaningful together with their geography type.

## Published estimates and cautions

The actual selected collection includes:

- **1,050 suppressed observations**, retaining the publisher's \`**\` display marker and suppression note.
- **9,035 other observations with a source caution**, including small-number and relative-standard-error notes.
- **198 observations using historical UHF33 geography**.

The raw \`Value\` and the published \`DisplayValue\` are separate fields. Publication uses DisplayValue. It never substitutes a raw numeric estimate when the source's display is suppressed or missing. Confidence intervals remain the published source strings; they are not recomputed. Original spellings and source notes, including historical typographical errors, are retained.

The workbench provides no new sample weighting, variance estimation, confidence interval or significance test. A comparison between compatible source periods is a descriptive arithmetic difference only. Counts, rates, crude percentages and age-adjusted percentages are separate measurements with separate definitions.

## 2021 design break

Each of the 85 selected measure definitions explicitly carries \`TrendNoCompare: "2021"\`. This is a year string, not a boolean.

The [current CHS overview](https://www.nyc.gov/site/doh/data/data-sets/community-health-survey.page) identifies the move to address-based sampling in 2021. The [separate methodology page](https://www.nyc.gov/site/doh/data/data-sets/community-health-survey-methodology.page) describes the earlier telephone and dual-frame design. Its legacy weighting and variance details are not assumed to apply to later survey years.

The workbench uses the exact start/end dates in the original TimePeriods file to label observations before, from or spanning the metadata's break. It does not calculate a trend difference across that break. The selected dataset contains 32,184 observations before 2021 and 4,652 from 2021 onward.

Where the measure's own calculation text explicitly identifies a change to imputation beginning in 2017, comparison logic also preserves that stated boundary. Other source descriptions remain visible in full. A descriptive comparison does not settle scientific comparability beyond the documented checks.

See [year-specific CHS public-use documentation](https://www.nyc.gov/site/doh/data/data-sets/community-health-survey-public-use-data.page) for actual survey designs, codebooks and analysis guidance.

## Historical UHF33 geography

The pinned current GeoLookup file omits UHF33. The source observation files still contain the original 198 UHF33 observations from 2002. Their identifiers are retained and joined to a separately documented, source-derived supplement.

The authoritative historical sources are:

- [Original NYC CHS 2002 SAS formats](https://www.nyc.gov/assets/doh/downloads/sas/episrv/formats_chs2002_public.sas), the \`value uhf33f\` table.
- [CHS 2002 public-use codebook](https://www.nyc.gov/assets/doh/downloads/pdf/episrv/chs2002-codebook.pdf), printed page 30 / zero-based PDF index 29.
- [Official historical UHF map](https://www.nyc.gov/assets/doh/downloads/pdf/survey/uhf_map_100604.pdf), printed September 2006. Its date comes from the document, not the filename.

The 2002 SAS format uses ordinal values 1–33, while EHDP uses concatenated three-digit component codes. The supplement preserves both. For example, original ordinal 15 describes Flatbush–Canarsie with components 207 and 208; its EHDP GeoID is **207208**. Ordinal 30 describes Western Queens–Long Island City with components 401 and 402; its EHDP GeoID is **401402**. Union Square (309) and Lower Manhattan (310) are separate in UHF33. They are combined as 309310 in the later UHF34 system.

The 33 UHF33 groups partition the 42 original component codes. They are not a one-area omission from UHF34. The supplement's JSON is a source-derived transcription with its own checksum. Its checksum is not represented as an original SAS or PDF byte checksum.

The official map separately labels Community Health Survey–2002 / 33 neighborhoods and Community Health Survey–2003–2005 / 34 neighborhoods. It also distinguishes original 2002/2003 boundaries from projected 2006 boundaries. The supplement therefore supplies original labels and group membership only. Coordinates and geometry remain null. Current UHF42 or UHF34 polygons are not represented as exact 2002 geometry.

## Delivery and reuse

The source manifest and all source texts travel in the saved case. Review events carry row identifiers, actions, notes, timestamps and their previous event. The original estimates are never edited by a review action.

A release edition identifies the source case, review revision and publication scope. Its CSV and structured JSON retain suppression and notes; its codebook carries the complete measurement definitions and break metadata. Exclusions remain in the structured release and review history. Reopening the source case reconstructs the same observation keys and review decisions.

The upstream data repository declares Apache 2.0. Its complete license is retained at \`data/source/LICENSE\`. The original source references do not imply a commission, affiliation or scientific endorsement of this application by NYC.
