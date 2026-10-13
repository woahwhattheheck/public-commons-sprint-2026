# Original South Carolina planning-basin source

These five companions are the byte-for-byte original source already pinned by the Upper Savannah programme. They are retained here so the cumulative application can prepare its reporting boundary without downloading the same source again.

Original source commit: https://github.com/capellett/scsf/tree/45f7ea3ca968c96e2fc6188d7f55c3b0ce60da95/data-raw/planning_basins2023

The shapefile contains eight original records. Select `Basin == "Upper Savannah"`, original one-based shapefile record 5. Its native CRS is NAD83 / UTM zone 17N (EPSG:26917), in metres. That record has one ring and 10,285 original vertices, with native bounds [284385.4062999999, 3714410.5, 427122.3130000001, 3883978.25]. Keep the separate 217-HUC upstream contributing domain for model input extent.

| Original member | Bytes | SHA256 |
| --- | ---: | --- |
| PlanningBasins2023.shp | 1600228 | 133bc5369bd0d68bfdb53c61e3df24f9445f799b0d68b301f321d2c49d71eab6 |
| PlanningBasins2023.dbf | 874 | 0c792056dcaff94eaa9fb5a22d576a6c42bcce763a885a289f4cdd15434b4dba |
| PlanningBasins2023.prj | 424 | 16375a22022b8b34455292d576c5ebb590083e406d754a9abbcca6994c3e3261 |
| PlanningBasins2023.shx | 164 | 60572d5c75694110fceab00c24ba9b3607756838585f2b315c5abcbeac0034c6 |
| PlanningBasins2023.shp.xml | 12530 | 95776aa0ff34820f077e04695975af1eb73a3f21d03642c827623324e47a73ec |

The companion XML is retained unchanged, including its older lineage and incomplete publisher metadata fields. The filename and source commit identify this programme's pinned edition; they do not establish a newer survey or county-boundary date.

The existing `source_tools.reporting_parcels boundaries` and `run` operations first verify and reuse these bundled originals into their retained `original-reporting/` directory. Each reused member records its original URI, actual input path, bytes and SHA256 under `reporting-responses/`. When these original companions are absent, the same operation retains its existing download path and provider retry handling.

County selection remains the positive-area intersection of this exact reporting polygon with the separately acquired official county boundaries. Parcel and native GIS preparation keep their current whole-polygon/source-edition semantics.
