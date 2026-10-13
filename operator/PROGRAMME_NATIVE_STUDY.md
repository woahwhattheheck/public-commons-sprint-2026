# Native-study export from the maintained Programme

Version 1.0.2. Compose these ordered edits into the installed application after the maintained Programme and the programme-interactions components. The two full shared-file bodies in this bank are review postimages; the installer preserves other authors' changes using 14 exact local seams.

    python -B operator/install_programme_study.py --application ACTUAL_APPLICATION --source RECEIVED_COMPONENT

Run the same installer again to reconcile an interrupted installation. All source seams are checked before writing; changed original files are retained by their SHA-256 and each replacement preserves its original file permission mode. The installation keeps the existing Programme run scheduler, pause/recovery state, interaction allocations and native model execution unchanged.

## Operator workflow

Open a Programme with the completed original-land-cover baseline and at least one completed land-cover alternative. Choose **Export native study**. Select the baseline, completed same-profile alternatives, study title, purpose/input assumptions and optional reference/contact. Review the original selections, then build the maps and report through the existing queued `compute.programme.delivery` action.

The Programme shows saved delivery editions and links directly to their original maps/report. The completed task also links to the same delivery. A teaching case retains its SIMULATED label in the title, purpose and source records.

The native-study edition uses the maintained `model.native_study.prepare` and `Workspace.build_delivery` path. It includes five required map families: current nutrient export, current sediment export, combined relative export priority, future nutrient runoff change and future sediment loss change. Optional original source overlays remain explicitly selectable through the existing delivery selection API. Regional RFP deliveries retain their complete source-role, regulatory overlay and contact requirements.

## Existing native receiver API

For an existing Programme `programme_id`, use its actual named run keys:

```python
from model.compute_programme import ComputeProgrammes
manager = ComputeProgrammes(workspace)
selection = {
    "delivery_mode": "native_study",
    "native_study": {
        "title": "SIMULATED headwater teaching study",
        "purpose": "Teach source import, native NDR/SDR, an explicit conservation case, maps, report and portable reopen using the retained simulated inputs.",
        "reference": "UPSTATE-DEMO-SIMULATED-INPUTS-20261013T140000Z",
    },
    "baseline_run": baseline_key,
    "scenario_runs": [conservation_key],
}
preview = manager.delivery_preview(programme_id, selection)
result = manager.prepare_delivery(programme_id, selection)
```

The baseline and every alternative must contain both completed NDR and SDR, share the retained grid, and use the same parameter profile. Each future case must be an explicit land-cover scenario. All supplied source and overlay IDs are still resolved against their original collection; selected model inputs cannot be replaced during delivery.

Create the Programme after the final application is installed: its source identity includes the actual execution/Programme code. Existing matching completed native run IDs are reused; creating a Programme is not a request to recalculate them.

## Units and geographic support

The native wrapper converts NDR/SDR rate rasters once using the original projected-cell area. For the accepted 120 × 120, 30 m teaching grid, each full cell covers 0.09 ha and its square domain covers 1,296 ha (12.96 km²). The generator owner's revised perpendicular-distance corridor selects 635 agricultural cells (236 pasture and 399 crop), or 57.15 ha; this supersedes its initial 582-cell corridor before native execution. Final run/report areas come from the actual retained affine and valid masks.

Programme input rasters are already annual mass per pixel: nitrogen and phosphorus in kg/pixel/year, sediment in metric_tonnes/pixel/year. The Programme sums those values directly. It reports whole-run totals and signed alternative-minus-baseline changes on common valid cells separately. It only reports percent change against whole-baseline mass when both output supports match the comparison support.

The simulated headwater case and the original Eighteenmile point-source study remain distinct source-bound studies. The point-source context desk reopens its real discharge calendar and gauge relationships. Do not attach those outfalls to a different simulated catchment or add their loads to native landscape export quantities. A source-context link must match the selected analysis region, retained gauge geometry and original routing cohort.

## Source edition and review

Reviewed against both original base `b39554bf4ead42d1fb42af7c21a9e241f384fd41` and current main `bfa5454d292c774502b2ef6d9306206ce4bf8d91`. The exact shared seams preserve current Programme interaction, supervisor and receiving-context changes. The original Programme preview required regional data even when `delivery_mode=native_study`; this joins its existing native-study exporter to the Programme and adds the missing operator entry point.

Browser JavaScript grammar was checked in the available V8 runtime. Native installation/execution follows the existing single application receiving operation.
