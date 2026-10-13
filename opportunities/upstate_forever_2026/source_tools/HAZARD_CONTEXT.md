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
dam coordinate conversion uses the installed pyproj library.

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
before area aggregation. Calculate explicitly classified non-SFHA coverage
from F polygons. Areas outside the retained classification footprint retain
their distinct unknown-coverage state.

Native OBJECTID identifies the captured polygon edition. GlobalID or the
DFIRM_ID/FLD_AR_ID pair supports source lineage. GFID can repeat across
distinct native polygons and therefore serves as a grouping field.

STATIC_BFE=-9999 is a source sentinel. FIRM panel PRE_DATE can carry
253392451200000, corresponding to the 9999-09-09 placeholder; retain the raw
value and treat it as an unknown preliminary date in presentation. EFF_DATE
remains the effective panel date. The helper preserves original numeric and
date fields, source units, datum and all sentinel tokens.

## Import through the running operator

Prepare the dam view before registering the final immutable manifest so one
source edition contains both original NID structures and the readable view.
Use the exact immutable manifest returned in capture-progress.json.

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
      --operation-id UPSTATE-HAZARD-CONTEXT-20261013-ESMX13 \
      --output "$ECO12_HAZARD_INTAKE_RESULT"

Optional repeated --include-collection arguments compose existing geographic
or model inputs whose source IDs are distinct from this edition. The existing
source composer enforces unique source IDs across the selected inputs.

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
  source_id, id_field and original reference URL.
- sfha adds where={"SFHA_TF":"T"}.
- mapped_non_sfha adds where={"SFHA_TF":"F"}.
- flood_coverage keeps the availability selector and both valid native
  classification selectors separate.
- dam_points selects the prepared original-attribute point view and NAME
  label field.

These are the same source-selection fields used by the current conservation
reader and Workspace.source_file. The flood source can be consumed by the
existing native Esri polygon reader. The dam analysis view can be consumed
by the existing vector reader. Pass these selectors to the current parcel
criterion owner so the saved candidate IDs, equal-area geometry and domain
coverage stay attached to the existing criteria operation.

The source roles remain explicit; the adapter adds the inputs and current
Workspace bindings while the criterion operation owns scoring weights,
buffer distances, candidate ranking and displayed coverage semantics.
