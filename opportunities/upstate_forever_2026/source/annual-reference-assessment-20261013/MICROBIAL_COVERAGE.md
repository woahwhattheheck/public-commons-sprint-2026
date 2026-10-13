# Assessment stations with retained utility E. coli measurements

## Decision context

The complete utility microbial cohort contains **730 observations at 36 stations**. Its exact station-identity join to the published assessment context identifies **four shared stations, 132 routine observations and eight assessment records**. The assessment context contains 159 stations and 192 records across the wider Upper Savannah study.

The four shared stations each have an E. coli assessment record. Four additional assessment records at the same stations concern turbidity, dissolved oxygen or pH. The retained samples provide microbial measurement context; the original assessment causes remain separate.

| Utility | Microbial stations | All observations | Physical assessment stations / records | Shared stations | Samples at shared stations | Shared assessment records |
|---|---:|---:|---:|---:|---:|---:|
| ARJWS | 5 | 142 routine | 6 / 10 | 3 | 120 | 5 |
| PRWD | 31 | 587 routine + 1 field replicate | 18 / 22 | 1 | 12 | 3 |
| Combined | 36 | 729 routine + 1 field replicate | 24 / 32 | 4 | 132 | 8 |

The other 32 observed stations contribute 598 records. They extend the microbial monitoring picture beyond this selected South Carolina assessment cohort. Seventeen are other SCDES stations, fourteen belong to the Georgia EPD namespace, and one is USGS-02177000. Organization prefixes remain attached to every observation and activity ID.

## The four actual station associations

| Assessment site | Utility | Retained routine samples | First sample | Latest sample in this edition | Assessment context |
|---|---|---:|---|---|---|
| SV-111 | ARJWS | 47 | 2021-01-06 | 2025-11-04 | 2024 turbidity listing; July 2026 E. coli attainment record |
| SV-735 | ARJWS | 23 | 2021-01-20 | 2023-05-03 | July 2026 E. coli attainment record |
| SV-833 | ARJWS | 50 | 2021-01-20 | 2025-12-02 | 2024 turbidity listing; July 2026 E. coli attainment record |
| RS-21014 | PRWD | 12 | 2021-01-06 | 2021-12-02 | 2024 E. coli, dissolved oxygen and pH listings |

The full WQP IDs are `21SC60WQ_WQX-` followed by the listed assessment site. Each match also has an original WQP station_name exactly equal to the SCDES site ID. The join uses that publisher-scoped identity, with no coordinate snapping or fuzzy name matching. Original assessment IDs and row locators remain attached.

All 132 shared-station observations use APHA 9223-B and the common physical unit MPN per 100 mL. They comprise 126 numerical results and six above-limit results: one at SV-111, one at SV-735 and four at SV-833. The latter retain their original limit and an unbounded upper endpoint. Their measured-result cells remain empty.

The whole source includes a separate PRWD field replicate at `21GAEPD_WQX-LK_01_11` on 2023-06-22, activity `21GAEPD_WQX-A00428245`, APHA 9221-F. It remains one of the 730 source records and is counted separately from the 729 routine samples.

## Source periods and use

The microbial source requested dates from **2021-01-01 through 2025-12-31**; the actual records run from 2021-01-06 through 2025-12-10. A station's last date is a statement about that retained source edition.

The 2024 assessment source explicitly covers 2018–2022. At SV-111, 16 of its 47 microbial observations fall within that window and 31 follow it. At SV-833 the corresponding counts are 21 and 29. All 12 RS-21014 samples fall in 2021. The July 2026 attainment source provides a publication/status edition; its records do not specify an assessment-period window, so the join leaves that window unset.

A station can have several assessment causes. Count distinct original activity IDs when combining views: the twelve RS-21014 samples relate to one station that has three assessment records, rather than thirty-six separate samples.

For the application and briefing:

- Show **four measured assessment stations / 132 samples** alongside the complete **36-station / 730-record** microbial study.
- Keep RS-21014 in the PRWD view. Its original station response has only a HUC8, while the completed original-coordinate join places it in Little Beaverdam Creek, HUC12 030601020506.
- Display source coverage dates beside station results. SV-735 and RS-21014 have earlier last dates in this captured edition than SV-111 and SV-833.
- Preserve analytical methods, source comments, detection status, original limits and the field-replicate distinction in inspection and export.
- Use the separate eleven annual-reference targets for nutrient and sediment model comparisons. The E. coli series supports microbial monitoring and station-level assessment interpretation.

An empty measurement count means **absent from this retained utility E. coli cohort**. The other 155 assessment stations include stations outside the two utility selections and stations requiring other monitoring sources.

## Reusable source and map integration

`microbial-assessment-sources.json` is an ordinary `upstate.sources/v1` manifest. Import it through the existing source queue or `Workspace.import_sources`. It adds an enriched point layer, the complete observation join and both station perspectives, together with the source-linked interpretation.

| File | Contents |
|---|---|
| `assessment-microbial-context.geojson` | All 159 original assessment geometries, with added measurement counts, source dates and station identities |
| `microbial-assessment-observations.csv` | All 730 original interval rows and their assessment association; original comments, clocks, methods and sample IDs retained |
| `microbial-assessment-observed-stations.csv` | All 36 observed stations and exact assessment coverage |
| `microbial-assessment-coverage.csv` | All 159 assessment stations, including explicit absence from this selected measurement cohort |
| `microbial-assessment-overlap.json` | Counts, complete station associations, eight original assessment records, input identities and primary publisher URLs |
| `microbial-assessment-coverage.mjs` | Executed pure JavaScript join and CSV reader for reuse with the complete original source editions |

In the maintained SpatialReview, choose source ID `assessment-microbial-geography159-20261013` from its actual imported collection. The exact filter `{"has_microbial_observations":true}` selects four points. Adding `"PRWD_geometry":true` selects RS-21014. Every coordinate and original assessment property is copied unchanged from the completed 159-station point layer.

The pure `buildCoverage(observationRows, stationSummaryRows, assessmentContext, geographicContext)` function consumes the complete original interval/station CSV rows, the closed 159-station assessment context, and the completed 217-HUC geographic join. It preserves all 730 activity identities, checks the original routine-count correspondence, and reports both complete station cohorts. The entire calculation was executed on those retained inputs. Source metadata identifies the exact byte editions.

## Sources

- [Original temporal analysis and its source selection](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/16b0e52c3f54764dc61deac423358d775eefe90c/opportunities/upstate_forever_2026/source/ecoli_temporal_analysis/20261013/README.md).
- [All 730 source interval records](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/16b0e52c3f54764dc61deac423358d775eefe90c/opportunities/upstate_forever_2026/source/ecoli_temporal_analysis/20261013/record-intervals.csv), SHA-256 `4ad3864e802385c038f4c9005ed72c79f93de6b930a5b66b061ac325143ddfa0`.
- [Original station summaries](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/16b0e52c3f54764dc61deac423358d775eefe90c/opportunities/upstate_forever_2026/source/ecoli_temporal_analysis/20261013/station-summary.csv).
- [Primary WQP requests, original rows and source hashes](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/16b0e52c3f54764dc61deac423358d775eefe90c/opportunities/upstate_forever_2026/source/ecoli_temporal_analysis/20261013/source-manifest.json).
- [Completed original-coordinate assessment and utility context](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/eaa20367bd7d2bc7e30046683eeda9102ee9b4ce/opportunities/upstate_forever_2026/source/annual-reference-assessment-20261013/README.md).
- [Closed complete assessment source edition](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8R6K30US), `results/station-assessment-context.json`, 1,187,125 bytes, SHA-256 `9bce42134d1c9434539c2982eef8f511f9966fd4f1a52150852ae04d2e9bc54a`.
