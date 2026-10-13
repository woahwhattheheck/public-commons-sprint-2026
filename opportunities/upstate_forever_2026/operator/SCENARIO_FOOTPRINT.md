# Native scenario footprint

This component makes the actual land-cover scenario inspectable before its selected
native models start. It also corrects the shared patch-area accounting.

The original categorical algorithm already applies patches in their declared
order. The integrated kernel preserves both retained polygon masks and the current
application's aligned binary-raster masks. Its former `changed_cells` counted all eligible assignments, including a
cell already equal to the target. Summing patch counts also counted a repeatedly
edited cell more than once. The replacement kernel preserves the same ordered
values while reporting immediate changes and the final difference separately.

## Operator journey

1. Prepare a retained native run in the existing workbench. The added
   `Workspace.prepare_run` check requires a coefficient row for every declared
   target code, alongside the existing baseline class coverage check. The prepare
   form shows any existing input preview for that exact grid, profile, scenario
   and selected-model combination.
2. Open the prepared run and choose **Build input preview**. This queues the
   existing `scenario.footprint.preview` action for the retained run identity.
   Preparing the preview does not start NDR or SDR.
3. Review **Scenario inputs on the selected native grid** in the ordinary run
   detail. It shows unique eligible cells and final changed cells with their
   hectares, the original patch notes, preview creation time and compiler
   version. **Open footprint, masks and coefficients** opens the original desk
   for this exact run. Its direct standalone route remains
   `/web/scenario-footprint.html?run=FULL_RUN_ID`.
4. In the footprint desk, review individual patch eligibility, changes, overlaps
   and reversions, the complete final class histogram and the exact coefficient
   rows copied from the retained CSV. Download the native scenario GeoTIFF,
   binary final change mask, full JSON, final/patch transition CSVs, class
   histogram and coefficient rows.
5. Choose **Run original models** or **Resume original models** in the ordinary
   run detail, or **Start selected native models** in the footprint desk.
   The original queue, NDR/SDR execution, selected models, stage recovery and
   outputs remain the existing run's pathway. The run list's review action opens
   the retained selection before starting or continuing it.

A preview for an unchanged baseline or a scenario whose final values equal the
baseline is an ordinary completed result. It retains the zero-change mask and
all class/coverage accounting. A missing preview, or an older report without
complete counts, is shown as unavailable rather than zero. The operator can
start a valid native selection after reviewing either condition.

The scenario detail lists its retained run selections and their grid-specific
input previews. Preparing another run from this detail keeps the scenario
selection. Comparison details show each retained run's eligible and final changed
area relative to its own source land-cover grid. These areas are not a pairwise
difference between two edited scenarios and are not a hydrological benefit
estimate; the native annual export differences remain separate.

The summary reads already retained records during ordinary workspace refresh.
Building a preview evaluates the run's retained selection with the current
footprint compiler. Its compiler version, compiler hash and input identities are
retained in the report. An older completed native run keeps its own original
executed artifacts; rebuilding its input preview does not replace or certify
those artifacts as products of the current compiler.

Changing the selected run or workspace clears the previous report and native
start action. Late catalogue, report, task and resume replies cannot replace a
newer selection. The desk reads the selected run's actual retained state before
offering Start, including when that run is outside the current catalogue page.

## Source and model meaning

The selected profile is an immutable reference to its original biophysical CSV.
The preview copies original row values, including `load_type_n`,
`load_type_p`, retention efficiency, critical length, subsurface proportion,
and USLE C/P columns when present. It supports the current selected-model core's
actual table shape. Declared targets are listed even when they have no final
cells, so an unused or later-replaced target stays visible.

The published InVEST 3.20.0 NDR guide requires each resulting land-cover class to
have its own table row. It also specifies distinct classes for different nutrient
applications, and distinguishes application-rate from measured-runoff loading.
The SDR guide maps class rows to USLE cover-management and support-practice
factors. This component preserves those native coefficient semantics. The
existing experiment/profile expansion remains the producer of revised profiles.

Primary documentation:

- https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html
- https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html

## Counts

| Field | Meaning |
| --- | --- |
| eligible_cells | Valid cell centre inside a patch whose current value matches its from_codes. |
| already_destination_cells | Eligible assignments whose current value already equals the target. |
| changed_cells | Eligible assignments that actually change the value at that patch. |
| overlap_with_earlier_masks_cells | Valid cells in this polygon also covered by an earlier patch polygon. |
| changed_earlier_cells | Eligible cells that were changed at least once by an earlier patch. |
| cascaded_change_cells | Changed cells whose value at this patch differs from the original baseline. |
| reverted_to_baseline_cells, per patch | Actual changes at this patch whose target restores the original baseline value. |
| final_owned_cells | Final net-changed cells whose last value-changing patch is this patch. |
| net_changed_cells | Valid cells whose final value differs from the original baseline after all patches. |
| reverted_to_baseline_cells, summary | Cells changed at least once whose final value equals the baseline. |

Each patch's transitions include its eligible same-code assignments on the
diagonal. Final transitions include the full observed baseline-to-final mapping,
including unchanged diagonals. Final-owned counts partition the final net
footprint; their sum equals net_changed_cells. Immediate patch counts can be
larger because they describe sequential operations.

The kernel reads the actual single-band integer baseline, checks its CRS, affine
transform, dimensions and pixel area against the retained native grid, and uses
pixel-centre polygon membership. Native gzip vector sources use the application's
existing `native_vector_path` and `vector_environment`. Original NoData is
preserved throughout. Hectares derive from the actual affine determinant in a
projected metre CRS. The grayscale PNG uses maximum aggregation for display;
its pixel size does not enter the native area totals.

## Installation

Receive all twelve component files relative to the maintained application root,
or keep the complete component in a separate received directory:

```bash
python operator/install_scenario_footprint.py --application CURRENT_APPLICATION_ROOT --source RECEIVED_COMPONENT_ROOT
```

The installer records known released and installed component hashes, retains every changed predecessor, and writes its installation intent before feature files. An interrupted upgrade accepts its recorded predecessor or candidate bytes and resumes; unrelated source changes remain available for deliberate integration. The final current.json records installed ownership.

The installer checks the exact original make_scenario body before replacing that
one entrypoint. It inserts the target-row check immediately after prepare_run
loads its actual retained profile/scenario. It preserves surrounding selected-model
and stage-cache code, saves real predecessor source files, parses all Python
postimages, and checks concurrent file changes before replacement.

When the current source already has a separate revised categorical kernel,
compose that source with `model.scenario_footprint.make_scenario` directly. The
two original seams are:

```python
# rasters.make_scenario: same original public signature and list-of-patch-stats return
from .scenario_footprint import make_scenario as apply_footprint
return apply_footprint(baseline, destination, grid, patches,
                      source_loader=source_loader, allowed_codes=allowed_codes)

# Workspace.prepare_run, after retained profile and scenario are loaded
from .scenario_footprint import validate_destination_codes
validate_destination_codes(profile, scenario)
```

The standalone native entrypoint is:

```bash
python -m model.scenario_footprint --workspace ORIGINAL_WORKSPACE --run-id ORIGINAL_RUN_ID
```

## Operator composition

`operator/scenario_footprint.py` exposes the following exact public methods for
the shared extension registry:

- `dispatch(workspace, action, payload)`
- `catalog(operator, workspace_key, offset=0, limit=100)`
- `report(operator, workspace_key, report_id)`
- `install(namespace)`, an additive original-server adapter

Registered action: `scenario.footprint.preview`; payload: `{"run_id":"..."}`.
GET catalogue: `/api/scenario-footprints/catalog`.
GET retained report with authenticated file tickets:
`/api/scenario-footprints/report?id=...`.
The native `run.start` action is supplied by the existing operator.

The registered provider's `state_snapshot(operator, workspace_key)` returns
`data.scenario_footprints.records` through the original state extension binding.
Each compact row preserves its report/run identity, full selected inputs, actual
summary, original notes and compiler provenance. This projection reads saved
records only. The ordinary maintained `app.mjs` imports
`scenario_input_review.mjs`; the component's asset inventory also carries that
module for receiving. The standalone component installer retains the original
desk and shared-host detection without replacing an independently edited
ordinary application controller.

The additive adapter chains the original dispatch and GET handlers and keeps
the original authorization, per-workspace queue and download verification. A
registry receiver can call the same public methods without using the standalone
launcher. `--model-only` installs the two model seams when that receiver has
already registered the complete provider/browser component.

## Retention and receiving

The request identity includes the original run selection, baseline hash,
original mask bodies and companions, coefficient body, compiler version and
actual compiler file hash. `scenario-footprint-output/` contains the raster,
CSV, JSON and PNG outputs. `scenario-footprints/` contains immutable Workspace
records. A finished identical request verifies the files and reopens the same
record with the original timestamps and hashes.

Work is staged in the archive-excluded source-views area and published as a
complete directory. The builder holds the existing workspace lock during publication;
the original backup can therefore collect a stable completed result. An interrupted
attempt's own staging area is removed on its next retry. A process interruption before publication leaves the
original input and native run intact. A retry rebuilds that input preview; it
does not start the native model. Complete Workspace backup includes these
additive records and outputs through the original archive mechanism.

## One native ordered-patch reference case

The original polygon reference exercise uses a declared 32 by 32, 30 m reference array and two actual retained polygon masks. It drives the installed Workspace source/scenario path, applies five ordered patches through both the shared kernel and the original native entrypoint, and checks the resulting rasters and accounting. The case includes partial overlap, a whole same-code patch, a later cascade and a return to baseline. Its 1,789 immediate change assignments leave exactly 256 net changed cells (23.04 ha); 511 previously changed cells return to baseline. An untouched raw class also preserves the low-level raster function's original destination-only table contract, while native prepare/preview enforce complete coefficient coverage.

Run with the actual installed GIS interpreter after installing the component:

```bash
python source/scenario-footprint/reference_ordered_patches.py --application CURRENT_APPLICATION_ROOT --output NEW_REFERENCE_DIRECTORY
```

The output records the actual interpreter, GIS versions, retained scenario and source IDs, and complete pixel statistics. These declared reference inputs exercise categorical implementation behavior.

## Current shared extension host

The complete component includes operator/extensions/scenario-footprint.json, bound to the current ECSA registry (registry source SHA256 5cef14d2318e593ab9480f8bb9a784ab251e7506864882d91d04901c4070054b). The provider uses the actual original task context, authenticated GET payloads and original verified download tickets. Completed footprint files also appear on their queue task, and the receiving hook verifies retained footprint members before workspace registration.

The exported createScenarioFootprint(host) factory mounts the same installed panel inside a ShadowRoot, using host.api and host.getWorkspace. Its stylesheet and IDs stay inside that view. The host's update lifecycle drives active task reconciliation; embedded mode has no second state polling loop. Forms retain their run selection, operation identity and task ID across navigation. Rapid catalogue/report reads ignore superseded responses. To carry a prepared native selection from another registered desk:

```javascript
await extensions.openExtension('scenario-footprint', 'openRun', preparedRun.id);
```

The installer detects the actual ExtensionRegistry server joins, installs the descriptor and removes only this component's exact previous launcher and navigation script tag. Run the component installer after the shared-host installer when migrating a previously standalone application. The legacy provider also defers when ExtensionRegistry is present. An application with the original operator continues to use the standalone route; the scientific kernel and original queue action are identical in both modes.

## Aligned raster masks in the integrated application

Version 1.1.0 composes the current native binary-mask pathway with the same footprint
accounting used for polygon patches. A raster mask must have one numeric band and
exactly the retained model grid's width, height, affine transform and CRS. Valid
mask values must be zero or one. Only valid values equal to one select a cell;
mask NoData and zero exclude it. The original baseline's invalid cells remain
invalid. A raster patch cannot specify vector-only layer or where selectors.

Polygon and raster patches may appear in the same ordered scenario. Every
from_codes predicate reads the values left by earlier patches, with unchanged
eligible, immediate-change, overlap, cascade, reversal and final-owner accounting.
A raster source is opened once per operation and read once per native block even
when multiple patches refer to it. The report retains mask_kind and mask_band;
polygon-only feature counts and polygon area are null for raster masks.

The installer accepts both the published polygon-only native predecessor and the
exact current binary-mask predecessor. It preserves independent changes outside
the make_scenario function and adds target-table validation immediately after the
current Workspace loads the retained scenario and profile. Current ECSA operators
register the supplied descriptor without a second launcher.

Run the original ordered polygon reference and the additional mixed-mask reference
against the installed application:

```sh
python source/scenario-footprint/reference_ordered_patches.py --application . --output /path/to/new-polygon-reference
python source/scenario-footprint/reference_binary_masks.py --application . --output /path/to/new-mixed-reference
```

The mixed reference uses the same declared 32-by-32, 30-metre EPSG:5070 array with a
polygon left half and a floating-point binary-raster top half. One mask NoData cell
retains its earlier left-half edit, leaving exactly 257 final changed cells
(23.13 hectares), including the 256 bottom-left cells. It checks the installed
native entrypoint and preview output, original NoData, valid zero, same-code writes,
ordered reversals, nonbinary-value rejection and shifted-grid rejection. These are
implementation references for the exact categorical algorithm.
