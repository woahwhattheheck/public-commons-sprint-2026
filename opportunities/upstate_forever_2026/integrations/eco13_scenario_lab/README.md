# Ecosystem Sciences — scenario workbench

Version 0.1.2 receives saved native experiments, keeps original scientific results and supporting files, adds explicit planning costs and objectives, and exports a complete edition that another operator can reopen. It composes with the original Upper Savannah application and the existing ECO13 workspace bridge.

## Scientific interpretation

**Needs expert review.** A qualified watershed modeler should review the selected data, grid resolution, model parameters, paired coverage and uncertainty for the study before the modeled quantities and planning comparisons inform real-world decisions. The workbench retains those source assumptions and original results for that review.

## Receive a saved native experiment

From the original application's root, use its installed Python and the existing package path:

```sh
PYTHONPATH=.:integrations/eco13_scenario_lab python -m eco_scenario_lab adopt-upstate ORIGINAL_WORKSPACE EXPERIMENT_ID NEW_COMPARISON --project-id PROJECT --setup-id EDITION --currency USD
PYTHONPATH=.:integrations/eco13_scenario_lab python -m eco_scenario_lab status NEW_COMPARISON
PYTHONPATH=.:integrations/eco13_scenario_lab python -m eco_scenario_lab compare NEW_COMPARISON --scenario-costs costs.json --objectives objectives.json
PYTHONPATH=.:integrations/eco13_scenario_lab python -m eco_scenario_lab export NEW_COMPARISON OUTSIDE.zip
PYTHONPATH=.:integrations/eco13_scenario_lab python -m eco_scenario_lab receive OUTSIDE.zip NEW_RECEIVED
PYTHONPATH=.:integrations/eco13_scenario_lab python -m eco_scenario_lab compare NEW_RECEIVED
```

The uppercase names are the operator's actual paths, project identifiers and complete original experiment ID. Costs are a JSON object mapping original alternative IDs to integer cents. Objectives are an explicit array of the received reporting-grid/metric pairs. Open the retained reports/index.html for the complete grayscale comparison, parameter sensitivity, original model states, cost groups and downloads.

Read [UPSTATE_RECEIVING.md](UPSTATE_RECEIVING.md) for the complete worked operator flow, original Workspace API, saved-selection format, planning edits, exports and independent reopening. Current native experiments use the original model.experiments paged inspection and paired summary. Original case/run identities, selected-model scope, grid-cell support, native units and percentages remain attached to the received results. Completed selected-model files from partial runs are retained along with their original states.

Report pages include the full retained population, use pagination for large experiments, and print every filtered outcome and unfinished-case row. Cost comparisons require explicit costs and compatible parameter/grid/support/reference groups. Saved costs, objectives and budget choices survive export and receive. Invalid replacement choices restore the prior complete report edition.

The first adoption uses the original application's native runtime. Receiving an exported edition, reopening its retained native summary and rendering its report use Python's standard library. The existing parcel-planning and native-table paths below continue to use their GIS dependencies. Existing workspace_driver.py and workspace_cli.py bridge operations remain available.

## Current Workspace bridge

[WORKSPACE.md](WORKSPACE.md) gives the complete current InVEST 3.20.0 NDR/SDR selection, accepted-run adoption and original Workspace execution commands:

```sh
PYTHONPATH=.:integrations/eco13_scenario_lab python -m eco_scenario_lab.workspace_cli --help
```

Use the current native experiment receiving workflow above for an existing experiment; use the Workspace bridge for explicit accepted baseline/alternative runs or original Workspace scenario selections. Both retain the original scientific registry and execution ownership. [RETENTION.md](RETENTION.md) describes independent copies, preserved original paths, shared legacy native objects and actual receiving counters.

## Plan parcel scenarios with the existing native driver

The planning/report environment needs Python 3.11+ with numpy, rasterio, Fiona, Shapely 2 and pyproj. The native scientific environment is separate and must contain the exact InVEST version in the plan. Reuse the existing Eco native environment; the package does not install or replace it.

```sh
# Use the retained source package with the existing GIS environment:
PYTHONPATH=.:integrations/eco13_scenario_lab python -m eco_scenario_lab --help

python -m eco_scenario_lab plan project.json /work/scenario-project
python -m eco_scenario_lab run /work/scenario-project --python /existing/native/venv/bin/python
python -m eco_scenario_lab status /work/scenario-project
python -m eco_scenario_lab compare /work/scenario-project --objectives objectives.json --budget-cents 2000000
python -m eco_scenario_lab export /work/scenario-project /deliveries/project.ecoscenarios.zip
python -m eco_scenario_lab receive /deliveries/project.ecoscenarios.zip /work/independent-project
python -m eco_scenario_lab revise /work/independent-project changes.json /work/revised-project
```

Open `reports/index.html` in a browser. It is an offline, industrial grayscale report with a scenario selector, complete watershed records, declared scenario costs, and CSV/JSON exports. The report identifies the actual execution engine. All original inputs, prepared LULC rasters, successful and failed run attempts, process logs, native outputs and reports are retained in workspace exports. Receiving is create-only and verifies every member before publishing the new directory.

`examples/project.template.json` is a field/argument template, **not an Upper Savannah dataset**. Replace its paths with the original setup's actual files, reuse the setup's calibrated/native parameters and biophysical tables, and select real parcel IDs and declared scenario costs. `examples/objectives.json` specifies the exact watershed/metric combinations to screen. Climate/parameter cases apply identically to baseline and every alternative.

## Scientific interpretation and native version bindings

NDR and SDR comparisons use complete native watershed output tables. Every complete intervention combination runs through the native model independently; this package never adds isolated parcel results to predict a combination. NDR scenario comparison is based on watershed export changes, not a claim that pixel export subtraction measures local retention. This follows the [official NDR scenario guidance](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/ndr.html).

Annual Water Yield results remain watershed-scale trade-offs. Neither higher yield nor lower yield is silently scored as an improvement. AWY pixel output is not presented as a scientifically resolved parcel result; see the [pinned 3.15 model source and output descriptions](https://github.com/natcap/invest/blob/3.15.0/src/natcap/invest/annual_water_yield.py).

Default bindings follow the inspected **3.15.0** source, not the latest documentation's file extensions:

| Model | Result dataset | Metric fields |
|---|---|---|
| NDR | `watershed_results_ndr.gpkg` | `n_total_export`, `p_surface_export` |
| SDR | `watershed_results_sdr.shp` | `sed_export` |
| AWY | `output/watershed_results_wyield.shp` | `wyield_vol`, `wyield_mn` |

Sources: [NDR](https://github.com/natcap/invest/blob/3.15.0/src/natcap/invest/ndr/ndr.py), [SDR](https://github.com/natcap/invest/blob/3.15.0/src/natcap/invest/sdr/sdr.py), [AWY](https://github.com/natcap/invest/blob/3.15.0/src/natcap/invest/annual_water_yield.py). The caller provides a stable watershed ID field (`ws_id` by default). `inspect` lists fields/layers for the original native output. Version 0.1.1 also verifies these bindings against 3.20.0; other native versions require explicit bindings. See EXPERIMENT_INTAKE.md for the exact source references.

Native SDR/AWY shapefile datasets are verified as complete families, including their DBF values. Comparison matches IDs and normalized geometry/CRS, not row order. Missing/nonfinite values fail the comparison instead of becoming zero. Zero baseline yields an undefined percentage, not division by zero. NDR nitrogen/phosphorus bindings follow the selected `calc_n`/`calc_p` switches.

## Decision support

Scenario costs are nonnegative integer minor currency units, explicitly supplied by the operator. The package does not invent a monetary valuation of modeled nutrients, sediment or water. Budget screening selects among whole, actually executed alternatives; it is not a knapsack model that assumes additive environmental effects.

Each objective specifies a watershed ID and a metric. This prevents accidental aggregation of overlapping/nested watersheds or summing depth averages. Pareto dominance compares cost plus every chosen objective in every matched case. Status quo is included as zero-cost baseline. Sensitivity ranges are reported as ranges across declared cases, not probabilistic confidence intervals.

## Integration with the existing app

The original async API/job service owns its normal scheduling and UI. Invoke the additive functions from that service:

```python
from pathlib import Path
from eco_scenario_lab.engine import freeze, run_workspace
from eco_scenario_lab.results import build_comparison, rank, render_report
from eco_scenario_lab.store import exclusive

freeze(Path("project.json"), Path("scenario-project"))
# Default execution uses the installed native InVEST process.
run_workspace(Path("scenario-project"), python="/existing/native/venv/bin/python")
with exclusive(Path("scenario-project")):
    data = build_comparison(Path("scenario-project"))
    screened = rank(data, [{"watershed_id": "1", "metric": "nitrogen_export"}], 2000000)
    render_report(Path("scenario-project"), data, screened)
```

To retain the existing application's native execution boundary instead, pass its adapter as `executor` and give `engine_identity` a stable version/content identifier. Callable signature:

```python
def executor(model: str, args: dict, expected_version: str,
             python: str, log_path: Path) -> dict:
    # Call the ORIGINAL app/native driver with these exact args. It writes its
    # complete original output family under args['workspace_dir'] and returns
    # its execution metadata. Append full output/error text to log_path.
    ...
```

The provided CLI has no fixture/surrogate execution switch. The native worker imports and calls only the actual InVEST module and first runs its original validator. It records the installed version, Python/GDAL/dependency versions and native module hashes. Runtime or scientific-input changes invalidate run keys. The native executor receives complete, frozen input paths; it never receives the sender's mutable originals.

Each job records project/setup, scenario/case/model, exact comparison key, execution engine, original log and every attempt. Restart skips verified complete jobs and retries failed/interrupted jobs in new attempt directories. A kernel write lock prevents overlapping writers and is released on process death. Jobs interrupted after a native subprocess succeeds but before the parent commits completion will rerun in a fresh attempt; the old complete files remain retained. There is no distributed shared-folder scheduling layer in this package.

## Sources and receiving

`acquire sources.json DIRECTORY` streams explicit public HTTPS source URLs with declared provider/license/vintage/units, optional expected SHA256 and a per-source size ceiling. It uses TLS verification, rejects credential-bearing URLs, verifies expected bytes and writes atomically. This is the receiving stage after the existing source resolver chooses the actual files; it does not substitute arbitrary national data products or scientific coefficients for the original project inputs.

```json
{"sources": [{"id": "retained-dem", "url": "https://provider.example/actual-selected-dem.tif", "filename": "dem.tif", "provider": "actual provider", "license": "actual license", "units": "m", "vintage": "actual source edition", "sha256": "actual 64-character SHA256"}]}
```

## Completed Linux exercise

`python exercise.py /new/exercise-directory` creates an explicitly authored geospatial **software fixture**. It exercises a 2048×2048 grid, 256 actual polygon features, three alternatives plus baseline, two matched cases, three model-shaped result carriers, 24 retained jobs, one injected failure/recovery, cached reopening, 80 paired metric rows, DBF-only mutation rejection, a 179-file verified export/receive and an independent edited revision. The fixture executor is deliberately labeled `SOFTWARE-FIXTURE-NOT-INVEST`; it does not implement hydrologic science or represent Upper Savannah inputs. This single workflow checks orchestration/geometry/data-handling behavior rather than multiplying small test files.

The development container had Python 3.13, rasterio/Fiona/Shapely and Chromium. Its native preflight recorded a missing `osgeo` dependency; native InVEST execution needs the existing Eco native host. The integration thread contains the request for that native run and the original public-input carrier. `exercise-summary.json` records the local software exercise separately from native scientific results.

## 0.1.1 — original experiment receiving

`EXPERIMENT_INTAKE.md` describes the read-only adapter for the original
NativeJobsEngine inspection and existing native result records. It receives
complete selected runs, input files, logs and original job IDs into this reporting
layer without launching another queue. Verified default output bindings now
include InVEST 3.20.0. The native source fingerprint follows the actual execute
function in the 3.20 AWY package. Full workspace export retains hidden original
run files, excluding only its own root writer lock.
