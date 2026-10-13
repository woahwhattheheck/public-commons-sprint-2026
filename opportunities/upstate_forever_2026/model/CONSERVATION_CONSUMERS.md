# Conservation selections for implementation, monitoring and editable design

This adapter joins the existing saved conservation portfolio to the implementation/field-monitoring and geometry/scenario workbenches. The authoritative selection remains the original record under conservation-plans/<plan_id>/plan.json. The consumer keeps a foreign reference to that record and may retain a portable view with its own task, monitoring or design revision.

## Maintained interface

Import the additive model/conservation_bindings.py module from the full product:

    from model.workspace import Workspace
    from model.conservation_bindings import (
        bind_plan, plan_reference, resolve_reference, validate_binding, write_binding,
    )

    workspace = Workspace(existing_workspace_path)
    binding = bind_plan(workspace, existing_plan_id, include_geometry=True)

The binding is a JSON object with schema upstate.conservation-binding/v1. Its id is the SHA-256 of its canonical complete payload, excluding id. It contains these fields:

| Field | Exact content |
| --- | --- |
| source_reference | Original Workspace ID, plan ID, study ID, complete selected native ID list, candidate/geometry file identities and selected-union descriptor |
| plan | Complete existing saved plan returned by conservation.get_plan |
| study | Complete saved study without the full unselected candidate array |
| selected_units | One row per selected original native ID in saved order: unit_ref, compact plan_ref, candidate, implementation_basis |
| source_assets | Original retained source collection manifest, complete source entry, body/companion file descriptors, and declared geographic relation |
| native_runs | The exact baseline/alternative run selections, pinned version, original module identity and registry files |
| geometry | Standard longitude/latitude GeoJSON views of the selected whole units, reporting footprints and their unions; null with include_geometry=False |
| artifacts | Original plan, study, candidate inventory, geometry inventory and selected reporting-union file descriptors |
| scientific_contract | Physical units, availability, paired-support interpretation and original method |
| consumer_contract | Attachment, geometry-revision and original scenario-call contract |

All descriptors in artifacts, source_assets and native_runs are relative to the original Workspace. The complete embedded plan and study preserve their own original descriptor conventions. Native-registry descriptors in native_runs.outputs are explicitly normalized to the Workspace root, for example runs/<run_id>/ndr/n_total_export.tif.

The same plan can be reopened without introducing another portfolio store:

    reference = plan_reference(workspace, existing_plan_id)
    reopened = resolve_reference(workspace, reference, include_geometry=False)

resolve_reference requires the original Workspace identity and exact saved selection. A complete Workspace restoration preserves that identity. A successor conservation plan gets its own plan_id, while the earlier implementation/design record keeps its original reference.

## Implementation and field-monitoring consumer

Use the complete source_reference as the program's source attachment. Each selected_units row carries:

    row["unit_ref"] = {
        "kind": "retained_planning_unit",
        "unit_key": original_source_edition_and_native_id_digest,
        "source_collection_id": original_collection_id,
        "source_id": original_source_id,
        "native_id": original_text_key,
    }

unit_key joins consumer records to a source-edition-specific unit. native_id remains the exact original string, including any leading zeroes. candidate is the original complete selected conservation candidate. implementation_basis exposes its label, unit type, whole-unit hectares, reporting hectares, original supplied planning amount/currency and selection-time eligibility.

A consumer can create its own assigned implementation tasks, dependencies and calendar records from these selected rows. Retain source_reference and unit_ref on each task or site record. Budget, commitment and actual-cost ledger entries retain the implementation workbench's own values and dates. The conservation candidate's supplied_whole_unit_cost stays a referenced source planning amount.

Example importer access:

    for row in binding["selected_units"]:
        reference = row["unit_ref"]
        candidate = row["candidate"]
        task_source = {
            "conservation": binding["source_reference"],
            "planning_unit": reference,
        }
        label = candidate["label"]
        source_amount = row["implementation_basis"]["supplied_whole_unit_cost"]
        # Pass task_source, label and the source amount to the implementation
        # workbench's existing program/task creation API.

The adapter performs no assignment, visit or sample fabrication. A monitoring site keeps its actual or explicitly proposed location and the declared planning-unit/catchment relation. A selected parcel/portfolio footprint does not automatically become the site's upstream drainage catchment.

The original observation consumer remains Workspace.import_observations followed by Workspace.compare_observations. Annual-load comparison requires the original observation catchment ID source and the observation's own annualization method, period, unit, qualifier and source-record identity. The conservation binding supplies spatial/model context and original native run references.

## Geometry and independent design revisions

With include_geometry=True, the adapter returns:

- geometry.whole_units: complete selected source units, transformed from the retained study analysis plane.
- geometry.reporting_units: those units intersected with the saved reporting boundary.
- geometry.reporting_union: the actual saved selected_union feature from the plan GeoPackage.
- geometry.whole_unit_union: the union of the selected whole source units.

All four are standard GeoJSON FeatureCollections in EPSG:4326, using longitude, latitude coordinates. Geometry is represented as an analysis view. Area properties preserve the original projected-plane hectares; the transformation does not recompute area using angular coordinates. Holes and multipart boundaries remain in the geometry. Original untouched source bytes, source properties, native CRS and any Z/M coordinates remain available through source_assets.

Each unit feature has id=unit_ref.unit_key and properties unit_id, source_collection_id, source_id, plan_id, study_id, label, area fields and original_attributes. A design workbench can retain its imported feature, source_reference, original source assets, edit history and independent successor alternatives. The maintained conservation plan remains the earlier saved selection.

The exact original metric union is:

    descriptor = binding["artifacts"]["selected_reporting_union"]
    # descriptor["path"] == conservation-plans/<plan_id>/geodata.gpkg
    # descriptor["layer"] == selected_union
    from model.common import verify_file
    original_metric_path = verify_file(workspace.root, descriptor)

selected_union contains one MultiPolygon feature with title and area_ha properties. Read that entire layer. The same GeoPackage's planning_units and reporting_footprints layers use the original string unit_id.

## Original selected-plan scenario bridge

For an unchanged saved selected footprint, call the maintained bridge:

    from model.conservation_scenarios import create_scenario
    result = create_scenario(workspace, {
        "plan_id": binding["plan"]["id"],
        "title": title,
        "reason": explicit_landcover_reason,
        "from_codes": actual_original_landcover_codes,
        "to_code": actual_destination_landcover_code,
        "prepare_run": {
            "grid_id": existing_grid_id,
            "profile_id": existing_profile_id,
        },
    })

prepare_run is optional. The bridge retains the actual selected footprint as a vector source and uses the original Workspace scenario/run path.

For an independently edited design polygon, first retain the design workbench's actual exported geometry and original source manifest through Workspace.import_sources. Then use the existing native call directly:

    collection = workspace.import_sources(actual_design_source_manifest)
    scenario = workspace.save_scenario({
        "title": title,
        "kind": "landcover",
        "source_collection_id": collection["id"],
        "reason": explicit_landcover_reason,
        "patches": [{
            "mask_source_id": actual_edited_geometry_source_id,
            "layer": actual_edited_layer_name,
            "from_codes": actual_original_landcover_codes,
            "to_code": actual_destination_landcover_code,
            "reason": explicit_landcover_reason,
        }],
        "design_source_reference": binding["source_reference"],
        "design_revision_id": actual_design_revision_id,
    })
    run = workspace.prepare_run({
        "grid_id": existing_grid_id,
        "profile_id": existing_profile_id,
        "scenario_id": scenario["id"],
    })

Omit layer for a source without a named layer. All original and destination land-cover codes are integers; the original native adapter checks destination codes against the selected biophysical table. The original rasterizer applies the declared polygon mask at the selected original model grid resolution. The native run's land-cover stage records actual changed cells and hectares.

## Physical quantities and paired support

Source-context studies retain metric_state=context_only. Their physical pollutant quantities are null, while original areas and mapped source-context overlaps remain available.

Native studies retain exact InVEST 3.20.0 run selections. The original NDR rates are kg/ha/year; original SDR sediment export is metric_tonnes/ha/year. Conservation annual totals multiply rates by actual polygon-cell intersection hectares and keep these physical quantities separate:

| Key | Annual quantity unit |
| --- | --- |
| nitrogen_export | kg/year |
| phosphorus_export | kg/year |
| sediment_export | metric_tonnes/year |

For each alternative, delta is alternative minus baseline on common valid original cells. reduction reverses that direction. Display common_coverage_fraction for the paired difference and coverage_fraction for the alternative itself. profile_changed exposes a different parameter profile. Structural stream omissions use each original stage's verified stream mask and remain separate from unexpected missing support.

These are selected-footprint contributions within the complete modeled cases. An actual selected-action effect comes from a scenario whose original change mask is the selected intervention geometry, with whole-scenario comparison handled by the maintained native comparison workflow.

Primary native unit references:

- https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html
- https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html

### Partial native model selections

The consumer carries scientific_contract.native_grid with the retained grid ID, resolution_m, pixel_area_ha, affine transform and source alignment. Geometry views retain original analysis areas, and exported model values keep that original cell resolution.

The consumer binds each original run.selection.models. Omission preserves historical combined NDR and SDR; an explicit partial list chooses only the named native model. native_runs[run_id].selected_models exposes that normalized list, and output_availability preserves all three pollutant names with availability and availability_reason. outputs contains only the original selected native output descriptors, each retaining its exact InVEST 3.20.0 run selection and native rate units.

For baseline metrics, availability is modeled or not_selected; source-context metrics retain unbound. The annual quantity and native-support areas are null when that model was omitted. Each alternative has an independent availability and may have a measured value even when the baseline omits the same pollutant. Its comparison_availability is modeled only when both cases selected the pollutant; otherwise not_shared, with comparison_availability_reason. No paired mass, delta or common-support fraction is supplied for an omitted side. Selected native outputs with no valid intersection remain distinguishable through their actual coverage and valid areas.

Implementation records should copy these values and reasons intact. A monitoring task can attach a real selected land unit and source/intake context regardless of which native models are available. Native N/P/sediment outputs remain modeled annual quantities; the field workflow retains actual sample method, analyte, unit, location, time and laboratory result separately.

## Portable consumer view

Write the actual complete view with its embedded selected geometry:

    python -B -m model.conservation_bindings export \
      --workspace /path/to/original-workspace \
      --plan-id ACTUAL_SAVED_PLAN_ID \
      --output /path/to/conservation-binding.json

For the implementation/task importer without display geometry, add --without-geometry. Use --replace when intentionally refreshing the standalone consumer artifact at the same path. This changes that exported view, while the existing plan and study records remain the source reference.

Read and validate an exported view:

    python -B -m model.conservation_bindings verify /path/to/conservation-binding.json

To also resolve its original source reference and compare the complete view in the restored Workspace:

    python -B -m model.conservation_bindings verify \
      /path/to/conservation-binding.json \
      --workspace /path/to/original-workspace

The consumer JSON carries selected records and display geometry. The original complete Workspace archive carries the referenced scientific inputs, editable native sources and model outputs for re-computation.

## Exact native GeoJSON and companion import

ASTRA-DESIGN12 can retain an edited revision through the original Workspace source importer with the following complete helper. It hashes the existing revision's actual files, writes sources.json beside those files, and returns the original immutable source collection. Supply the actual captured edition, original capture URI or retained design artifact URI, portable relative paths, and original conservation/design references. This helper assumes a standard longitude/latitude GeoJSON representation; use the actual declared representation when retaining another vector format.

```python
from pathlib import Path
from model.common import atomic_json, file_digest, relative_file

def import_design_revision(workspace, revision_directory, *, source_id,
                           geometry_path, title, uri, vintage, captured_at,
                           companion_paths=(), provenance=None, id_field=None):
    root = Path(revision_directory).resolve(strict=True)
    geometry = relative_file(root, geometry_path)
    entry = {
        "id": source_id, "kind": "vector", "role": "SCENARIO_MASK",
        "title": title, "uri": uri, "vintage": vintage,
        "path": geometry_path, "sha256": file_digest(geometry),
        "source_crs": "EPSG:4326",
        "companions": [
            {"path": name, "sha256": file_digest(relative_file(root, name))}
            for name in companion_paths
        ],
        "scope": {"design_revision": provenance or {}},
    }
    if id_field is not None:
        entry["id_field"] = id_field
    manifest = {
        "schema": "upstate.sources/v1", "title": title,
        "captured_at": captured_at, "entries": [entry],
        "scope": {"design_revision": provenance or {}},
    }
    manifest_path = root / "sources.json"
    atomic_json(manifest_path, manifest, immutable=True)
    return workspace.import_sources(manifest_path)
```

The importer accepts a native path to an upstate.sources/v1 manifest. Entries require a unique id, kind, title, uri, vintage and path. Optional sha256 validates the existing file. Each companion is a path with optional sha256 and is resolved relative to the same manifest. Workspace creates body/source_path/view_path and preserves the native sidecar directory relationship. Entry metadata such as role, source_crs, id_field and scope remains retained. GeoJSON needs no invented layer name.

Use the returned collection.id in Workspace.save_scenario, and the actual entry source_id as mask_source_id. Keep the original source GeoJSON and conservation-binding.json as companions when they belong to the revision. Preserve the saved conservation plan reference in provenance while each actual edited design revision gets its own source edition. The original selected-plan bridge continues to use its exact selected_union footprint.


## Published practice and experiment consumers

The complete current binding preserves the published practice fields inside
each `selected_units[].candidate`: `point_score`, `point_priority`,
`score_unit` and original criterion components. The full method/category,
definition identity, source table and selected field transformations remain in
`study.selection.bindings.published_method` and the original study score
selection. The source table is also present in `source_assets.priority_metrics`
when one was bound.

A plan saved by the optimizer remains the original conservation plan. Its
`plan.selection.optimization` carries the exact analysis reference, declared
objective, source identities, solver request, normalization and geographic
meaning. A consumer can therefore accept manual, ranked and optimized practice
selections through the same `bind_plan` callable.

Published points retain their criterion meaning, prerequisite and source.
Physical nitrogen, phosphorus and sediment values remain in their separate
original fields and annual units. The complete original grid is still
available as `scientific_contract.native_grid`, including source-native
resolution and pixel area.

The bridge adds optional `prepare_experiment` to the existing
`create_scenario` request. It accepts the experiment title/reason, optional
matching `baseline_run_id`, `prepare_run`, additional `profile_ids`,
`scenario_ids`, `design` and `axes`. The returned conservation scenario ID
remains the original bridge record; the prepared experiment and native case
IDs are retained as its continuation.

The standalone callable is
`model.conservation_scenarios.prepare_experiment(workspace, spec)`, with
`conservation_scenario_id` required. Existing consumers can discover the exact
current selection fields through `consumer_contract.experiment_selection`.
Use the returned `experiment_id` with the original `experiment.run` queue
action. `inspect_scenario` and `list_scenarios` reopen the retained scenario,
footprint and experiment links.

The selected union must fit the full native model domain. Its reporting-area
overlap is a separate measured relation. The bridge retains those original
boundary descriptors and actual area fractions, while the original native
scenario kernel applies the saved land-cover replacement at the selected
grid's actual resolution.

## Source-derived acreage intervals and presentation continuity

The original selected candidate remains the consumer's authoritative scientific record. A point candidate's `point_score.metric_bounds` retains closed acreage endpoints, observed positive area, unresolved area, certainty coverage, actual geometry basis and source references. `point_score.metric_values` keeps an unresolved exact acreage null. Individual `score_components` retain their known/possible contribution and whether the whole interval determined exact points. A complete point score can therefore coexist with a bounded acreage measurement.

A true practice prerequisite and equal total contribution bounds determine an applicable exact practice score. Missing and false prerequisites retain their own states. Downstream implementation or monitoring records can display those states directly while preserving the original `unit_key`, native ID and source selection. Published points remain parcel-priority quantities; physical annual mass and selected-union quantities retain their original separate fields.

Builder-produced criterion metadata records `spatial_criteria_basis` and per-field `metric_geometry`. New source derivations default to the whole original parcel; reporting-boundary criteria are an explicit retained adaptation. Parcel size, protected-land, land-cover, floodplain-development and native export bases can differ deliberately and are recorded separately. The source table binds the exact original parcel/reporting context, so a matching ID string alone is insufficient to substitute another geometry edition. The full metadata and original criterion source remain in the retained study and source assets.

`conservation.export_packet` now binds an additional presentation edition to the same verified candidate and geometry files and saved selected IDs. It retains prior study/plan file descriptors and creates current HTML, CSV/GIS and criterion/source supplements in its own export directory. Consumers reopening an older saved plan keep the original source and decision identities while receiving the current readable presentation. The full working archive continues through the ordinary Workspace backup/restore path. See [CONSERVATION_REPORTS.md](CONSERVATION_REPORTS.md), [PARCEL_CRITERIA_GEOMETRY.md](../source_tools/PARCEL_CRITERIA_GEOMETRY.md) and [PARCEL_CRITERIA_INTERVALS.md](../source_tools/PARCEL_CRITERIA_INTERVALS.md).

## Source-profile alternatives and native classification transfers

Presentation version 3 adds four string fields to both candidate CSV and each
parcel GeoPackage layer: `point_score_options`, `point_priority_options`,
`point_source_profile` and `point_classification_states`. Each is JSON text for
the saved typed value. Missing fields in an older candidate remain null; presentation
does not infer a new option set or recompute its score.

`criterion-contributions.csv` adds the retained `score_options`,
`source_classifications` and `source_profile`. Each original top-level
criterion contributes once. Classification records preserve nested criterion IDs,
matched/possible classes, original references and all states encountered across a
bounded acreage. Literal `ambiguous` classifications represent overlapping source
bins; `unclassified` represents a gap or value outside the original bins.
Their exact retained alternatives remain available rather than treating the entire
minimum-to-maximum integer range as attainable.

`criterion-values.csv` adds `raw_value`, `raw_unit`,
`source_classifications`, `source_profile`, `native_pixel_area_m2`,
`original_profile_pixel_area_m2` and `profile_transfer`. A typed class result
uses `value_state=source_profile_classification`; its actual measured input stays
separate. For a native source-band transfer, preserve the current raster area,
native/profile units, adaptation reference and explicit sediment ton definition.
A null original-profile pixel area means the source did not establish it.

The HTML report renders total and criterion option lists, source class states,
current-grid transfer details and original profile identity. The complete typed
records remain in `criterion-scores.json` and `source-register.json`.
Presentation identity versioning creates a new export edition from the original
verified candidate/geometry inventory; it leaves earlier declared artifacts intact.
