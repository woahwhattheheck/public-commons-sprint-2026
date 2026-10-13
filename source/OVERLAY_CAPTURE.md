# Original Upper Savannah overlay capture

This source command acquires complete public vector editions for the delivered regional workbench. It consumes the existing original reporting polygon and four utility-focus HUC12s, then retains the provider's metadata, count responses, complete native object-ID sets, exact-ID feature pages, source geometry and acquisition receipts. It produces the existing model's `upstate.sources/v1` intake manifest.

## Run the original source operation

Use Python with the already available pyshp and pyproj geometry runtime. Keep this file beside the existing `capture_upstream_network.py`; its exact file publication helpers are reused.

```bash
python3 capture_original_overlays.py \
  --output /absolute/new-overlay-edition \
  --planning-source geography/planning_basins2023 \
  --reference-wbd-source geography/wbd_20261012
```

The default acquires all ten complete source selections. `--sources` can select complete named providers for a continuing native source operation, for example `oconee-parcels,anderson-parcels`. An output directory is bound to its original source set; use separate output directories for different sets or newly observed editions. Repeating the same command reuses every verified successful original response.

The bundled `overlay-metadata/oconee-parcels` is the actual metadata response captured on October 12 at 05:31:45 UTC. Its original gzip bytes and receipt values are preserved and reused, so that metadata is not requested again. A later source refresh receives a distinct output/source edition.

If an original provider error was retained, `--retry-failed` makes one new preserved attempt for that exact request. Earlier response bodies remain in their original folders; successful pages are reused, and a published Retry-After window is honored for every error response that supplies one, including 429 and 503. Count/ID changes or changed attributes during curved-geometry recovery require an explicit new source edition; the command retains the exact responses for that comparison.

## The selected original sources

| Source ID | Original interface | Native selection |
|---|---|---|
| oconee-parcels | https://arcserver2.oconeesc.com/arcgis/rest/services/PARCELDATA/MapServer/1 | Full county parcel features intersecting each original focus HUC12 |
| anderson-parcels | https://propertyviewer.andersoncountysc.org/arcgis/rest/services/NewPropertyViewer/MapServer/5 | Full county parcel features intersecting each original focus HUC12 |
| padus-manager | https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/PADUS_Manager_Type/FeatureServer/0 | Complete management inventory intersecting the whole reporting polygon |
| nhd-flowline | https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6 | Complete large-scale flowlines intersecting the whole reporting polygon |
| nhd-waterbody | https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12 | Complete large-scale waterbody features intersecting the whole reporting polygon |
| nwi-wetlands | https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0 | Complete wetlands inventory intersecting the whole reporting polygon |
| scdes-water-classification-provisional-20261012 | https://gis.des.sc.gov/gisserver/rest/services/water/Water_Classifications/MapServer/0 | Complete original provisional classification lines intersecting the reporting polygon |
| scdes-surface-water-intakes-20261012 | https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/0 | Complete original intake points within/intersecting the reporting polygon |
| scdes-sw-protection-areas-20261012 | https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/2 | Complete source-water protection polygons intersecting the reporting polygon |
| scdes-pwsw-protection-zones-20261012 | https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/3 | Complete public-well protection polygons intersecting the reporting polygon |

The reporting polygon is the full original PlanningBasins2023 record 5, `Basin = Upper Savannah`, EPSG:26917. The four focus IDs are 030601010703, 030601010704, 030601020507 and 030601020502. The original planning geometry, attributes and CRS and original focus source are pinned by hash before selection. Their original rings are supplied to each public provider with the source CRS and the intersects relationship.

County parcels are a declared focus-area selection. The parcel inventory's actual coverage belongs in the full regional workbench and report. The two counties and four HUCs do not stand for every parcel in the reporting basin.

## Original identity, geometry and fields

The command reads the actual native object-ID field from each layer, including joined fields such as `Wetlands.OBJECTID`. It makes an original count and IDs request per declared mask, checks their exact membership, then requests disjoint ID batches. It does not use offsets, source row order or inferred parcel numbers as unique identity. All original attributes are preserved.

Feature queries omit outSR, generalization, quantization and geometry precision parameters. The native CRS, coordinate values, Z/M flags and complete original Esri geometry remain in the raw bodies. The combined model file retains the consistent original page/layer hasZ and hasM flags, so XYM coordinates keep their measured-axis meaning. Equivalent WKID aliases are resolved for the derived intake while their original declarations remain in receipts.

If a provider returns curveRings or curvePaths, the command retains those original bytes and requests only the exact affected IDs with `returnTrueCurves=false`. The second response must preserve the same complete attributes, feature IDs, coordinate reference and Z/M axis flags. The model input uses that explicitly named provider-linear representation; original curved geometry and both query bodies remain in the same source packet.

The derived `features.esri.json.gz` groups source pages and normalizes JSON serialization for original GDAL model intake. It keeps source field values and geometry in their native CRS. Raw source responses separately preserve the original numeric text, original ordering, hashes and HTTP representations. The manifest identifies the exact curve representation relationships.

## Workbench intake and receiving

The output `model-sources.json` uses the existing `upstate.sources/v1` manifest contract. Source roles are PARCEL, PROTECTED_LANDS, NHD, NWI, WATER_CLASSIFICATION, SOURCE_WATER_INTAKES, SOURCE_WATER_PROTECTION_AREAS and SOURCE_WATER_PROTECTION_ZONES. Each vector entry contains the exact relative data path/hash, native ID field, source URI, scope, source CRS, feature count and complete raw-response companions. Feed that manifest through the original source importer alongside the existing DEM, NLCD, precipitation, R and K source rows.

The output `capture.json`, each `layer-capture.json`, each `selection.json`, `masks.json` and `request.json` identify the original native selection and data custody. Exact raw bodies and form requests live under each provider's `responses` directory. A provider may change its live dataset between requests; these records preserve the actual observation interval and identify any membership/attribute discrepancy.

NHD provides hydrographic context. NWI provides wetland inventory, and PAD-US carries overlapping management/designation records. The scientific delivery retains separate drinking-water and legally classified high-quality-water sources; these inventories do not create regulatory designations or parcel approval. Model load, conservation priority and protected-area totals are calculated by the original reviewed workbench with its actual scenario and overlay rules.

## Current SCDES classification and drinking-water sources

The current official Watershed Atlas application is `d0827cf30d3c490f9e22dd1000b8195a`; its observed map is `362fc83c2e474c13a52c1a8cd57c93d9`. Original HTTP200 app/map responses were captured October12,2026 at07:35–07:37UTC. The webmap's actual operational layers expose the current `gis.des.sc.gov/gisserver` URLs above. Its older widget configuration also retains predecessor `gis.dhec.sc.gov` URLs; the current operational-layer contract determines this capture.

Original metadata at07:38–07:39UTC declares EPSG26917 for the classified-water service and all three public-supply layers. The classification service lists layer0 as **Water Classification - Provisional** (polyline). Capture all native class attributes as that observed provisional source. The workbench's `high_quality_waters` delivery must save an explicit selected class/where filter and a separate authoritative classification-rule reference.

The source-water intake layer retains native OBJECTID, PWSNO, PWSNAME, FACILITYNA, INTAKE and the original status fields. The SWPA publisher description specifies a protection area15 miles upstream from the intake; its original INTAKE, SYSTEM and BUFFER_FT fields remain intact. Public-well protection zones retain SYSTEM, ZONE and BUFFERDIS; the publisher describes zones1,2,3 as one-, five- and ten-year groundwater travel times. These are the published utility-protection geometries. The hydrologic model separately retains its complete upstream flow domain.

The source importer carries each original layer's name, description, copyright and provisional status in its metadata. Points, polylines and polygons keep their actual geometry type. For already retained metadata, place the exact original `receipt.json` and `body.json.gz` under `--metadata-root/<source-id>/`. Both observed receipt shapes are supported: `url/status` and `requested_url/http_status`. Original receipt bytes and any distinct wire entity are copied and verified, preserving the initial observation while the current operation captures its feature edition.

## Reviewed class and reach interpretation

The original classification-layer metadata was captured at 08:02:55 UTC on October 12, 2026. Its unique native ID field is `OBJECTID_1`; the separate `OBJECTID` attribute remains source data. Class values are retained in the six-character `H2OCLASS` field, with the original `HYDNAME`, `HYDTYPE`, `HUC_12`, `Cnty_Name`, `Basin` and `MainStem` fields.

SCDES's current publisher copy of R.61-69 has 34 PDF pages and records the May 26, 2023 amendment. Section E defines the class abbreviations; section F explains previous classes in parentheses and site-specific notation. Section H binds classifications to named reaches. For example, the Chattooga designation changes at Opossum Creek, while the Chauga designation changes one mile above US Route 76. Preserve those reach distinctions when reviewing the source map. Unlisted tributary treatment is stated separately in section B.

R.61-68 provides class descriptions and standards, including the ONRW and ORW sections beginning at PDF page 29. The publisher identifies the State Register publication as the official legal version. Keep the selected rule edition alongside the original provisional GIS metadata and reviewed class selection.

In the model workspace, first retain all native class values, then save the selected `H2OCLASS` values, source revision and exact retained feature IDs used for the high-quality-water map. The source record, selected reach geometry and associated rule reference stay linked in the delivery. A name match alone does not define the selected river segment.

Publisher copies: https://des.sc.gov/sites/des/files/Library/Regulations/R.61-69.pdf and https://des.sc.gov/sites/des/files/Library/Regulations/R.61-68.pdf .

## Source references

Original query protocol: https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/ (GET/POST, complete object-ID selection followed by feature subsets, provider query limits).

Original NHD layer directory: https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/layers .

Original NWI directory: https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/layers . NWI status and imagery-source services remain additional source context at `Wetlands_Status/MapServer` and `Data_Source/MapServer`.

Original legal classification: https://www.scstatehouse.gov/coderegs/Chapter%2061-69.pdf and the current SCDES classified-waters source. Geographic classification/reach binding is retained as its own source work.

Current official Atlas: https://gis.des.sc.gov/gisportal/apps/webappviewer/index.html?id=d0827cf30d3c490f9e22dd1000b8195a . Original map data: https://gis.des.sc.gov/gisportal/sharing/rest/content/items/362fc83c2e474c13a52c1a8cd57c93d9/data?f=pjson .

## Exact provider feature selections

`capture_layer` accepts a source specification's optional `where` expression.
The maintained parcel planner forwards the provider's exact value. Omission
means `1=1`; explicit null, empty, non-string or NUL-containing values are
rejected before capture. No county name or SQL expression is inferred from
a layer title.

For a filtered source, every count, original-ID, native-geometry and
provider-linear query carries the same original expression.
`selection.json` and `layer-capture.json` retain it as `where`.
The request receipt already retains each exact query parameter, so a partial
response from another selection cannot be reused under the same request
identity. Default `1=1` captures preserve the existing request and retained
selection layout, allowing earlier complete single-county sources to remain
valid.

This enables SCFC's Coastal source to supply Aiken parcels with
`County = 'Aiken County'` while retaining all original attributes and whole
native polygons. The parcel engine additionally verifies the original
`County` value before assigning Aiken's county-qualified identifier and
compares the predicate before capture restoration or same-mask reuse.
Its prepared source manifest keeps `source_where` separate from the
publisher's metadata `definitionExpression`.
