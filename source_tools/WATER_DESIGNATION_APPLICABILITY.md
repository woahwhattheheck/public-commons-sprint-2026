# Water-designation applicability and delivery selections

**Needs expert review:** source interpretation and native reach applicability.

This module connects the existing classified-water crosswalk with actual upstream
network relationships and an exact native-feature selection for delivery maps.

## Files and existing sources

- source_tools/designation_rules.py: standard-library Python implementation.
- source_tools/designation_crosswalk.py: retained-crosswalk adapter, selection exporter
  and optional native workspace import.
- source/water-designations/sc-effective-rules.json: effective source edition and
  source-backed interpretation profile.
- source/high_quality_waters/r61-69-current.selected-reaches.json: reuse ASTRA-S1's
  retained 105-record registry (SHA-256
  a55388d8edfceb587d7d37b5e9a20f43a1f44d37f6ecd70001806528bbc767f1).
- source_tools/high_quality_water_crosswalk.py: reuse its parser, exact feature
  matches, geometry handling, HUC joins, and native importer.
- feature-bindings.json: reuse the prepared domain's
  upstate.wbd-domain-bindings/v1 file.

The source registry has 105 selected records, with 66 source-marked priority
candidates: ORW 31, TN 23 and TPGT 12. Its raw values include ORW(FW) and
ORW(TPGT). Coverage is a regional selection; missing rows do not establish that
a stream is legally unlisted.

## Scientific interpretation

A listed reach retains its own classification. For explicitly unlisted SC reaches,
R.61-69.B supplies receiving-stream class standards without named site-specific
numeric exceptions. ORW and ONRW retain previous-class criteria. TPT uses FW
standards. Receiving-resource connections are separate attributes: upstream land
can matter to a protected receiving water while its own named class remains FW.

The classified-reach profile retains R.61-69's May 26, 2023 state edition and
recorded December 12, 2023 EPA approval. Its associated R.61-68 standards have a
separate current state edition: May 23, 2025, State Register Document 5333. The
profile records that edition in associated_standards_edition and in the
sc_r61_68 source entry. The classification edition ID remains sc-r61-69-2023.
The state standards PDF's history is on page 2; the state code PDF's history is
on page 28. Older retained EPA copies keep their own original publication edition.

The 2026 proposed edition can be included as a separate resource context;
effective reach inheritance continues to use the retained R.61-69 edition.

The graph's resolution controls the output. HUC12 graphs produce watershed-scale
receiving-resource context. Only water_reach graphs resolve reach classifications.
An unlisted status is supplied explicitly by source work. Graph edges never
reclassify a whole watershed.

Primary references:

- https://www.scstatehouse.gov/coderegs/Chapter%2061-69.pdf
- https://des.sc.gov/sites/des/files/Library/Regulations/R.61-68.pdf
- https://des.sc.gov/programs/bureau-water/water-quality-standards
- https://www.scstatehouse.gov/coderegs/Chapter%2061-68.pdf
- https://des.sc.gov/permits-regulations/regulations-regulatory-updates/regulations-currently-under-amendment-recently-finalized

## Connect ASTRA-S1's current crosswalk

The existing parser returns:

    parse_class(raw_value, field_metadata, layer_mapping)
      -> {class_raw,class_label,class_code,previous_class,site_specific,
          rfp_high_quality_candidate,class_resolution}

Pass that object to:

    make_designated_resource(
        resource_id,
        parsed_class,
        node_ids=source_joined_huc12_or_reach_ids,
        source_feature_refs=source_native_refs,
        status=source_status,
        rule_edition_id=source_edition_id,
        label=waterbody_name,
    )

The result preserves the original parse information. Its resource identity can be
the exact retained registry ID, for example sc-r61-69-2023-L0532. A source-native
reference uses:

    {
        "source_id": source_manifest_id,
        "layer_id": source_layer_id,
        "field": original_object_id_field,
        "value": original_object_id
    }

Use the captured source layer's exact namespace and native ID value. The helper
never substitutes a regulatory row ID for a GIS feature ID.

Where a crosswalk has already matched registry records to native features and HUCs,
build a mapping keyed by the retained regulatory record IDs. Each entry supplies
node_ids and source_feature_refs. This call converts the actual registry fields:

    resource_document = resource_set_from_registry(registry, associations)

The resource document retains all 105 records. Its explicit default selection
contains the 66 rfp_high_quality_candidate IDs from the source. It preserves each
record's reach description, county codes, NDZ status, source-page/line locator and
source edition. Unmatched geometry/HUC associations remain visible in the output.


## Direct source crosswalk and delivery import

The adapter consumes retained S1 crosswalk output, including v1.1.0, without
rerunning GIS intersections. It reads crosswalk.json, provenance.json, source_reaches.geojson
and, when present, legal_associations.json from the same completed edition.

    python source_tools/designation_crosswalk.py \
        --crosswalk-root path/to/completed-crosswalk \
        --bindings path/to/feature-bindings.json \
        --rules source/water-designations/sc-effective-rules.json \
        --output path/to/designation-selection \
        --workspace path/to/existing-workspace \
        --delivery-selection path/to/current-complete-selection.json \
        --build-delivery

Its source grouping key is feature_id. HUC membership requires region_kind huc12,
counted true and a positive intersection_length_m or intersection_area_ha.
Touch-only rows remain outside the membership calculation. A source publisher
HUC attribute is preserved separately from the retained model's HUC edition.

Each native mapped feature becomes a mapped_classified_water resource. Named
registry records become separate designated_water resources. Resource counts
therefore remain grouped by kind; neither resource count is a unique-waterbody
count. Native map candidates work across the complete retained GIS capture, while
the selected 105-record registry supplies named legal extents and editions.

The adapter applies only explicit coextensive associations to full named legal
extents. Partial and candidate associations retain their original source links
and descriptions. Source status current/proposed and publisher data status,
including provisional, remain independent. A proposed scenario is chosen through
an explicit --selection JSON file.

The active retained layer is SCHydroClass/MapServer/2 in EPSG:3857. Its actual
native OID field is OBJECTID. OBJECTID_1 is a separate nullable integer field;
aliases do not determine identity. The retained capture contains 1,886 source
features: 1,040 ORW, 247 TN and 599 TPGT. Those counts describe the published
capture filter. Exact domain membership comes from the existing GIS crosswalk.

The exporter preserves the S1 source_reaches.geojson feature objects and RFC7946
coordinates. It writes selected-high-quality-waters.geojson, applicability,
resource records, source provenance and sources.json with HIGH_QUALITY_WATERS.
The optional workspace argument calls the existing Workspace.import_sources
method. The printed result includes the source collection, source entry ID,
selected feature count, mapped resource counts by kind and graph node count.
It also returns delivery_selection_patch with the actual source choice in both
overlays.high_quality_waters and source_roles.HIGH_QUALITY_WATERS. The import-only
route uses the imported source. With --save-desk-selection, both the patch and
overlay_choice use the saved desk source and preserve its selection_id,
rule_reference and native_source_sha256. Merge those two choices into the current
selection while preserving its other configured roles and overlays.


With --delivery-selection, the CLI reads the complete existing selection, replaces
only the two high-quality-water choices and writes delivery-selection.json.
Contact, baseline/scenario runs, drinking-water choices, other source roles and
scenario priorities retain their current values. With --build-delivery it calls
Workspace.build_delivery on that completed selection and returns the actual
delivery ID, state, map IDs and package. The engine retains its existing completed
grid/run requirements, native output generation and completed-artifact reuse.
The source import can also run independently while model runs are progressing.

The complete product already exposes the same builder directly:

    python -B -m model.cli --workspace WORKSPACE delivery-build COMPLETE_SELECTION.json

Source identities and complete source field definitions are retained in
source/water_context/20261012/source-dictionary.json. The earlier provisional
Water_Classifications source remains a separate retained source role. Primary
active source and discovery references:

- https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2
- https://gis.des.sc.gov/stormwater/js/a_settings.js

## Use the crosswalk's actual completed directory

The native crosswalk builder creates an immutable edition beneath its --output
parent. Its JSON result contains output_dir, source_manifest and run_id. Supply
that exact output_dir as --crosswalk-root, or retain the builder's result JSON
and pass --crosswalk-result. The adapter checks that the returned run ID and
source-manifest path belong to the completed edition.

For the existing source pipeline, write the second stage's stdout to
crosswalk-result.json, then use:

    python source_tools/designation_crosswalk.py \
        --crosswalk-result CROSSWALK_RESULT.json \
        --bindings ORIGINAL_217_DOMAIN/feature-bindings.json \
        --rules source/water-designations/sc-effective-rules.json \
        --output DESIGNATION_SELECTION \
        --workspace EXISTING_WORKSPACE \
        --save-desk-selection \
        --delivery-selection CURRENT_COMPLETE_SELECTION.json \
        --build-delivery

The crosswalk parent itself contains edition directories. The returned directory
selects one completed native run and makes that same source identity available to
the next consumer.

Crosswalk v1.1.0 retains full publisher metadata once per layer and attaches
source_metadata_ref to native features. The adapter preserves those references
in both selected features and mapped-resource source labels. Its companion is
named provenance.json, matching the original reference document. The full layer
mapping, source status and source catalogue identity remain in that companion.

## Continue in the existing water-designation desk

A workspace import also writes water-designation-choice.json. This binds the
actual imported collection ID and entry body hash to the existing
model.water_designations desk. It names feature_id and class_code explicitly.
feature_id retains the S1 capture-layer/object-ID namespace; the feature's
native_attributes retain the original typed published fields. These identity
fields apply to the selected S1 GeoJSON. The active SCHydroClass source instead
uses its actual native OBJECTID, as recorded in the source dictionary.

Open the retained source in the installed desk with this exact choice:

    python -B -m model.water_designations WORKSPACE inspect \
        DESIGNATION_SELECTION/water-designation-choice.json

The desk choice selects the complete already-selected feature set and carries
the primary rule reference, source hash, and interpretation notes. Its
source_context object retains the complete rule_profile, source_catalog,
source_labels and interpretation. The native desk saves and reopens this context
with the selection. Its default inspection page does not limit subsequent native
feature selection.

Add --save-desk-selection to the existing crosswalk command to save through
model.water_designations.save. This requires the existing water-designations
module and its native dependencies in the assembled application. The returned
water_designation object contains the actual saved selection ID, source summary
and delivery overlay. With --delivery-selection, the saved route calls the native
model.water_designations.apply_to_delivery operation. It retains the saved
selection identity, rule reference, source hash and native lineage note, then
uses that same complete overlay in source_roles.HIGH_QUALITY_WATERS. The optional
--build-delivery calls Workspace.build_delivery on this completed selection.
The import-only route continues through prepare_delivery_selection.

    python source_tools/designation_crosswalk.py \
        --crosswalk-root COMPLETED_S1_CROSSWALK \
        --bindings ORIGINAL_217_DOMAIN/feature-bindings.json \
        --rules source/water-designations/sc-effective-rules.json \
        --output DESIGNATION_SELECTION \
        --workspace EXISTING_WORKSPACE \
        --save-desk-selection \
        --delivery-selection CURRENT_COMPLETE_SELECTION.json \
        --build-delivery

The direct delivery route remains available from the imported source choice.
The desk route additionally produces the existing selection report, native
GeoPackage, exact selected identities and portable desk record.

## Run against the retained watershed graph

The native binding adapter consumes these actual retained fields:

    schema = "upstate.wbd-domain-bindings/v1"
    feature_count
    selected_huc12
    native_object_id_field
    native_huc12_field
    native_tohuc_field
    original_capture_sha256
    selection_sha256
    features[]:
        huc12, object_id, tohuc, original_body,
        original_feature_index, original_stored_sha256,
        intersects_reporting_area

The graph uses the exact HUC12 strings and TOHUC values. Outgoing links beyond the
prepared domain remain in boundary_links. It validates membership against the
retained selection before deriving resource context.

    payload = from_wbd_bindings(
        bindings,
        resource_document["resources"],
        selection=resource_document["selection"],
        operation="ECSA-20261012",
    )
    payload["sources"] = resource_document["sources"]
    result = apply_rules(payload, rules)

Or write resource_document as JSON, then run:

    python source_tools/designation_rules.py \
        --bindings path/to/feature-bindings.json \
        --resources path/to/resource-document.json \
        --rules source/water-designations/sc-effective-rules.json \
        --operation ECSA-20261012 \
        --output path/to/designation-applicability.json

The CLI records input hashes and replaces the final JSON only after a complete
write. A --selection JSON file can supply a different explicit resource set. A
prepared water-reach payload can be run with --input instead of --bindings.

## Reach-level input when actual reach topology is available

The input schema is upstate.designation-network/v1:

    {
        "schema": "upstate.designation-network/v1",
        "network": {
            "node_kind": "water_reach",
            "source": source_identity,
            "nodes": normalized_reach_records,
            "edges": [[upstream_id, downstream_id]]
        },
        "resources": source_mapped_resources,
        "selection": {"resource_ids": selected_resource_ids,
                      "include_proposed": false},
        "sources": source_catalog
    }

Construct a node from the same parsed class using:

    make_reach_record(
        source_reach_id,
        parsed_class,
        listing_status="listed",  # or source-established unlisted / unknown
        jurisdiction="SC",
        source_feature_refs=source_native_refs,
        regulation_status="current",
        rule_edition_id="sc-r61-69-2023",
        site_specific_numeric_criteria=retained_source_criteria,
        tidal=False,
    )

Current named anchors terminate inheritance. Explicit unlisted nodes receive
nearest named downstream anchors by monotone graph propagation. Multiple distinct
receiving classes remain distinct. Unknown listing status, an out-of-jurisdiction
boundary and source-edition differences remain attached to affected nodes. Closed
cycles and tidal criteria receive explicit source-resolution statuses. Other
mapped resource context still computes.

## Feed the actual delivery overlay

result["selected_source_feature_refs"] contains the selected native identities.
Use the same source identity namespace as the workspace entry:

    predicate = feature_id_selector(
        result["selected_source_feature_refs"],
        source_id=workspace_source_id,
        layer_id=source_layer_id,
        field=original_object_id_field,
    )

The existing vector iterator can combine this callable with its current exact
where filter:

    if where and any(properties.get(k) != v for k, v in where.items()):
        continue
    if predicate is not None and not predicate(properties):
        continue

For a source-native feature stream:

    selected = iter_selected_features(
        original_features,
        result["selected_source_feature_refs"],
        source_id=workspace_source_id,
        layer_id=source_layer_id,
        field=original_object_id_field,
    )

This yields the original feature objects, including the original geometry and
properties. It handles either GeoJSON/Fiona properties or Esri attributes. The
crosswalk's existing native exporter can write the selected GPKG/GeoJSON and
register it through Workspace.import_sources. Delivery can then select that
registered source in high_quality_waters with its retained rule/profile metadata.

Carry these result fields into the overlay source record:

- rule_profile.effective_edition and source_catalog.
- selection and selected_resource_ids.
- selected_source_feature_refs.
- network.source and boundary_links.
- resources[].mapping_status and unmodeled_node_ids.
- nodes[].receiving_resources and classification.

Mapped, partially mapped, and unmapped resources remain separate records. The
output retains proposed-source status when that context is explicitly selected.
Priorities, weights and native mass calculations stay in their existing modules.

## Native adoption run

ASTRA-S1 supplies the current crosswalk associations and native feature identities.
The retained-domain owner supplies feature-bindings.json. ECD1 or the equipped
source worker runs the script, exports the actual selected features through the
existing crosswalk exporter, and registers the output for high_quality_waters.

The useful completion record is the actual consumer source ID, selected native
feature count, mapped resource count, graph node count, and the source artifact
containing the result. These are outputs of the native run.

## License

New code and associated implementation documentation use the repository's MIT
license. The source profile retains the original publishers, editions and source
URLs for regulatory and GIS material.
