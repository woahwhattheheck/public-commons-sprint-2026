# Future disturbance and land protection

Version 1.0.0 · TokenJunkieLabs · Ecosystem Sciences application

## Use the native workbench

Open the original operator and choose **Future disturbance**. Existing studies show their completed native cases and complete result downloads. **New editable study** accepts the scientist's description, eligible original land-cover classes, destination classes, requested cell counts, buffer metres and completed baseline profiles. Inputs are ordinary labeled form fields. Select original baselines on the same grid; the first selected baseline owns the fixed stream geometry. A revised design preserves that original baseline order.

**Save source masks and native cases** retains the exact binary masks, scientific selection and original Workspace scenarios. **Queue unfinished native runs and report** submits the original `run.start` actions followed by `disturbance.report` in the existing serial queue. Tasks shows progress and native errors; rerunning this command reuses completed records and the exact operation identity for each unfinished run. Use the original Tasks retry/resume controls after an execution error, then refresh the saved study. The previous completed scientific editions remain available during execution.

The complete **Review Package** contains `index.html`, CSV/JSON results, exact original delivered-mass GeoTIFFs, double-precision change GeoTIFFs, source masks and coefficients. Extract it before opening `index.html`. The HTML has no external application assets. It supports profile, destination, dose, quantity and policy comparison; original-grid cell selection; exact geospatial downloads; a scientific note; review JSON export/import; and saved annotated HTML. Keep annotated HTML beside the retained maps and tables. The note and selection are source-bound to the exact study. JSON remains optional interchange rather than the ordinary working surface.

## Scientific selection

This course compares three policies on a fixed original raster:

* **Unrestricted conversion:** select eligible non-stream cells nearest the first baseline's original native NDR stream, with row-major ties.
* **Retain stream buffer:** start from that unrestricted selection and forgo conversion at cell-centre distances within the selected buffer.
* **Relocate outside buffer:** select the same requested cell count outside the buffer. This preserves conversion area rather than confusing less conversion with a placement effect.

The grid must be an unrotated projected metre grid. Distances are between raster cell centres; the buffer is not a surveyed bank setback or a statutory protection boundary. All destination classes must have coefficients in every selected original profile. The model changes land cover through the original `Workspace.save_scenario` and `prepare_run` mechanisms. Native model inputs, forcing and scientific versions remain those of each selected profile/grid. A zero-change policy reuses its exact baseline. New changed inputs receive original new scenario/run identities.

Interpret effects as the combined consequence of that explicit land-cover transition: source coefficients, retention, erosion cover and other destination-class factors can change together. Equal area and original class do not imply matched slope, soil, runoff or connectivity. The report therefore describes a spatial policy comparison, not an isolated causal effect of distance or a calibrated prediction. Use separately sourced baselines and the same interface for real geographic projects; the delivered worked example remains explicitly simulated.

## Physical quantities and support

All selected baselines/alternatives and all three quantities are intersected on their original finite valid raster cells. Each reported annual quantity uses that same joint support. Change is **alternative minus its profile-matched baseline**; avoided export is **unrestricted minus the selected protection policy at the same requested dose**. Negative changes remain signed rather than being silently truncated.

The original Workspace exporter converts InVEST 3.20 nutrient kg/ha/year and sediment metric tonnes/ha/year to delivered pixel mass by multiplying once by projected pixel hectares. This extension consumes those mass rasters, sums in float64 and never applies area a second time. Difference GeoTIFFs retain the source lattice, CRS, baseline/alternative identities, direction and units. The result CSV retains actual converted and foregone hectares separately from common reporting support.

Model sources and equations: [NDR 3.20 guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html) and [SDR 3.20 guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html). Parameter tables and original profile settings are retained in the result and editable source project. These annual hillslope-to-stream outputs are distinct from intake concentration, organism measurements and receiving-water transformations.

## Delivered worked course

The original 1,296 ha simulated Piedmont headwaters project uses a 120 × 120 grid of 30 m cells. Original project `1b6a344c-df5a-4986-a5e4-47a2d158324b`; new study `6ac68e36b63e918c60f9f0bdd025c33882d6a8ed890ba349472a2f9f8cd083fc`.

Forest class 41 is converted to pasture/hay 81 or cultivated crops 82 at 250, 750 and 1,500 cells (22.5, 67.5 and 135 ha). The fixed 90 m stream buffer contains 415 eligible forest cells (37.35 ha). Four original profiles are retained: MFD/D8 routing crossed with SDR maximum slope length 122/333 m, at original NDR k = 2. This produces 72 case/profile combinations, 68 unique selected native runs, including four original baselines, and **64 new completed native NDR/SDR runs**. The original eighteen completed run records remain intact; the supplied Workspace contains 82 complete runs.

Every one of the 216 result rows uses 13,976 jointly valid cells (1,257.84 ha). For the original MFD / Lmax 122 / k 2 profile and 67.5 ha requested crop conversion:

| Policy | Converted ha | Added N kg/year | Added P kg/year | Added sediment tonnes/year |
|---|---:|---:|---:|---:|
| Unrestricted | 67.50 | 797.8764195796102 | 65.47584934474435 | 88.45586309679493 |
| Retain buffer | 30.15 | 76.8209215439856 | 6.416981784219388 | 29.196474661279353 |
| Relocate outside buffer | 67.50 | 187.57227106392384 | 15.633556328946725 | 75.12846868480847 |

These are actual native results for the explicit simulated inputs. The complete result table includes the other routing/slope-length profiles and conversion doses; a single selected comparison is not the entire sensitivity result.

## Developer and assembly integration

Retain the whole `disturbance-studies` component fragment and its nine source members. The original operator discovers `operator/extensions/disturbance-studies.json`; it supplies the new sidebar view without replacing shared `app.mjs`, the worker, scientific runner or any existing report engine. Model modules are `model/disturbance_studies.py`, `model/disturbance_report.py` and its HTML template. Backend and client are `operator/disturbance_studies.py` and `operator/web/disturbance_studies.mjs/.css`.

The original Workspace portable backup retains this complete source, new `disturbance-studies/` state, original source collections, scenarios, profiles and native runs. Restore with the maintained `model.portable.restore`; open with the original operator/maintained recipient launcher. The InVEST invocation environment is prepared through `source_tools/native_runtime/invocation.py`, documented in `source_tools/NATIVE_INVOCATION.md`. Use the supplied original Linux runtime or the exact supported scientific environment; do not change the InVEST version when reopening an existing study.

CLI preparation and report creation, from the application root using its compatible GIS Python:

```sh
python -B -m model.disturbance_studies --workspace ../workspace prepare selection.json
python -B -m model.disturbance_studies --workspace ../workspace report STUDY_ID
```

This CLI does not execute native models. The ordinary operator submits and supervises those runs. Original identities and schema checks reject changed source selections. Preparation/report locks are local to the new study and never turn into access restrictions on other owners' work.
