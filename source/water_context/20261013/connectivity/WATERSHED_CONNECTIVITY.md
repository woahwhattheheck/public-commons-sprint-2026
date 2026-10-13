# Upper Savannah — original watershed connectivity

Calculated 13 October 2026 for the existing Regional watersheds workflow.

## Regional result

The retained 217-HUC model domain is fully connected to the original USGS WBD downstream records. The original response contains 303 distinct HUC12 records; every model-domain HUC has a known downstream link. All paths reach the publisher's OCEAN terminal, and the supplied graph contains no cycle through the domain. There are 119 headwater HUCs within the retained domain.

The original national query found **zero** HUCs outside the captured Savannah HUC6 whose ToHUC enters the selected 217-HUC domain. This is the original 11-byte count response retained with the source query. The 217 original WBD acreage values exactly match the received regional context, totaling **4,659,072.1 acres**.

Three distinct exit catchments partition that total:

| Last model-domain HUC | Original downstream HUC | Domain HUCs draining through exit | Distinct area, acres | Priority HUCs | Selected classification source features |
| --- | --- | ---: | ---: | ---: | ---: |
| 030601060601 | 030601060607 | 215 | 4,607,833.53 | 15 | 1886 |
| 030601060201 | 030601060202 | 1 | 21,711.62 | 0 | 0 |
| 030601060204 | 030601060205 | 1 | 29,526.95 | 0 | 0 |

The 215-HUC Augusta Canal–Savannah River catchment contains all 15 regional priority HUCs and all 1,886 selected water-classification source features. The other two retained HUCs leave the selected domain through separate original downstream links.

## Saved Lower Tugaloo selection

The original saved selection is **030601020507, Lower Tugaloo River**. Its focal watershed covers 59,689.69 acres across Georgia and South Carolina. It is an NRCS priority watershed and has zero selected SCDES classification source features assigned directly to it.

Its original upstream network adds:

| Measure | Result |
| --- | ---: |
| Distinct upstream domain HUCs, excluding focal | 31 |
| Upstream acres, excluding focal | 573,633.44 |
| Upstream priority HUCs | 1 |
| Upstream priority acres | 14,806.13 |
| Upstream HUCs carrying selected classification source features | 7 |
| Upstream selected classification source features | 1,002 |
| ORW — Outstanding Resource Waters source features | 879 |
| TN — Trout Natural source features | 71 |
| TPGT — Trout Put, Grow, and Take source features | 52 |
| Longest upstream path to focal, links | 7 |
| Focal plus upstream HUCs | 32 |
| Focal plus upstream acres | 633,323.13 |
| Focal plus upstream priority HUCs | 2 |

The upstream priority HUC is **030601020503, Gum Log Creek**. Focal plus upstream membership and acreage exactly reproduce the retained PRWD Tugaloo/Choestoea source-topology result. The full native downstream path contains 18 HUC12 steps; eight remain in the selected model domain before its first exit, 030601060601 → 030601060607.

This selection lets the desk show both the focal watershed's local attributes and the classifications and priorities on connected upstream land.

## Four utility focus watersheds

The saved four-focus selection follows the original downstream links. Each contributing total includes its focal HUC and every distinct upstream HUC.

| Focal HUC12 | Original name | Focal acres | Upstream HUCs | Upstream acres | Contributing HUCs | Contributing acres |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 030601010703 | Upper Six And Twenty Creek | 19,129.10 | 0 | 0.00 | 1 | 19,129.10 |
| 030601010704 | Lower Six And Twenty Creek | 27,604.19 | 3 | 78,159.31 | 4 | 105,763.50 |
| 030601020502 | Choestoea Creek | 24,563.07 | 0 | 0.00 | 1 | 24,563.07 |
| 030601020507 | Lower Tugaloo River | 59,689.69 | 31 | 573,633.44 | 32 | 633,323.13 |

The four-focus **membership union contains 36 distinct HUCs, 739,086.63 acres, 3 NRCS priority HUCs and 1,002 selected classification source features**. Upper Six And Twenty Creek already belongs to the Lower Six And Twenty contributing catchment; Choestoea Creek already belongs to the Lower Tugaloo contributing catchment. Adding the four displayed contributing areas would produce 782,778.80 acres and count 43,692.17 acres twice. The saved union uses every original HUC once.

The Lower Six And Twenty contributing membership matches the retained ARJWS source catchment (4 HUCs, 105,763.50 acres); Lower Tugaloo matches PRWD (32 HUCs, 633,323.13 acres). These are contributing catchments. The original public-water service polygons remain a separate geographic layer with their own publisher identifiers.

## Large receiving watersheds

Each row's upstream values exclude its focal watershed.

| Focal HUC12 | Original name | Upstream HUCs | Upstream acres | Upstream priority HUCs | Upstream selected classification source features |
| --- | --- | ---: | ---: | ---: | ---: |
| 030601060601 | Augusta Canal-Savannah River | 214 | 4,559,230.78 | 15 | 1886 |
| 030601060105 | Llyod Creek-Savannah River | 213 | 4,527,322.2 | 15 | 1886 |
| 030601030713 | Hawe Creek-J. Strom Thurmond Reservoir-Savannah River | 185 | 3,861,330.57 | 15 | 1886 |
| 030601030712 | Murry Creek-J. Strom Thurmond Reservoir-Savannah River | 140 | 2,933,094.61 | 13 | 1886 |
| 030601030411 | Beer Garden Creek-Savannah River | 89 | 1,805,988.44 | 6 | 1886 |
| 030601030410 | Pickens Creek-Savannah River | 78 | 1,516,273.75 | 4 | 1885 |

## Priority watershed comparison

| Focal HUC12 | Original name | Upstream HUCs | Upstream acres | Upstream priority HUCs | Upstream selected classification source features |
| --- | --- | ---: | ---: | ---: | ---: |
| 030601010701 | Upper Three And Twenty Creek | 0 | 0 | 0 | 0 |
| 030601020503 | Gum Log Creek | 0 | 0 | 0 | 0 |
| 030601020507 | Lower Tugaloo River | 31 | 573,633.44 | 1 | 1002 |
| 030601030100 | Lightwood Log Creek-Savannah River | 68 | 1,291,259.38 | 3 | 1784 |
| 030601030206 | Wilson Creek | 0 | 0 | 0 | 0 |
| 030601030303 | Lower Beaverdam Creek | 2 | 46,089.33 | 0 | 0 |
| 030601030712 | Murry Creek-J. Strom Thurmond Reservoir-Savannah River | 140 | 2,933,094.61 | 13 | 1886 |
| 030601040106 | Middle North Fork Broad River | 1 | 19,946.69 | 0 | 0 |
| 030601040107 | Unawatti Creek | 0 | 0 | 0 | 0 |
| 030601040108 | Lower North Fork Broad River | 3 | 65,324.04 | 2 | 0 |
| 030601040205 | Upper Grove Creek | 0 | 0 | 0 | 0 |
| 030601040402 | Brush Creek | 0 | 0 | 0 | 0 |
| 030601040404 | Clouds Creek | 0 | 0 | 0 | 0 |
| 030601040406 | Lower South Fork Broad River | 5 | 120,959.85 | 2 | 0 |
| 030601050201 | Beaverdam Creek Lake | 0 | 0 | 0 | 0 |

## Files and operator use

- `watershed-connectivity-217.csv` contains all 217 focal watersheds, the original immediate ToHUC, full downstream paths, full upstream memberships, area and classification counts, and the first model-domain exit.
- `watershed-connectivity-summary.json` contains the regional totals, nonoverlapping exit catchments, saved Lower Tugaloo result, largest receivers, all 15 priority comparisons and exact source identities.
- This report explains the geographic and measurement meanings for the existing operator.

Join table rows to the original HUC polygons by the twelve-character `huc12` key. Import HUC12 columns as text to preserve leading zeroes. The pipe-separated `upstream_huc12s` and `downstream_huc12s` retain each complete selection/path. Use `focal_*` fields for the polygon's own characteristics; use `upstream_*` fields for its distinct ancestors; use `contributing_*` fields for the focal polygon and its distinct ancestors together. A headwater has zero upstream values and still retains its focal/contributing attributes.

Suitable operator views are upstream priority acreage, upstream classification count, distinct connected contributing area, native downstream path, and saved upstream membership. When aggregating several focal watersheds, take the union of their HUC12 memberships and sum each original HUC once. Nested receiving watersheds have overlapping ancestors.

The existing native source loader accepts the original network with `--native-network`; the model CLI uses `--network`. The current six-file operator successor is [Regional watersheds v1.2](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8KAKRVFX). It preserves the saved Lower Tugaloo workflow and adds original-network selection, upstream metrics, native paths, and upstream/downstream saved exports.

## Calculation and source meanings

This analysis was calculated in JavaScript over the exact original USGS attributes and the retained regional context. Reverse traversal counts each distinct upstream ancestor once and excludes the focal watershed. Forward traversal follows original ToHUC values until the original terminal. Upstream classifications are sums of the retained HUC-assigned selected classification source features. The original NRCS priority booleans and per-HUC acreage values supply priority and acreage summaries. Classification codes are retained as the publisher supplied them. In the [SCDES published classification register](https://des.sc.gov/sites/des/files/Library/Regulations/R.61-69.pdf), ORW means Outstanding Resource Waters, ONRW means Outstanding National Resource Waters, TN means Trout Natural, TPGT means Trout Put, Grow, and Take, and TPT means Trout Put and Take. Here TN is a water classification. Model reports label total nitrogen separately with its physical mass units.

Counts refer to retained publisher features assigned through the source HUC12 attribute. The hydrography layer includes separately represented banks, shorelines, dams and other feature types, so its feature count is a source-inventory measure. A zero for these selected classes means no matching feature from the requested classification subset was returned for that HUC; it does not describe every water-quality attribute of the watershed.

Connectivity describes the drainage relationship and contributing geographic context. Native sediment and nutrient programmes use their original model grids and quantities to calculate delivery. Utility-focus membership describes selected contributing watersheds; provider service-area polygons retain their own geographic meaning.

### Publisher sources

- [USGS National Map — original WBD HUC12 layer](https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6): publisher fields include HUC12, ToHUC, AreaAcres, AreaSqKm and States. [Exact captured Savannah attributes query](https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6/query?f=json&where=huc12%20LIKE%20'030601%25'&outFields=objectid%2Chuc12%2Cname%2Ctohuc%2Careasqkm%2Careaacres%2Cstates%2Chutype%2Chumod%2Cnoncontributingareasqkm&returnGeometry=false&orderByFields=huc12&resultRecordCount=2000) supplies the original downstream network.
- [NRCS FY26 source-water protection priority layer](https://services.arcgis.com/SXbDpmb7xQkk44JV/ArcGIS/rest/services/Source_Water_Protection_Resource_Concern_FY26/FeatureServer/7): source of the retained priority HUC assignments.
- [SCDES classified hydrography layer](https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2): source of the HUC12-assigned selected-classification features. [SCDES Classified Waters, Regulation 61-69](https://des.sc.gov/sites/des/files/Library/Regulations/R.61-69.pdf) supplies the classification names and published waterbody register.
- [SCDES public-water supply source](https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer): original intake and service-area geography used alongside the separate watershed contributing catchments.

The exact captured source bytes below define this calculation's edition; publisher services provide the original source descriptions and current access points.

### Exact original sources

1. [Original USGS topology, merged PR2733](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/b66b2a2f5ad5617ef4118ffd0240414b420040df/opportunities/upstate_forever_2026/source/receptor-topology/20261013/usgs-wbd-savannah-original-topology-20261013.json): 71,787 bytes; SHA256 `2e57f86d1725526f00f16870b1b03d9168b41ea94de6d0016b20dfe15e89bcac`. The captured publisher query is retained in the summary JSON and original source manifest.
2. [Original source manifest](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/b66b2a2f5ad5617ef4118ffd0240414b420040df/opportunities/upstate_forever_2026/source/receptor-topology/20261013/source-manifest.json), including the 303-record count, exact 217-HUC IDs, original links CSV, national external-incoming count and utility source-topology calculation.
3. [Received regional calculation and original inputs](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C9JNBA7EU), regional report `watershed-4592eb077b7164d59ba4`; original `watershed-context.json` SHA256 `54374a5b1feae5afda7217b27b7c796616d8654de8cc1fd8fc92831780e86e34`.
4. Original national external-incoming response `usgs-wbd-domain217-external-incoming-count-20261013.json`: 11 bytes, `{"count":0}`, SHA256 `618de7d9f46f3f697d827a1b6d84974760d5deda62e4e592adaa3c646602a94c`. Its exact query tests ToHUC membership in all 217 selected IDs and HUC12 outside 030601.
