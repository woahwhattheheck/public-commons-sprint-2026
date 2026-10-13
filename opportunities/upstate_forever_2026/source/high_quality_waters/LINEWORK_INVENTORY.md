# Classified source linework inventory

**Needs expert review:** legal reach associations and scientific interpretation of bank, shoreline and stream measurements.

This companion profiles the complete 1,886-row SC DES SCHydroClass/2 capture and supplies a native-ID index for the operator's source review. The actual profile and feature-index files are included, together with the reusable JavaScript core that produced them.

## Source identity

- Source ID: scdes-classified-streams-upper-savannah-20261012
- Capture layer ID: scdes-classified-75805b84d89a256d
- Actual service: https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2
- CSV input: source/water_context/20261012/classified-reaches.csv, 168811 bytes, SHA256 ce95ef233822d1205f5fda534e95e361a933147301f787906b509f8b4525cf18
- Legal registry: source/high_quality_waters/r61-69-current.selected-reaches.json, 60479 bytes, SHA256 a55388d8edfceb587d7d37b5e9a20f43a1f44d37f6ecd70001806528bbc767f1

The true native key is OBJECTID (esriFieldTypeOID), whose alias is OBJECTID_1. The separately named OBJECTID_1 integer is nullable. The source layer remains provisional; the current legal edition and individual named legal reaches retain separate meanings.

## Actual derived outputs

source/high_quality_waters/scdes-schydroclass-20261012.attribute-profile.json uses schema upstate.classified-water-inventory/v1. It includes exact input identities, source-selection scope, all class/HYDTYPE counts, publisher-HUC/class counts, identifier coverage, literal-registry join counts and all native IDs in 12 specific class/county review groups.

source/high_quality_waters/scdes-schydroclass-20261012.feature-index.csv has all 1886 native IDs. Its columns are object_id, hydro_type_raw, class_raw, publisher_huc12, name_blank, county_blank, literal_join_status and literal_registry_record_ids. The object_id is a string identity; preserve publisher_huc12 as text to retain its leading zero. Blank flags are true or false. Legal row IDs are separated with | and resolve against the retained legal registry.

The feature index deliberately joins back to the original feature attributes for names and counties. It preserves exact original HYDTYPE values, including the one single-space value.

## Observed source composition

The classes are ORW 1040, TN 247 and TPGT 599. The publisher HUC field has 19 distinct codes. There are 135 distinct nonblank literal source names, 872 blank names and 174 blank counties.

| Original HYDTYPE | Native feature count |
| --- | ---: |
| STREAM | 791 |
| STREAM/INTERMITTENT | 414 |
| STREAM/LEFT BANK | 258 |
| STREAM/RIGHT BANK | 111 |
| SHORELINE | 183 |
| SHORELINE/SUBMERGED | 38 |
| APPARENT LIMIT | 28 |
| DAM/WEIR | 20 |
| RAPIDS | 19 |
| CLOSURE LINE | 15 |
| MANMADE SHORELINE | 7 |
| FALLS | 1 |
| Single-space blank | 1 |

These are source object counts. A total of all native line lengths combines stream lines, banks, shorelines and other mapped features. Use the label classified source linework for that metric. Separate bank lines do not become a river centerline after a geometric union, and a lake shoreline does not supply lake surface area. The spatial crosswalk calculates projected measurements; this attribute profile does not use source Shape_Length as a ground-length statistic.

## Literal source-review predicates

All matches use Unicode NFKC, case and whitespace normalization. Punctuation, word ordering and aliases are preserved. This inventory never creates coextensive or partial legal geometry bindings.

| Literal join status | Native features |
| --- | ---: |
| literal_name_class_county | 528 |
| literal_name_class_blank_county | 148 |
| literal_name_class_different_county | 22 |
| literal_name_different_class | 26 |
| no_literal_registry_name | 290 |
| blank_native_name | 872 |

literal_registry_record_ids contains every selected legal row with the same normalized literal name, before class/county filtering. The status identifies the strongest stated comparison for the feature. A positive name/class/county predicate remains a source-review candidate; the full legal reach description still determines extent.

For example, the current native layer has 18 LAKE JOCASSEE / TPGT / Pickens objects while the retained legal row lists Ocne. Several named river/lake source objects have class values different from the same literal name in the selected legal table. Their exact IDs are preserved in the profile's review groups. These groups are comparison context, rather than a declaration that either dataset is wrong: geometry, the source feature type and the legal reach description determine the proper association.

The selected legal registry has 105 rows. The 290 named features without a literal match are absent from this selected table; that count does not establish that they are legally unlisted. Blank names and counties do not remove their positive native classification from the map. Existing downstream designation logic owns receiving-water relationships and explicit legal extent.

## Inventory directly from the completed native capture

The receiving chain can use the native collection already assembled by `high_quality_waters.py adopt`. Run from the project root:

    node source_tools/high_quality_water_inventory_cli.mjs \
      --capture /mnt/data/eco12-native-water/capture \
      --registry source/high_quality_waters/r61-69-current.selected-reaches.json \
      --mapping source/high_quality_waters/scdes-current.native-field-binding.json \
      --out /mnt/data/eco12-water-inventory

This mode reads the selected layer from `capture.json`, checks every retained member's byte count and SHA256, verifies the decoded collection, and resolves the true OID through the original field metadata. It reads the exact selection file retained by adoption. Omit `--selection` to use that file; an explicitly supplied selection must have identical bytes.

The filesystem-independent `high_quality_water_inventory_capture.mjs` module validates the native attribute projection used by the existing inventory core. The projection preserves the native integer OBJECTID and the original inventory text values. Null text fields use the established blank-field semantics; their original null counts are recorded in `input_representation.null_source_values`, and the complete typed source attributes remain in the retained collection.

The output retains the original capture document and every inventoried capture member beneath `inputs/native_capture/`, together with the current mapping and legal registry. The profile records `native_capture`, `native_features`, `native_metadata`, `retained_selection` and `legal_registry` input identities. The feature-index schema, source ID, source-review role and manifest contract remain the same. Source files are installed atomically so an interrupted copy does not leave a partial final member.

The native attribute projection was compared across all 1,886 original retained attribute rows. Every inventory count and legal-name diagnostic matched, and the resulting complete feature-index SHA256 remains `bd32114f094f7951f1706ed4f47190cd248cce4de971e2de8c8c23c2a14d2624`. The receiving GIS runtime completes the original capture-file read and Workspace import.

## Reproduce and import

The core source_tools/high_quality_water_inventory.mjs has no runtime dependencies. Its API is buildInventory(csvText, registry, mapping, selection, inputs), returning profile, featureIndex and featureIndexCsv. It verifies all native IDs, selected classes, publisher HUC prefixes and the exact 1886-feature/class/HUC totals. It was executed on the complete original CSV, and the emitted feature index was parsed back to 1886 rows.

The standard Node CLI retains all four original input files beside the output and creates an upstate.sources/v1 manifest:

    node source_tools/high_quality_water_inventory_cli.mjs \
      --source-csv source/water_context/20261012/classified-reaches.csv \
      --registry source/high_quality_waters/r61-69-current.selected-reaches.json \
      --mapping source/high_quality_waters/scdes-current.native-field-binding.json \
      --selection source/high_quality_waters/scdes-schydroclass-20261012.retained-selection.json \
      --expected-csv-sha256 ce95ef233822d1205f5fda534e95e361a933147301f787906b509f8b4525cf18 \
      --out /mnt/data/eco12-water-inventory

From the existing project Python environment, import that sources.json with Workspace.import_sources. The source role is HIGH_QUALITY_WATER_SOURCE_INVENTORY, and the source ID ends with -attribute-inventory. The original feature geometry and designation map source retain their existing roles.

The packaged actual profile names the original project CSV and registry paths. Running the CLI replaces those provenance locators with its retained input companions and adds mapping/selection hashes; the source counts and feature-index bytes remain identical.
