# SC DES classified waters: retained source adoption and spatial integration

**Needs expert review:** regulatory reach associations and scientific use of classified linework. The tools preserve the original legal text and mapped-source status for review.

This package connects the captured SC DES classified-water geometry to the existing Upper Savannah reporting boundary, native HUC12 network and source importer. It includes the original R.61-69 legal reach registry, a standard-library source capture/adoption tool, and an exact binding for the source edition acquired on 12 October 2026.

The spatial companion is `source_tools/high_quality_water_crosswalk.py` in this project. Crosswalk v1.1.0 and later propagate publisher data status separately from the current/proposed legal edition, declare the native OID explicitly, and preserve compact references to full metadata in `provenance.json`. The spatial runtime uses Fiona, pyproj and Shapely. Run the commands below from `opportunities/upstate_forever_2026`.

## Active native source edition

Source ID: scdes-classified-streams-upper-savannah-20261012

Exact active layer:
https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2

The original application settings at https://gis.des.sc.gov/stormwater/js/a_settings.js identify the layer. The binding retains the original field schema, CRS, selection query, source filenames and byte identities. The original source-dictionary.json file is 16119 bytes, SHA256 d6f6f883dd90f091747d82ed4cc6bdbdcadb214d50c86769cda781b899c2296b.

The active source's true ID field is OBJECTID, declared esriFieldTypeOID. Its display alias is OBJECTID_1. The separately named OBJECTID_1 column is an integer attribute and is null in the original sample. The importer resolves the true field by its published Esri type; it never uses aliases as identifiers.

The retained selection contains 1886 distinct native feature IDs: ORW 1040, TN 247 and TPGT 599, across 19 publisher HUC12 codes. The exact query selects class codes ORW, ONRW, TN, TPGT and TPT within publisher HUC prefixes 03060101, 03060102 and 03060103. The original acquisition predicate remains unchanged. A separate official query for all 217 exact project HUC12 codes returned the same 1886 OBJECTID/H2OCLASS/HUC_12 triples; the remaining 92 exact HUCs returned zero selected-class features. That result establishes completeness for these five native class codes in this model domain. The native source remains provisional as labeled by its publisher; the adopted legal edition and individual named reach descriptions are retained separately.

Source metadata publishes EPSG:3857 (wkid 102100, latestWkid 3857) and esriGeometryPolyline. It does not publish editingInfo. The observed capture date is 2026-10-12, and the dataset's unstated update date remains unstated.

The older Water_Classifications/MapServer/0 catalogue entry and scdes-water-classification-provisional-20261012 capture reference identify a separate service layer. They remain contextual source history. The active scdes-current.native-field-binding.json now targets SCHydroClass/2 only.

## Adopt the existing captured originals

The retained geometry already exists. Use adopt to assemble it into the project's normal capture contract without querying the state service again.

Use the retained original responses with these exact filenames:
- scdes-classified-waters-layer-metadata.json
- scdes-classified-streams-upper-savannah-original-esri.json
- scdes-classified-reaches-attributes-0.json
- scdes-classified-reaches-attributes-500.json
- scdes-classified-reaches-attributes-1000.json
- scdes-classified-reaches-attributes-1500.json
- scdes-upper-savannah-class-counts.json

The original metadata SHA256 is 6b2e4b063d9e4af73c724853c7097fd0bf960be0d97f89493d9cca866d9e54c4. The original geometry response is 4978867 bytes, SHA256 daae1887ba6ac25affd85fc6e1094a81ec24130e1846bbb538cf21375bdbb394. The included retained-selection.json stores the original source filenames, exact query, metadata hash, expected feature/class/HUC counts and selection scope. Its `query_uri` is the official geometry request; a later download must be checked against this captured edition before using `adopt`.

Run from the project root. Set SC_WATER_NATIVE to the folder containing those existing originals and SC_WATER_CAPTURE to the output folder for this selected edition:

    SC_WATER_NATIVE=/mnt/data/eco12-native-water-originals
    SC_WATER_CAPTURE=/mnt/data/eco12-classified-water-capture
    python source_tools/high_quality_waters.py adopt \
      --selection source/high_quality_waters/scdes-schydroclass-20261012.retained-selection.json \
      --metadata "$SC_WATER_NATIVE/scdes-classified-waters-layer-metadata.json" \
      --features "$SC_WATER_NATIVE/scdes-classified-streams-upper-savannah-original-esri.json" \
      --attributes "$SC_WATER_NATIVE/scdes-classified-reaches-attributes-0.json" \
      --attributes "$SC_WATER_NATIVE/scdes-classified-reaches-attributes-500.json" \
      --attributes "$SC_WATER_NATIVE/scdes-classified-reaches-attributes-1000.json" \
      --attributes "$SC_WATER_NATIVE/scdes-classified-reaches-attributes-1500.json" \
      --companion "$SC_WATER_NATIVE/scdes-upper-savannah-class-counts.json" \
      --output "$SC_WATER_CAPTURE"

Use --attributes with either the four complete attribute pages above or the single scdes-classified-streams-upper-savannah-attributes.json response. Supplying both repeats native IDs and is rejected. Attribute queries may project fewer columns than the full geometry response; every supplied original column is compared by true native ID. The full geometry response's feature objects remain unchanged.

Additional original settings, counts, dictionaries or request records can be retained using repeated --companion. They travel with the imported capture manifest.

The adoption checks the original metadata hash, geometry byte count, published native field names/types and CRS, complete native ID set, class totals, publisher HUC count, capture class/HUC selection, and every supplied original attribute. A geometry response with exceededTransferLimit=true is rejected as incomplete. Earlier attribute pages can carry continuation flags; the union of all supplied attribute IDs must equal the geometry ID inventory.

The output is:
- capture.json using upstate.classified-water-capture/v1.
- scdes-classified-75805b84d89a256d/retained/... with unchanged original source bytes.
- derived-object-ids.json and derived-count.json, explicitly labeled as derived from the retained original geometry and checked against the observed source totals.
- features.esri.json.gz, a deterministic assembled native collection with the original feature objects.
- sources.json using the established upstate.sources/v1 importer contract.

All retained inputs, including attribute pages and the selection specification, are inventoried with original byte counts and SHA256. The source ID, original capture date, provisional status, exact selection query and metadata identity remain attached to the capture and manifest. Repeating adopt with the same input edition reuses the exact completed files. Use a new output directory for changed source bytes.

Inspect the resulting native class and county values:

    python source_tools/high_quality_waters.py inspect \
      --capture "$SC_WATER_CAPTURE"

## Crosswalk against the existing native geography

The active mapping is source/high_quality_waters/scdes-current.native-field-binding.json. Its only layer ID is scdes-classified-75805b84d89a256d, calculated from the exact SCHydroClass/2 URL. It binds H2OCLASS, HYDNAME and Cnty_Name, retains all original metadata and includes all 46 county-name to R.61-69 county-code mappings. Anderson maps to Andn, Oconee to Ocne and Pickens to Pkns.

Run the companion with the existing project source and legal registry:

    python source_tools/high_quality_water_crosswalk.py \
      --capture "$SC_WATER_CAPTURE" \
      --mapping source/high_quality_waters/scdes-current.native-field-binding.json \
      --project-source source \
      --output /mnt/data/eco12-classified-water-crosswalk \
      --registry source/high_quality_waters/r61-69-current.selected-reaches.json \
      --workspace /mnt/data/eco12-workspace

For the full retained 217-HUC network, add --huc with its native network-selection.json path; repeated --huc arguments are supported. The companion always reads the existing PlanningBasins2023 Upper Savannah reporting polygon and four original utility-focus HUC12s. It retains publisher HUC_12 separately from the HUC assignment obtained by native geometry intersection.

The crosswalk writes original native-feature geometry, separate reporting-domain clipping, all HUC intersections, touch-only records, GeoJSON, GeoPackage and union-length/area summaries. It preserves data_status=provisional separately from legal_edition_status=current. Complete legal descriptions remain available alongside candidate or explicit native feature associations.

For explicit legal geometry associations, supply --bindings with rows containing layer_id, object_id, registry_record_id and geometry_relation, which is coextensive, partial or candidate. Only an explicit coextensive binding marks a legal reach fully mapped. Automatic exact normalized name/class/county associations stay candidates.

## Native source identity in the application

Imported native vectors declare role `WATER_CLASSIFICATION`, matching the application's classification source picker. The original capture role remains in `capture_role`. Both `id_field` and `native_oid_field` use the field that the original metadata declares as `esriFieldTypeOID`; the full original field schema remains with the source entry. The selected source's declared class field is carried separately.

For the active SCHydroClass/2 edition, that field is `OBJECTID`. Its display alias is `OBJECTID_1`; the separate literal `OBJECTID_1` attribute is nullable and is retained unchanged. Imported source choices therefore carry `id_field: "OBJECTID"` and native integer values such as 218303. The distinct Water_Classifications/0 edition retains its own metadata-declared identity.

GDAL's ESRIJSON reader retains the declared OID as an attribute as well as a feature ID, and Fiona reads that attribute under the original field name. This allows the application to select the native property directly. Source code inspected: OSGeo/gdal `ogr/ogrsf_frmts/geojson/ogresrijsonreader.cpp` blob `3da1745f9d0b8767d0cdef86adac5677cab1fcd4`; Toblerity/Fiona `fiona/ogrext.pyx` blob `8ae7f799ee30add3861794f15b7b1f55af4d06c0`.

https://github.com/OSGeo/gdal/blob/master/ogr/ogrsf_frmts/geojson/ogresrijsonreader.cpp

https://github.com/Toblerity/Fiona/blob/main/fiona/ogrext.pyx

When an earlier import has already been adopted, rerun the same `adopt` command with the existing output directory and the identical retained selection file. It validates the retained inventory and refreshes `sources.json` with the current identity declarations. The previous generated manifest is preserved under `source-manifests/<sha256>.json`, and the native source bodies remain unchanged. Import the refreshed manifest into the existing Workspace.

Selection bytes are part of the adoption input identity. An existing adoption made from a source-carrier edition must keep its original selection file, whose retained path is recorded in `capture.json`. The public selection uses original source filenames in place of carrier locators and therefore has a different byte identity. To adopt the public selection, use a new output directory with the same original metadata, geometry and attribute responses. Both routes reuse the acquired source data.

## Regulatory source data

The registry contains 105 records transcribed from contiguous original rows of South Carolina R.61-69, including 66 outstanding-resource or trout records in Oconee, Pickens and Anderson and 39 freshwater reach/context rows. Full text preserves all 1786 indexed source lines from the 34-page SCDES PDF. Every registry row retains its edition/line ID, exact waterbody name, county codes, class, prior class, reach description, PDF page, printed page and source lines. The CSV and JSON represent the same 105 rows.

The 2023 regulation is the current edition checked on 12 October 2026. State publication was 26 May 2023; EPA lists 12 December 2023 as the Clean Water Act effective date. The September 2026 document 5474 is a proposed edition with comments through 26 October. Its local Bear Creek correction changes the Anderson receiving-water description from Rocky Creek to Rocky River; its FW class remains the same.

Regulatory sources:
- https://des.sc.gov/sites/des/files/Library/Regulations/R.61-69.pdf
- https://www.epa.gov/wqs-tech/water-quality-standards-regulations-south-carolina
- https://des.sc.gov/programs/bureau-water/water-quality-standards
- https://des.sc.gov/sites/des/files/Library/Regulations/5474_R.61-68%20%26%2069%20NPR_Full%20Text.pdf

The 105-row JSON registry, equivalent CSV, complete source-indexed regulation text and `sources.json` are included together in this directory. Keep these files together when importing the manifest. The capture and crosswalk manifests use the same Workspace importer:

    from model.workspace import Workspace
    Workspace("/mnt/data/eco12-workspace").import_sources(
        "source/high_quality_waters/sources.json"
    )

## Complete 217-watershed source inventory

The separate `sources-classified-domain217-20261013.json` manifest imports the complete-domain comparison report and both unchanged official service responses. The report retains all 217 exact HUC12 identifiers, the original three-prefix acquisition predicate, the two later request URLs, and every comparison result.

| Comparison | Result |
| --- | ---: |
| Native IDs in the exact 217-HUC query | 1886 |
| Retained/native ID, class and publisher-HUC triples that match | 1886 |
| Added, missing or changed triples | 0 |
| Selected-class features in the remaining 92 HUCs | 0 |
| HUC12 codes with positive publisher-assigned features | 19 |

Import it beside the regulatory and native capture manifests:

    from model.workspace import Workspace
    workspace = Workspace("/mnt/data/eco12-workspace")
    workspace.import_sources("source/high_quality_waters/sources-classified-domain217-20261013.json")

Publisher HUC attributes measure the service's assignment. The crosswalk uses the retained native HUC polygons for geometric intersections, including lines crossing a HUC boundary. The completeness result does not replace those spatial computations. NRCS priority designations remain a separate source and do not filter classified-water features.

## Meaning of classified feature and legal reach coverage

The native geometry includes stream segments, banks and shorelines. Native feature count measures original source objects; it does not measure distinct water bodies. Unioning those lines avoids exact geometric overlaps but does not turn separate banks and shoreline segments into a river centerline. Map and summary labels should identify classified source linework unless a separate hydrologic centerline dataset supports the requested metric. A lake shoreline line cannot supply a lake surface-area statistic.

Shape_Length is the publisher's Web Mercator geometry length. Calculate analytical planimetric lengths in EPSG:26917, the retained reporting boundary's NAD83 / UTM zone 17N coordinates. Preserve original geometry, CRS, dimensions and attributes beside projected/clipped outputs.

Keep ONRW/ORW, TN, TPGT and TPT as separate classes. Parentheses after ORW/ONRW identify a previous class; sp denotes site-specific criteria. NDZ is a separate marine-sanitation designation. Hartwell's legal FW class and NDZ remain available in the legal registry even though FW lies outside this high-quality-linework capture's query.

Name matches do not establish a legal reach's geographic extent. Chattooga, Chauga, Eastatoe, East Fork Chattooga, Howard, Lick Log, McKinneys, North Fork Little, Smeltzer and Tamassee have different classes on different described portions. Savannah River is TPGT from Hartwell Dam to the headwaters of Richard B. Russell and FW downstream through the later described extent.

Blank native HYDNAME or Cnty_Name values remain blank. Existing positive class attributes still identify their mapped native geometry. An unresolved legal name association does not remove that source geometry from the high-quality map. Legal descriptions and their explicit association status remain available for source review.

County membership alone cannot assign the reporting basin: some Pickens priority waters drain toward the Saluda. Geometry intersection assigns the native source to the retained reporting basin and HUC12s. HUC intersection and upstream contributing-land analysis have separate meanings; the latter uses the existing hydrologic network and InVEST quantities.

Unlisted tributary classes follow R.61-69 B and require the actual receiving-water relationship. Site-specific numeric criteria do not transfer automatically. The existing downstream applicability workstream owns this linkage, using the retained full legal descriptions and native feature identities.

## Reusable acquisition commands

The tool also retains complete official Atlas configuration and supports a fresh complete-layer capture when a different source edition is needed:

    python source_tools/high_quality_waters.py discover --output /work/sc-water-discovery

    python source_tools/high_quality_waters.py capture \
      --layer-url https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2 \
      --output /work/sc-water-new-complete-edition \
      --request-pause 0.4 --page-size 100

Fresh capture obtains the complete publisher count and ID inventory, every original feature page, the ending ID set/edit date, and both current and proposed regulatory PDFs. Unlike the existing adopted selection, that command queries the full layer. Its native geometry/field capture remains general; apply the selection and legal context appropriate to the actual received edition.
