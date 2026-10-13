# Upper Savannah Scientific Workbench

The workbench joins original source intake, projected model grids, native InVEST calculations, scenario experiments, spatial review, and GIS delivery in one retained scientific workspace. The browser and command-line tools share the same source objects, saved selections, native outputs, and task state.

This directory is the application source. Keep project workspaces in separate directories so an application update can reopen the existing study.

## Start the application

Use an existing Linux GIS environment with InVEST 3.20.0, or create the environment described by the included file:

```sh
conda env create -f environment.yml
conda activate upper-savannah
python -B -m model.cli runtime
```

The runtime command reads the actual installed version and verifies the selected NDR and SDR module sources. The environment definition pins InVEST and Python; the package manager resolves their compatible GIS dependencies. The [InVEST installation guide](https://invest.readthedocs.io/en/3.20.0/installing.html) recommends conda-forge for this installation path.

The environment also installs the maintained Investigations dependencies (`fastapi>=0.115`, `pydantic>=2.8`, and `httpx>=0.27`). Pydantic 2 supplies the validators used by the original InVEST and investigation schemas. These are application dependencies even when no remote AI provider is configured.

Decision studies use the maintained `robust-workbench` registration. The superseded `robust-decisions` registration is retained as `operator/extensions/robust-decisions.json.retired-ECO13-RELEASE-20261013`; keep that exact source record outside the active `*.json` registration inventory so each original `robust.*` action has one owner.

The environment requests `matplotlib-base` for the workbench's static map renderer. The maintained cartography module uses `Agg` / `FigureCanvasAgg` and writes PNG, SVG and PDF files; the browser operator serves those outputs through its existing local server. This keeps the plotting library and its required dependencies without adding the Qt/PySide6 desktop backend solely through the `matplotlib` metapackage. [Matplotlib's dependency guide](https://matplotlib.org/stable/install/dependencies.html) and the [conda-forge packaging guidance](https://conda-forge.org/docs/maintainer/knowledge_base/#matplotlib) document this package split. InVEST remains pinned to 3.20.0, Python remains pinned to 3.12, and all other declared scientific and GIS dependencies remain the same.

From this application directory, create a study and open the operator:

```sh
python -B operator/server.py \
  --workspace /owned/upper-savannah-study \
  --operator-state /owned/upper-savannah-operator \
  --create --title 'Upper Savannah source study' \
  --source-manifest source/biophysical-regional-20261012/source-manifest.json \
  --source-root /owned/original-inputs
```

Choose directories owned by the receiving user. Open the complete loopback URL printed by the server in that user's browser. The URL carries the local session capability. Keep the same operator-state directory when reopening ongoing tasks.

To reopen an existing study, run the same command with its existing workspace and omit `--create`. Original data files may be registered through the source desk or an explicitly selected source manifest.

## Work through a study

| Workbench area | Purpose |
| --- | --- |
| Original sources and source preparation | Receive original editions, inspect their native metadata, retain sidecars and source lineage, and prepare terrain, rainfall, soil and land-cover inputs. |
| Model grids | Bind the reporting polygon, upstream model domain, selected native models and original raster inputs to one projected grid. |
| Parameter profiles and land-cover scenarios | Save explicit scientific coefficients and categorical edits with their original references. |
| Native model runs and native run desk | Prepare or inspect individual calculations, completed stages, current logs and original output files. |
| Scenario experiments | Design parameter and land-cover cases with an explicit reference and the appropriate paired baselines. |
| Source-water areas | Inspect original upstream watershed membership, prepare original polygon areas, save ordered land-cover alternatives and assemble their matching-profile native programmes. |
| Run programmes | Materialize an existing design or group prepared cases, execute the selected runs, pause between calculations, resume retained stages, and build the result catalogue. |
| Spatial, community, observation and review screens | Examine geography, source coverage, actual outputs, observation periods and review requirements in the same workspace. |
| Complete map delivery | Build the selected seven-map release, GIS layers, reports and portable working archive from completed native runs. |

The extension catalogue at the authenticated `/api/extensions` route reports each installed desk and any concrete source dependency that needs attention. The source preparation and native run desks use this shared registry.

## Source-water interventions and paired calculations

Open **Source-water areas** to receive the original watershed network, inspect its named upstream memberships and save the intended receiving areas. **Prepare scenario areas** retains their original polygon bodies in the Workspace. Save explicit land-cover changes on those areas, including their source/destination classes, rationale and patch order.

Choose **Prepare paired programme** from the prepared-area product. Select its actual original grid, the original land-cover baseline, retained parameter profiles, intended alternatives and NDR/SDR scope. Review the full run list; every profile receives its own matching baseline. Open the saved native programme to run, pause or continue those exact cases using the maintained execution service.

After the programme finishes, return to its source-water plan, refresh calculation status and build the receiving-area comparisons. Existing reports retain matching-profile baselines, common valid support and original physical quantities. Saved source, scenario, programme and report selections travel with the complete working archive. See `model/RECEPTOR_PROGRAMMES.md` and `operator/RECEPTORS_OPERATOR.md` for the full browser and CLI journey.

## Select the scientific scope

A profile, grid and run may select NDR, SDR, or both models. NDR uses terrain, land cover and runoff proxy inputs. SDR uses terrain, land cover, rainfall erosivity and soil erodibility. The profile's original table and coefficients must support its selected models.

The default Upper Savannah grid retains nominal 30-metre land-cover cells. A different original study may explicitly select its own positive `resolution_m` in the grid specification. The reference must match that projected, square, metre-based native resolution. Source geometry, actual transforms and cell areas travel with the resulting grid.

Completed runs on the same grid can compare their shared native outputs. The full seven-map release selects completed NDR and SDR outputs. See `model/SELECTED_MODEL_OPERATIONS.md` and `model/GRID.md` for the exact contracts.

## Execute and recover a programme

Open **Run programmes**, then create a selection, import prepared selections, or choose **Use saved experiment**. Save the complete named case list and choose **Continue unfinished runs**.

The programme keeps each exact native run ID. A pause request takes effect between native runs; the current calculation reaches its checkpoint first. Reopening and continuing the programme preserves its saved cases and verifies the outputs available for reuse. Individual failures retain their error and log for correction.

The result catalogue presents actual output units, supported area and valid coverage. Pairwise changes use the shared valid support recorded by the native comparison. Experiment cases retain their own parameter-matched baseline as well as the programme's overall reference.

See `PROGRAMMES.md` for the API, command-line service and integration points.

## Receive the original Gura example

`source_tools/receive_gura.py` prepares a separately named Gura workspace from the official sample raster archives and current biophysical CSV files referenced by the tagged InVEST 3.20.0 datastacks.

```sh
python -B -m source_tools.receive_gura --help
```

Supply the original NDR and SDR archive files, the separate original NDR and SDR CSV files, their source references, a receiving source directory and a workspace directory. The receiver reads and preserves the native cell size of the selected original raster. The pinned official InVEST 3.20.0 archives use 15-metre cells covering 0.0225 hectare each. A separately retained 300-metre case keeps its own grid and 9-hectare cells. The upstream buffer is an independent model-context distance; new intake uses zero added context, while continuation retains the saved selection. An explicit `--expected-resolution-m` asserts the source resolution without requesting resampling.

The returned programme ID is ready for the same native execution, resumption, reporting, browser review and backup workflow used by the regional application.

## Preserve and reopen the working study

Use the ordinary workspace archive commands:

```sh
python -B -m model.cli --workspace /owned/upper-savannah-study \
  backup /owned/upper-savannah-study.zip
python -B -m model.cli --help
```

The operator also offers the retained backup and restore workflow. It includes the project identity, original source objects and companions, grids, profiles, scenarios, native stages, programmes, experiments and generated deliverables. Restore into a separate destination and reopen the existing study identity.

Application installers are provided for composition into an existing workbench. This checkout already contains the programme, experiment and extension registrations. When installing an updated component, use its current installer against the actual application, then restart the operator with its existing workspace and operator state.

## Operating and method guides

- `operator/README.md`: browser entrypoint, retained tasks, downloads, backup and restore.
- `PROGRAMMES.md`: named native calculations, saved-experiment handoff, recovery and result catalogues.
- `operator/EXPERIMENTS.md`: experiment design, cases and paired scientific metrics.
- `operator/EXTENSIONS.md`: installed source and native run desks.
- `model/README.md`, `model/GRID.md` and `model/SELECTED_MODEL_OPERATIONS.md`: original sources, grid alignment, selected models and units.
- `operator/OBSERVATIONS.md`: measured loads, matching periods and catchment coverage.
- `model/NATIVE_RECEIVING.md` and `operator/RECEIVING.md`: source-to-model and browser receiving.
- `RFP_RESPONSE_MAP.md`: engineering coverage of the published project requirements.

## Paired scenario ensembles

Open **Paired multi-pollutant ensembles** after the selected baseline and alternative runs finish. Choose the original grid, matching scenario pair and completed parameter profiles; select the physical outputs, retained-cell support rule and requested quantiles. Preview the complete selection, build it through the existing operation queue, and use **Pause** or **Resume** to continue the same retained raster calculation. Results include numerical rasters, HTML/PDF reports, source bindings and a portable archive that can be received into another workspace.

The paired ensemble modules live under `model/paired_ensemble/`. Other ensemble modules supplied by separate scientific workflows keep their original module names.
