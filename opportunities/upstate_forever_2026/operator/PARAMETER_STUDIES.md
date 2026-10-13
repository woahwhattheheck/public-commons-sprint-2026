# Parameter studies in the scientific workbench

The **Parameter studies** workspace view connects explicit parameter experiments to the existing native-run queue. Start the existing operator and open the retained workspace. The same sources, grids, coefficient profiles, land-cover scenarios, run identifiers and downloads are used throughout.

## Design a study

Prepare a native baseline run, then choose **Parameter studies → New parameter study**. Give the study a title and the scientific question it should answer. Select its baseline run. A study retains that run's model selection: NDR, SDR, or both. The baseline picker, saved study and exported report show the selected models. The parameter catalog includes only their native parameters, and every case keeps the same model scope and original scientific grid. A run can use a coefficient profile containing additional native models; case selection and profile reuse compare only the models actually selected for the study, while retaining the original coefficient table.

Choose **One parameter axis at a time** to isolate individual parameter-axis responses. Choose **Every combination of axis values** to execute the Cartesian design. A coupled axis applies the same explicit value to each selected native parameter; it is useful for shared NDR/SDR routing choices that must change together when both models are selected. Each axis must belong to an active baseline model; cross-model axes require a baseline that selects both models.

For each axis, select the native parameters, enter the exact values, explain the scientific rationale, and retain supporting references. Enter one numeric value per line, or use the native flow-direction choices `mfd` and `d8`. The parameter catalog shows the actual baseline value, units, and allowed range from the model contract. An omitted optional baseline parameter is identified as using the engine default; no numeric replacement is invented. SDR `l_max` is the dimensionless maximum RUSLE L-factor, consistent with the [official InVEST 3.20.0 SDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html).

**Preview case design** shows the total number of native cases, including the baseline, and the retained selections. The complete design runs even when only a sample of example case definitions fits in the preview. Saving also calculates the same design before queuing its preparation.

The full original reporting area is always included. Add retained polygon sources to report individual catchments or other geographic areas. An optional layer and exact JSON field/value filters select the original geographic features. Enable difference rasters when those maps are useful for the study.

## Execute, resume and inspect

Saving prepares the native cases. Open the saved study and choose **Run all cases**. The operator retains the operation identity and the case/run mapping. The progress bar counts completed native cases; each row opens the original run, native log and coefficient profile.

If a case fails or execution is interrupted, reopen the same study and choose **Resume remaining cases**. Existing complete runs and native stages are reused by the model layer. Failed cases remain visible with their recorded errors.

**Refresh completed results** summarizes cases that already completed. The table and downloadable artifacts remain useful while other cases recover. The study continues to show its partial state until all native cases complete.

The study list shows saved execution checkpoints. Opening a study refreshes its native case states; if a previously completed study has an unfinished case, its detail view returns to partial state and offers continuation.

## Read the results

The matrix reports baseline mass, study-case mass and signed change for each selected model output and reporting area. NDR studies report nitrogen and phosphorus; SDR studies report sediment; combined studies report all three. Every completed case must retain the same native model scope and the complete exports for that scope. Filter by area or pollutant; pagination changes the displayed rows only. All rows remain in the CSV and JSON exports.

A comparison uses the cells where both the baseline and the study case have valid values. Each row also retains independent full totals, baseline/case valid-cell counts, paired-cell counts, actual pixel area, baseline/case valid hectares, paired hectares and a changed-coverage indicator. Expand **Coverage and response** to inspect those values and parameter response statistics.

Results sum the retained annual mass-per-pixel rasters after verifying their declared units and shared grid. Native capture converts per-hectare rates using the original affine pixel area; the study aggregates the resulting pixel masses. For the original 15-metre Gura reference, a pixel is 0.0225 hectares. The native model's original watershed crop, reporting mask and valid cells determine the comparison coverage.

Selected-case ranges summarize the completed parameter cases that have matching spatial coverage. The minimum and maximum describe the explicit cases that were evaluated. The case definitions and references remain attached so a reviewer can interpret those ranges.

Download the CSV, JSON, HTML report, profile selections and complete ZIP from the study. The downloads use the operator's existing content identity checks and original workspace access.

## Operator integration

The operator's parameter studies use `model/parameter_studies.py`. The regional scenario-by-profile experiment engine remains in `model/experiments.py`. Each engine reads its own saved layout: parameter studies use `experiment.json` and the `experiment-specs` registry; regional experiments use `plan.json`, `state.json` and per-case records. Existing study identifiers and source selections are retained.

Add the following files under `opportunities/upstate_forever_2026/`:

- `operator/parameter_study_api.py`: queued action dispatch, catalog and design-preview reads, and the paginated result matrix.
- `operator/web/parameter_studies.mjs`: the study editor, native-case management, result inspection and existing workbench navigation.
- `operator/web/parameter_studies.css`: neutral industrial layout using the workbench's existing colors and typography.

Apply the retained exact-anchor integration edits to the current `operator/server.py`, `operator/web/app.mjs` and `operator/web/index.html`. Each anchor must appear once. If another integration changed the same line, join the equivalent imports, route and lifecycle calls with its current content.

The operator calls the canonical `model.parameter_studies` functions directly. It also reads experiment listings when the existing Workspace overview does not yet include that collection. This complete delivery works with the retained core module and the existing Workspace; the convenience Workspace methods and CLI registration can be integrated independently.

| Interface | Payload |
| --- | --- |
| `GET /api/parameter-studies/catalog` | Workspace and baseline_run_id |
| `POST /api/parameter-studies/preview` | Workspace and selection |
| `GET /api/parameter-studies/results` | Workspace, id, optional area_id/pollutant, offset and limit |
| `GET /api/item` | Workspace, kind=parameter-studies and id |
| `POST /api/actions` | Workspace, action, payload, original operation_id |
| `parameter-study.prepare` | Complete explicit selection |
| `parameter-study.run` | experiment_id |
| `parameter-study.summarize` | experiment_id |

Study preparation and native execution use the existing serialized operator queue and per-workspace gate. Catalog, preview and result reads use existing authentication. Export tickets resolve within the selected experiment directory. The result matrix reads the verified results artifact and validates both experiment and workspace identity before returning data.

## Direct native use

A local runner can use the same canonical model module without the operator or additional CLI registration:

```python
import json
from model.workspace import Workspace
from model import parameter_studies as experiments

workspace = Workspace("/absolute/path/to/retained/workspace")
with open("/absolute/path/to/selection.json", encoding="utf-8") as source:
    selection = json.load(source)
preview = experiments.preview(workspace, selection)
study = experiments.prepare(workspace, selection)
result = experiments.execute(workspace, study["id"])
print(result["id"], result["state"], result["progress"])
```

Run this with the existing application root available on Python’s import path and the retained native model environment. `experiments.inspect(workspace, study_id)` refreshes the case state. `experiments.summarize(workspace, study_id)` refreshes result artifacts from completed cases; it returns the result matrix, while `inspect` returns the study state. `experiments.execute` accepts an optional keyword-only `progress` callback receiving retained state updates.

## Independent navigation and queue namespace

The parameter-study adapter is `ParameterStudyAPI` from `operator.parameter_study_api`. Its collection and navigation key is `parameter-studies`; browser actions use `parameter-study-`, queued actions use `parameter-study.`, and reads use `/api/parameter-studies/`. The browser factory is `attachParameterStudies`. Existing scenario experiments keep `ExperimentOperator`, `experiment.*`, `/api/experiments/*`, the `experiments` view, and the current public `experiments.mjs/css`. The immutable study identifier remains the existing `experiment_id` field and the stored parameter schema remains unchanged.

The server resolves parameter-study downloads under `workspace.root / 'experiments' / study_id` using the original artifact descriptors. This shared parent directory has two explicit file layouts: the scenario engine discovers `state.json`, while parameter studies discover `experiment.json`.

## Use completed cases in annual-load calibration

From the saved study, choose **Use completed cases in calibration**, review the
eligible original runs and their producing-model details, then choose
**Open calibration selection**. The next desk keeps the current observation and
catchment draft and reviews the positive-weight objective and spatial split.
Each original run appears once with all of its study case labels.

A case with an unsupported native output convention, missing retained output or
unfinished execution remains visible with its own exclusion reason. Compatible
completed cases remain available. The version display distinguishes completed
stage execution, observed run fallback and a requested legacy declaration.

The complete [native-version and handoff guide](../model/PARAMETER_NATIVE_VERSIONS.md#continue-completed-cases-into-annual-load-calibration)
describes original identity preservation, physical units, objective-specific
version compatibility and the `model.parameter_calibration.candidates` API.

## Keep the original form active while checking a design

A preview and its retained parameter catalog belong to the open study form that
requested them. Closing the form, opening another form, or changing the
Workspace prevents a delayed response from saving the old draft. Reopen the
study form and preview its current selection before saving. Editing the draft
during a preview also requires a fresh preview of the changed selection.

The completed-case calibration selector follows the same rule. Its request
cannot replace a newer form, and its submit action reads only the original
visible candidate controls. The selected run identifiers and the existing
calibration desk callback remain unchanged. Accepted native tasks continue
through their original queue after the form closes.
