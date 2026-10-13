# Restoration extent and placement studies

This extension adds a complete source-bound restoration response study to the
existing Upstate scientific Workspace. It creates ordinary saved scenarios and
prepared native runs, keeps their exact original footprint previews, and uses
the established scenario analysis for annual physical exports.

## Scientific selection

Select one original land-cover baseline run, its retained stream vector edition
and line layer, explicit placements, explicit buffer distances, eligible
original land-cover classes and a destination class present in the same saved
biophysical profile. A placement is an exact property-value filter within the
selected stream source. The source-level and placement-level filters are both
applied. All selected feature IDs and properties remain in each case's
stream-selection.json; the original vector edition and companions remain in
the Workspace.

A width is the buffer distance **on each side of a stream line**, in metres.
It is not the full corridor width. No scientific width, destination class or
coefficient is chosen by the extension. The saved reason records the restoration
assumption. The baseline grid, profile, native model selection, source editions
and original native engine are preserved.

The stream geometries are projected into the original projected metre CRS.
The buffer uses round caps and round joins with 16 segments per quadrant,
and is clipped to either the original reporting polygon or the original
prepared model-domain polygon. Choose the clipping scope explicitly. Each
resulting polygon is retained as a projected GeoJSON source and passed through
the existing ordered land-cover scenario compiler. Pixel-centre inclusion and
the original eligible-class rule determine which cells actually change.

The polygon's geometric hectares and the actual changed-cell hectares are
reported separately. Narrow widths can change no raster cells. Wider buffers
can produce exactly the same categorical raster. Neither case is assigned an
invented fractional treatment area.

## Original native execution

prepare_study(workspace, spec) returns one immutable study containing cases,
source bindings, files and execution_run_ids. It does not start a model.
The original operator queue's run.start operation executes each needed saved
run; the native Workspace.run path remains the CLI authority.

A case keeps its own original run_id, scenario_id and footprint_id.
execute_run_id is the original run whose native result supplies this case.
For an empty or unchanged corridor that is the baseline. Cases with identical
full categorical cells and validity reuse one original effective run on the
same grid, profile and model selection. The comparison uses cell-value hashes,
not TIFF metadata or polygon area. The selected widths and all footprints
remain visible even when they share a native run.

The backend verifies nesting on the actual compiled net-change masks for
adjacent widths within each placement. Lost changed cells are a geometry/input
error, not a permissible negative treatment denominator.

Use the existing retained native job continuation after interruption. The study
never creates a second worker or independently resumes a running job. Already
completed original runs remain available and are reused by identity.

## Saved API

The input schema is upstate.restoration-extent-study-input/v1. Fields:

- title and reason: authored scientific study description and assumptions.
- baseline_run_id: original baseline scenario using retained source land cover.
- stream_source: source_collection_id, source_id, optional layer and where.
- placements: nonempty list of {id, title, where?}; IDs are distinct.
- widths_m: explicit distinct positive distances; preparation orders them.
- from_codes: explicit distinct integer source land-cover classes.
- to_code: integer destination class, distinct from every source class.
- scope: reporting or model_domain.

Filters are property objects using exact scalar equality. They are not SQL.
A placement with no selected stream geometry is rejected with its placement
ID. A selected stream whose buffer does not intersect the clip is retained as
an empty, zero-change case.

Functions:

- prepare_study(workspace, spec): original source/scenario/run/footprint creation.
- list_studies(workspace): immutable saved study catalogue.
- inspect_study(workspace, study_id): {record, current_cases, report}.
- read_report(workspace, study_id): saved report or null; read-only.
- build_report(workspace, study_id): saved physical response after all effective
  original runs are complete.

All returned file descriptors resolve relative to workspace.root.
Current cases add state from their execute_run_id. The record's
execution_run_ids includes the baseline and every distinct effective case.
Queue callers should retain their original operation IDs during refresh and
recovery, using the established operator request deduplication.

## Response and marginal calculations

build_report calls the existing Workspace.analyze_scenarios once with the
original baseline and all distinct effective case runs. For each pollutant,
that analyzer uses the intersection of valid reporting cells across the whole
cohort. Its original physical values and source binding remain in analysis.json.

Every curve includes the actual baseline at zero width and zero changed area.
Native export retains its original annual mass unit. Export reduction is:

    baseline common-support export - case common-support export

A positive value means lower modeled export; a negative value means higher
modeled export. A zero baseline has no percentage reduction. Zero common valid
support yields null exports, reductions and marginals with
status=no_common_valid_support. It is not shown as a zero-load success.

For adjacent nested widths within a placement:

    marginal reduction per hectare =
        (new export reduction - previous export reduction)
        / (new changed hectares - previous changed hectares)

Equal extents have status=no_additional_changed_cells and a null marginal.
Average reduction per changed hectare and the incremental marginal are distinct
fields. Common valid cells, coverage and area accompany each physical value.

The area denominator is every changed hectare in the selected clipping scope.
For model_domain, that includes upstream treatment beyond the reporting
polygon; the measured response remains reporting-area export. Placement curves
are independent alternatives, and overlapping placements cannot be added to
produce a combined programme result.

Outputs include response.json, response-curves.csv, marginal-response.csv and
the complete original native analysis. The operator presents the same records
and downloads through its existing authorized Workspace file route.

## Retention and receiving

Preparation retains the complete request, implementation/source hashes,
scientific-library versions, original stream entry, clipping geometry, all
placement feature selections, derived mask sources, saved scenarios and exact
footprint IDs. Each completed case is immutable and reopened on interruption.
Completing a partially prepared study preserves its original creation time,
case identities, source collections, manifest and final study identity.

Run the full original receiving course on its actual retained Workspace.
Use explicit source/run/placement/width selections from that study. Prepare
the cases, inspect the actual footprint maps and changed areas, execute every
new effective case through the original queue, build the response, download and
open each response/source artifact, and reopen the saved study and independent
Workspace transfer. Compare reopened source IDs, cases, effective runs, physical
values and artifact bytes. Preserve the current operator, earlier runs and
their owners. Do not overwrite the current scientific source to make a new
case appear to match.

Use the existing equipped native/browser receiver. View the populated
Restoration extents desk at desktop and narrow width, operate selection,
preparation, task refresh, run continuation, report, downloads and reload.
Open the actual downloaded files and footprint maps. Source inspection is a
separate check from this receiving course.

## Interpretation and primary model documentation

These are conditional model scenarios using the selected land-cover
coefficients and native inputs. The unchanged NDR and SDR models supply the
responses; the buffer operation does not estimate pollutant benefits itself.
No fitted curve, inferred field observation, establishment-time trajectory or
new calibration is introduced.

- Native NDR 3.20.0 documentation:
  https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html
- Native SDR 3.20.0 documentation:
  https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html

The NDR model represents long-term nutrient transport using the selected
loading and retention inputs. SDR estimates the modeled sediment delivered
from the landscape under its selected inputs. Keep the native quantity,
time basis and original source limitations with the response.
