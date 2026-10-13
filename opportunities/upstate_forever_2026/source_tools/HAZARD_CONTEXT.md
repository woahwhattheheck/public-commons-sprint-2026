# Upper Savannah floodplain and dam intake

This helper receives the original FEMA National Flood Hazard Layer (NFHL) and
USACE National Inventory of Dams (NID), prepares a readable dam point layer,
and imports the complete source edition into the active Workspace. It reuses
the existing ArcGIS collector, complete upstream domain plan, original file
retention, and operator source composer.

Install these two files into the full current application:

- source_tools/hazard_context.py
- source_tools/HAZARD_CONTEXT.md

The shared dependencies are source_tools/domain_overlays.py,
source/capture_original_overlays.py, source/capture_upstream_network.py,
source_tools/operator_source_intake.py, and model/common.py. The complete
public application at 586dc91a6cb66a9fb1e87afaf69311f3ce4b5437 includes these
existing dependencies. Acquisition and HTTP intake use the standard library;
dam coordinate conversion uses the installed pyproj library. Flood-view
preparation uses the same retained Esri polygon reader, Shapely and pyproj
as the current parcel-criteria consumer.

## Original sources and native contracts

| Source key | Original layer | Manifest role | Spatial meaning |
| --- | --- | --- | --- |
| fema-flood-zones | FEMA NFHL MapServer/28 | FLOOD_HAZARD | Whole native flood-zone polygons, all classes |
| fema-availability | FEMA NFHL MapServer/0 | FLOOD_HAZARD_COVERAGE | Study availability footprints |
| fema-firm-panels | FEMA NFHL MapServer/3 | FIRM_PANELS | Effective map panels and their source dates |
| nid-dams | USACE NID FeatureServer/0 | DAMS | Published dam and associated-structure points |

FEMA service:

https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer

USACE NID layer:

https://geospatial.sec.usace.army.mil/dls/rest/services/NID/National_Inventory_of_Dams_Public_Service/FeatureServer/0

USACE field dictionary:

https://usace-cwbi-prod-il2-nld2-docs.s3.us-gov-west-1.amazonaws.com/0f6b4388-dafb-4ae4-84b4-416ad30b08e5/NID%20Data%20Dictionary%20August%202023.pdf

ArcGIS native query contract:

https://developers.arcgis.com/rest/services-reference/enterprise/query-map-service-layer/

The source metadata observed on 2026-10-13 declares native EPSG:4269 for these
layers and a 2,000-record service limit. The collector reads the actual
metadata on acquisition, selects features with each retained domain tile,
reconciles counts with object IDs, fetches exact ID batches, and splits
transfer-limited batches. Each original response and response receipt travels
with its resulting source entry. Whole feature geometries, native fields,
Z/M flags, coordinate reference, and provider curve representations are
retained.

The complete 217-HUC upstream domain crosses state borders. Geometric
selection includes relevant Georgia structures around Hartwell. Native STATE
values in NID are full state names; the helper uses the existing domain
geometry for selection.

## Capture or resume the complete context

Use the retained domain-overlay plan directory. It contains plan.json,
masks.json, plan-transfer.json, and the original-domain members documented by
source_tools/DOMAIN_OVERLAYS.md. The existing plan can be produced on the
current GIS host and transferred through the existing domain plan archive.

From the full application directory:

    python source_tools/hazard_context.py capture \
      --domain-capture "$ECO12_DOMAIN_CAPTURE" \
      --output "$ECO12_HAZARD_CAPTURE"

The helper retains the exact domain plan and masks beneath the new output
directory. It writes hazard-plan.json before source acquisition, preserving
the selected source contracts and the original domain identity.

Capture output contains:

- layers/<source-key>/ with native features and complete original responses.
- domain/ with the original complete-domain plan and transferred members.
- A separate document source whose body is the original domain/masks.json;
  its upstream group can be selected directly for criterion coverage.
- source-manifest-<edition>.json, an immutable upstate.sources/v1 edition.
- sources.json, the current convenient manifest name.
- capture-progress.json, with completed sources, remaining sources and exact
  per-source failures.

A completed layer is reusable immediately while another source finishes.
Rerun the same output to reuse successful captures and continue absent
sources. Add --retry-failed after repairing a retained provider failure:

    python source_tools/hazard_context.py capture \
      --output "$ECO12_HAZARD_CAPTURE" \
      --retry-failed

Use --source repeatedly to work independent providers in the same retained
operation. For example, --source nid-dams receives NID while the FEMA operator
continues with its existing capture. The output directory has one
capture lock, so concurrent workers should use separate capture roots or
serialize their writes to a shared root. Existing source identities and
successful response bodies survive retries.

All requested sources use the exact existing upstream acquisition masks.
Buffer and tile-edge overcoverage remain in the captured originals.
Area and distance calculations use the selected study geometry and a
projected analysis CRS.

## Prepare dam points and reservoir identity

After NID completes:

    python source_tools/hazard_context.py prepare-dams \
      --output "$ECO12_HAZARD_CAPTURE"

This adds a GeoJSON point view in EPSG:4326 for the existing vector readers.
The transformation uses the source-declared CRS and explicit XY coordinate
order. Every original attribute remains unchanged. Native geometry, Z/M
axes, response bytes, and the transformation description remain companions.
Rows with missing source geometry are listed by object ID in derivation.json.

The companion reservoir-index.json groups structures by NIDID. It identifies
a unique main structure using the exact native
IS_ASSOCIATED_STRUCTURE="No" predicate. Its primary_state is unique, missing,
or ambiguous; only a unique primary row supplies primary_attributes.

This distinction matters at Hartwell. The current original inventory has a
main structure FEDERAL_ID=GA01702 and associated saddle dikes
GA01702S001/GA01702S002. All three share NIDID=GA01702 and repeat reservoir
storage. Storage totals must use the primary reservoir row. Structure
counts and distances can include each original structure separately.

| Native field | Interpretation |
| --- | --- |
| OBJECTID | Snapshot query identity |
| FEDERAL_ID | Individual structure business identity |
| NIDID | Reservoir grouping identity |
| NID_STORAGE, MAX_STORAGE, NORMAL_STORAGE | Acre-feet; zero normal storage is valid for normally dry reservoirs |
| DRAINAGE_AREA | Square miles |
| HAZARD_POTENTIAL | Downstream consequences if failure occurs |
| DATA_UPDATED | Original epoch-millisecond UTC value |
| PURPOSES | Dictionary multi-value separator is semicolon |
| PRIMARY_PURPOSE | Preserve complete native text, including internal commas |

The primary-state grouping preserves unresolved source identity explicitly.
All source values, including nulls and zeroes, stay in the original attributes.

## Flood classification and coverage

The verified native SFHA_TF codes are T and F. The helper emits exact typed
selectors for each code, keeping FLD_ZONE and ZONE_SUBTY available for
interpretation. It retains the complete source rather than filtering the
acquisition to SFHA polygons.

Use three separate spatial measurements:

1. The union of original FEMA availability footprints intersecting the
   selected reporting geometry.
2. The union of actual source polygons carrying a valid T or F classification.
3. The union of T polygons for the SFHA fraction.

Availability records can repeat STUDY_ID and overlap. Union their geometry
before area aggregation. Retain F polygons as the provider's original
non-SFHA designation rows and interpret their FLD_ZONE and ZONE_SUBTY.
Assessed criterion coverage uses the class predicate below. Areas outside
the retained classification footprint retain their unknown-coverage state.

Native OBJECTID identifies the captured polygon edition. GlobalID or the
DFIRM_ID/FLD_AR_ID pair supports source lineage. GFID can repeat across
distinct native polygons and therefore serves as a grouping field.

STATIC_BFE=-9999 is a source sentinel. FIRM panel PRE_DATE can carry
253392451200000, corresponding to the 9999-09-09 placeholder; retain the raw
value and treat it as an unknown preliminary date in presentation. EFF_DATE
remains the effective panel date. The helper preserves original numeric and
date fields, source units, datum and all sentinel tokens.

## Prepare flood views for parcel criteria

After the original FEMA all-zone capture completes in this hazard root:

    python source_tools/hazard_context.py prepare-flood \
      --output "$ECO12_HAZARD_CAPTURE"

This adds three gzip-compressed native Esri polygon views:

| Binding source key | Manifest role | Retained rows |
| --- | --- | --- |
| fema-flood-zones-sfha | FLOODPLAIN_ONE_PERCENT | Valid polygon rows whose native SFHA_TF is T |
| fema-flood-zones-classified-tf | FLOOD_CLASSIFICATION_COVERAGE | Valid polygon rows whose native SFHA_TF is T or F |
| fema-flood-zones-criterion-coverage | FLOOD_ASSESSMENT_COVERAGE | T polygons plus F polygons in assessed zones B, C or X |

The original all-zone entry and its original responses remain alongside
all three views. Selected rows keep their original attributes, object IDs,
native CRS and geometry. Preparation checks geometry with the same XY
Esri reader used by conservation and records its corrections in
derivation.json; the source geometry itself stays intact. The derivation
also records native and selected counts, unclassified IDs, absent geometry,
empty geometry and geometry with no polygon area. Criterion-coverage
exclusions retain their object ID, SFHA_TF, FLD_ZONE and ZONE_SUBTY.

The SFHA view can contain features=[] when the source has no usable T
polygons. This is the current parcel-criteria reader's supported empty-source
representation. Each supplied floodplains choice selects this prepared
view directly. The complete T/F view describes the provider's SFHA designation
coverage. The parcel criterion uses the separate assessed coverage view,
which includes T rows plus F rows in zones B, C and X. Zone comparison trims
whitespace and uppercases text; original attributes remain unchanged.

Zone D describes undetermined flood hazard. ANI/AREA NOT INCLUDED belongs
on another FIRM; OW/OPEN WATER has no defined flood-hazard zone; NP describes
an area not mapped under the documented levee-seclusion case. These classes,
blank/null zones and unrecognized zone codes remain outside known-negative
criterion coverage. B and C are the documented legacy predecessors of shaded
and unshaded X. This is coverage of the FEMA SFHA designation used by the
criterion; X still includes moderate, shallower or channel-contained flood
hazards.

If the assessed coverage view is empty, the binding omits coverage and
absence remains unknown. A nonempty all-F/D source therefore produces an
empty positive view, an intact T/F designation view, and no known-negative
criterion coverage.

The class predicate follows these original FEMA references:

- [FIRM database domain tables, November 2023, D_Zone](https://www.fema.gov/sites/default/files/documents/fema_rm-domain-tables-technical-reference-nov-2023.pdf)
- [FIRM Database Guidance, section 12.7.1](https://www.fema.gov/sites/default/files/documents/fema_firm-database-guidance.pdf)
- [FEMA training on B, C, X and D flood zones](https://emilms.fema.gov/is_0273/groups/77.html)
- [NFHL Guidance, February 2019, SFHA quality-control rules](https://www.fema.gov/sites/default/files/2020-02/NFHL_Guidance_Feb_2019.pdf)
- [MT-1 Technical Guidance, November 2024, Zone D](https://www.fema.gov/sites/default/files/documents/fema_guidance_mt-1_technical_guidance_nov_2024.pdf)

The original FEMA availability footprints remain a separate source for
mapping-availability measurements. They do not fill gaps in designation or
assessed criterion coverage.

## Import through the running operator

Prepare the required dam and flood views before registering the final
immutable manifest. Each successful preparation publishes a new immutable
manifest and updates capture-progress.json with its exact path. Existing
capture roots, native response files, earlier manifests and imported
collections remain reusable.

Add that file to the active operator's repeated --source-manifest startup
argument. Preserve the current Workspace, source roots, native interpreter
and installed routes. The source catalogue reports the registered ID and
the exact manifest SHA256:

    python source_tools/operator_source_intake.py catalog \
      --operator-url "$ECO12_OPERATOR_ORIGIN" \
      --capability-file "$ECO12_OPERATOR_CAPABILITY_FILE" \
      --study-title "$ECO12_STUDY_TITLE"

Then compose and import the registered edition:

    python source_tools/hazard_context.py intake \
      --operator-url "$ECO12_OPERATOR_ORIGIN" \
      --capability-file "$ECO12_OPERATOR_CAPABILITY_FILE" \
      --study-title "$ECO12_STUDY_TITLE" \
      --manifest "$ECO12_HAZARD_MANIFEST" \
      --registered-manifest "$ECO12_HAZARD_REGISTERED_ID" \
      --operation-id UPSTATE-HAZARD-CONTEXT-20261013-ESMX13-criteria-v2 \
      --output "$ECO12_HAZARD_INTAKE_RESULT"

Optional repeated --include-collection arguments compose existing geographic
or model inputs whose source IDs are distinct from this edition. The existing
source composer enforces unique source IDs across the selected inputs.

If an earlier manifest already used an intake operation ID, this successor
manifest is a new source selection: give it a new operation ID, such as the
criteria-v2 value above, and a new intake-result path. Rerun the same
operation ID and result path only for the same manifest and collection
selection. Earlier native tasks and imported collections retain their own
identities.

The client uses the actual source.compose action, importing through the
operator's native queue and Workspace.import_sources. It checks the current
registered manifest hash before submission, records the stable operation
before sending, recovers a response lost after acceptance, follows native
task progress, and reopens the imported source collection.

After readback, every declared source body must match its kind, role,
SHA256 and byte count. The result includes the actual Workspace collection
ID, composition task ID and complete source bindings. Rerun the same command
and result path to resume its existing native task. --wait-seconds defaults
to following the native task to completion; expiration retains pending state.

## Bind the captured sources to criterion engineering

The result's bindings field uses upstate.hazard-source-bindings/v1:

- sources maps each source key to its actual source_collection_id,
  source_id, native id_field when applicable, and the original reference.
- sfha adds where={"SFHA_TF":"T"}.
- mapped_non_sfha adds where={"SFHA_TF":"F"}.
- flood_coverage keeps the availability selector and both valid native
  classification selectors separate.
- dam_points selects the prepared original-attribute point view and NAME
  label field for callers that define their own spatial relationship.
- sources.upstream-masks selects the standalone original mask document.
- parcel_criteria.sources contains explicit dams and/or floodplains choices
  that match the current parcel-criteria preparation interface.

These are the same source-selection fields used by the current conservation
reader and Workspace.source_file. The flood views use the existing native
Esri polygon reader; the dam view uses the existing vector reader. The
original sfha, mapped_non_sfha, flood_coverage and dam_points keys and
selectors remain compatible. The parcel_criteria fragment supplies the
consumer-specific choices.

### Explicit parcel-criteria choices

The receiver uses the current full application family, including
source_tools/parcel_criteria.py. Its receiving contract was checked at
33ecf9443eddf5d0e01ebf7a1d2600aa78682ba4 in
feat/upstate-protection-experiments-e7a1-20261013; that file is 69,645 bytes,
SHA256 07710f48afcf7e5725c058fe82498669110081144846a3555ed707ec839b9f41.

The emitted fragment has this shape:

    {
      "sources": {
        "dams": {
          "source_collection_id": "...",
          "source_id": "...",
          "id_field": "OBJECTID",
          "label_field": "NAME",
          "relation": "Original NID structure point intersects the retained reporting parcel",
          "coverage": {
            "source": {"source_collection_id": "...", "source_id": "..."},
            "group": "upstream"
          }
        },
        "floodplains": {
          "source_collection_id": "...",
          "source_id": "...",
          "id_field": "OBJECTID",
          "coverage": {
            "source": {"source_collection_id": "...", "source_id": "..."}
          }
        }
      }
    }

Actual collection IDs, source IDs and ID-field names come from the imported
source readback. A choice is included only when its prepared view exists.
Dam coverage is supplied only when every captured structure has usable point
geometry: geometry_absent_count must equal zero. This is coverage of the
queried NID inventory; a covered negative means no retained NID structure
point intersects the parcel. The inventory's inclusion thresholds omit some
smaller low-hazard structures. Otherwise the dam point
observations remain usable and absence retains unknown coverage. The mask
source body is the exact original domain/masks.json document, with its
upstream group; the surrounding plan and original domain members remain
companions.

The current method's generic floodplain_present, with_development and
without_development metrics receive a named source adaptation here: mapped
FEMA Special Flood Hazard Area overlap, selected by the native SFHA_TF=T
flag. A covered negative means outside the published SFHA within defined
mapped zones. X subtypes can still describe shallow, channel-contained,
future-conditions or reduced-risk flooding; FLD_ZONE and ZONE_SUBTY remain
attached to the original rows.

The floodplains choice uses the T-only source without a where predicate.
Its coverage source is the nonempty assessed criterion-coverage view.
Availability footprints, bare F flags and source scopes do not imply assessed
known-negative coverage.

| Source observations and coverage | Current criterion result |
| --- | --- |
| A published NID point intersects the reporting parcel | True |
| No NID point intersects; the complete capture has zero absent geometries and its masks cover the parcel | False |
| No NID point intersects; required capture geometry or coverage is missing | Unknown |
| An SFHA polygon has positive-area overlap with the reporting parcel | True |
| No SFHA overlap; assessed T plus F/B,C,X coverage contains the parcel | False |
| No SFHA overlap; some parcel area lacks assessed coverage | Unknown |
| SFHA view is empty; assessed F/B,C,X coverage contains the parcel | False |
| Only F/D or other undetermined classes cover the parcel | Unknown |
| All flood views are empty | Unknown |

The current direct dam criterion uses point intersection. A separately
defined distance criterion can continue using the original dam_points
binding. Explicit source overrides take precedence over profile role
auto-selection, so the prepared DAMS entry can be used by sources.dams
without renaming earlier source editions.

Within the existing Workspace receiver, merge the actual intake choices
into the retained criterion request:

    from model.common import read_json
    from source_tools import parcel_criteria

    intake_result = read_json(hazard_intake_result_path)
    request = read_json(retained_criterion_request_path)
    request.setdefault("sources", {}).update(
        intake_result["bindings"]["parcel_criteria"]["sources"]
    )
    criterion_result = parcel_criteria.prepare(workspace, request)

The retained request supplies schema=upstate.parcel-criteria-selection/v1,
exactly one current study_id or study, and its existing settings. This
preserves the current reporting geometry, candidate identities, other source
choices and criterion configuration.

### Join the existing FEMA operation

When another receiver already owns FEMA preparation, capture only
--source nid-dams in a separate hazard root, prepare-dams, then intake that
edition with --include-collection for the existing FEMA collection when a
composed edition is useful. The adapter generates bindings for the local
manifest entries it verified; the parcel_criteria fragment therefore adds
dams while preserving the receiver's existing floodplains choice.

Existing FEMA selectors may continue to reference their original immutable
collection. If the receiver chooses to point them at a newly composed
collection, it verifies the copied entries before changing those collection
IDs. There is no need to recapture an already retained FEMA edition.
