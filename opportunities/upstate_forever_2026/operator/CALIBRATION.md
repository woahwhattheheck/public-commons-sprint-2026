# Calibration and validation in the Upper Savannah operator

This extension adds a complete observation-based parameter selection workflow to the existing scientific operator. It compares completed baseline native runs with the retained annual-load observations and original upstream catchments. The interface retains a spatial calibration/validation split, presents the scientific results, and creates a portable comparison package.

The native scientific implementation lives in `model/calibration.py`. Its complete methods, selection schema and command-line reference are in `model/CALIBRATION.md`. The operator presents those records and scores directly. It uses the application's existing task queue, source inspection, original-file downloads, workspace selector, and backup/restore operations.

## Install into the retained application

Use the complete current Upper Savannah application that already contains `model/workspace.py`, `model/observations.py`, the native InVEST engine, and `operator/server.py`. Put this extension cohort in a separate source directory with the following relative paths:

- `model/calibration.py`
- `model/CALIBRATION.md`
- `operator/calibration.py`
- `operator/web/calibration.mjs`
- `operator/web/calibration.css`
- `operator/CALIBRATION.md`
- `operator/install_calibration.py`

Use the application's existing Python environment. Substitute the actual retained application and source directories for the paths below.

```bash
python -B /path/to/calibration-source/operator/install_calibration.py \
  --application /path/to/current/application \
  --source /path/to/calibration-source
```

The installer copies the seven extension files and adds calibration registrations to the current `operator/server.py`, `operator/web/app.mjs`, and `operator/web/index.html`. It composes the current source in memory, checks the Python syntax, retains original shared files, and checks their bytes again before replacing them. The current source remains the basis for the registration; map, community, customer review and other operator additions keep their existing code.

A repeat installation reuses identical files. Extension updates use the hashes recorded in `operator/calibration-install.json`; an independently modified extension must be composed with its current source before replacing it. The installer's `--preview` option returns the same path and hash plan without applying changes.

If another capability has changed a registration location, the installer names that location and returns a failure. Compose that named join in the actual current source and rerun the installer. Original preimages are retained with the installation history. The installer prepares every change before writing; an interrupted write can be resumed by applying the same cohort again.

Restart the existing operator server using its retained launch command and open its current authenticated browser URL. **Calibration and validation** appears in the navigation. The extension uses the existing native environment and browser modules.

## Prepare the original scientific inputs

The workspace needs completed native baseline runs and an admitted annual-load observation edition. Each candidate group contains runs from the same original grid and unchanged land-cover baseline, with different retained parameter profiles. Select the original catchment polygon source and ID field used by the observations.

The native catalog exposes compatible runs and the retained observations. A useful selection needs comparable observed annual loads for at least one of nitrogen, phosphorus or sediment. Native nitrogen and phosphorus loads retain kilograms per year; sediment retains metric tonnes per year. The original observation pipeline retains accepted rows, contextual rows, qualifiers, source references and units.

The source edition and catchments must belong to the same scientific workspace. The calibration inspector reads the actual polygon layer. It connects overlapping upstream catchments and repeated station identifiers into whole spatial groups, then retains the source geometry and native references used to derive those groups.

## Select profiles and annual observations

1. Open **Calibration and validation** and choose **New calibration**.
2. Give the selection a study title. Choose the retained grid and baseline, then check the completed candidate parameter profiles.
3. Choose the original annual-load observation edition. **Inspect original observations** opens its original records and downloads.
4. Choose the catchment source edition and polygon source. Use **Inspect native source fields** to see the actual layer names, field types, feature count and first original features. Select the catchment ID field that matches the observations.
5. If needed, add exact field filters with their real data types. The optional observation record list selects actual retained record IDs, one per line.
6. Choose observation-period weighting. **Complete years** gives complete annual periods equal weight, including leap years. **Elapsed days** uses the original covered duration for documented annualized period rates. Keep this choice consistent with the original annual-estimation method.
7. Set the relative pollutant weights. A zero weight excludes that pollutant from parameter selection. Automatic normalization uses calibration observations only. A study-specific normalization scale must be positive and must include its source or rationale.
8. Choose **Inspect original catchments**. After the original source inspection completes, assign entire groups to calibration or validation. Keep at least one group for calibration. Giving two groups the same name merges them; merged groups must share the same role.
9. Choose **Save calibration selection**. The existing operator task queue retains an immutable calibration plan.

The form retains its draft for the selected workspace in the current browser session, including temporarily invalid entries. Changing source inputs invalidates the previous catchment preview, so the next save inspects the corresponding original source selection. Revising a saved plan creates a new immutable selection.

The advanced panel supports an explicit reference candidate for exact score ties and a delivered external annual load linked to an actual original observation record. Each delivered load requires its annual mass, units and original source reference. The native science module validates this additional contribution before using it with the diffuse-load prediction. Use the observation/source notes to retain reservoir, point-source and annual-period context.

## Analyze and inspect the results

Open a saved selection and choose **Analyze selection**. The single existing operator worker evaluates retained completed native runs. The science module reuses matching original observation comparisons, persists completed candidate work, and resumes from that progress after an interruption.

The analysis ranks eligible profiles using the saved calibration groups, pollutant weights and normalization. Group weighting keeps a repeated station or a dense cluster of related upstream catchments from silently becoming independent replicated evidence. Reserved validation groups assess the selected profile after selection. If the plan reserves no validation groups, the saved evaluation design is calibration only.

Open **Results** from the completed task or saved selection. The interface includes:

| View | What it shows |
| --- | --- |
| Profile ranking | Calibration objective, selected candidate, completed native run links and retained candidate outcomes. |
| Physical fit | Per-pollutant calibration errors, physical units, catchment/group counts and normalized mean squared error. |
| Independent validation | Selected-profile performance on the reserved spatial groups. |
| Observed and modeled | Each selected-profile catchment/pollutant prediction beside its original annual reference, period and source record IDs. |
| Catchment groups | The retained calibration/validation assignments, original catchments, stations and admitted record counts. |
| Candidate envelope | Annual-load ranges across the calibration Pareto candidates, with actual candidate coverage. |
| Group stability | Selection after leaving out each calibration group, using the same retained native predictions and recomputing normalization from the remaining calibration groups. |
| Exclusions | Original reference exclusions, incomplete native support and candidate-specific errors retained by the scientific analysis. |

The observed-versus-modeled charts keep pollutants separate and use their physical units. Filled circles show calibration catchments; outlined squares show validation catchments. The dashed line marks equality. Every chart point comes from the selected candidate's retained, included prediction rows.

Search, sort and page the result tables to find a profile, catchment, pollutant or source record. Every original row remains in the downloaded CSV and complete JSON records. The **Original complete analysis record** contains the full methods, source vintages, normalization, validation support and candidate outcomes.

A candidate requires the complete declared calibration support before it can enter the ranking. An analysis with no eligible candidate retains an explicit result and reports the native support problem in the operator task. Open the saved selection to inspect that retained result, address the source or native-run outcome, and rerun or revise the selection.

### Interpret the scientific comparisons

A lower normalized calibration objective identifies the selected retained profile. Physical RMSE, mean bias and other pollutant metrics describe its errors in the original annual mass units. Normalization is derived from the calibration references, or from the study-specific scale saved with its rationale.

A reserved spatial split separates parameter selection from the selected-profile validation report. It does not create a new observed time series or add independent years to an annual model. The original period assumptions remain attached to the records.

The candidate envelope describes the calibration Pareto set: candidates whose pollutant scores are not jointly dominated by another candidate. Its range reflects retained profile differences and coverage. The full report explains that interpretation and keeps the actual envelope candidate count for each catchment/pollutant.

Leaving one calibration group out evaluates the stability of the selection among the original completed candidates. It uses their retained predictions, with the held calibration group removed from that fold's normalization and selection. Separately reserved validation groups stay outside those folds.

## Export the complete comparison

Choose **Export complete results**. The existing queue produces `calibration-results.zip` in the selected scientific workspace. Open the completed task to download the ZIP or individual result files.

The archive contains:

- `index.html`: a standalone, printable report with every comparison table.
- `report.json`: the exact retained scientific analysis record.
- `selection.json`: the exact retained calibration plan.
- `ranking.csv`, `metrics.csv`, `validation.csv`, `observations.csv`, `groups.csv`, `envelope.csv`, `stability.csv`, and `exclusions.csv`: complete result rows, including extra native fields.
- `manifest.json`: the original workspace, selection and result identifiers, plus the size and SHA-256 of each report member.

Open `index.html` after extracting the archive. It uses local files and embedded monochrome styling. CSV string values that spreadsheet applications could interpret as formulas are exported as literal text. Numeric scientific results retain numeric values.

Exports live under `calibration-exports/<analysis-id>/`. The saved archive descriptor binds the completed ZIP to its exact bytes. Reopening or repeating the export verifies the retained files and reuses the completed package; an interrupted export can finish using the original records.

## Preserve and reopen the workspace

The native workspace archive already walks the retained scientific workspace and includes the original application source. The calibration collections therefore travel with the same archive:

- `calibration-plans/`
- `calibration-analysis/`
- `calibrations/`
- `calibration-exports/`

Use the existing **Create complete backup** and restore workflow. The original workspace identity, plan/result identifiers, completed comparison progress and exported files remain available after restoration. The extension registration lives in the backed-up application source, alongside the native scientific modules and other operator capabilities.

## Operator API

The routes share the existing authenticated local operator and selected workspace.

| Method | Route | Selection |
| --- | --- | --- |
| GET | `/api/calibration/catalog?workspace=...` | Compatible completed run groups and admitted original observation editions. |
| POST | `/api/calibration/preview` | JSON body with `workspace` and native `selection`; reads original catchments and derives groups. |
| GET | `/api/calibration/plan?workspace=...&id=...` | Retained plan, persisted progress and original JSON download. |
| GET | `/api/calibration/report?workspace=...&id=...` | Complete scientific result, original plan, presentation rows and downloads. |
| POST | `/api/actions` | Existing task submission with `calibration.prepare`, `calibration.analyze`, or `calibration.export`. |

Queued action payloads are `{"selection": <native-selection>}`, `{"plan_id": <retained-id>}`, and `{"report_id": <retained-id>}`, respectively. The existing request also carries the selected workspace and operation identity. A repeated submission with the same operation identity follows the operator's retained-task semantics.

The original-source preview takes the workspace's existing native-operation gate. The interface can continue displaying retained reports while the worker completes a scientific operation. Source inspection during active native work returns the existing busy response and leaves the form draft available.

## Source layout

`operator/calibration.py` adapts the scientific records and writes comparison exports. `operator/web/calibration.mjs` provides the existing operator's calibration view and forms. `operator/web/calibration.css` supplies scoped monochrome styling. `operator/install_calibration.py` registers them in the retained application.

The scientific model API remains `catalog(workspace)`, `preview(workspace, selection)`, `prepare(workspace, selection)`, `inspect(workspace, plan_id)`, and `analyze(workspace, plan_id)`. See the companion model guide for the complete scientific input schema and source-native command-line workflow.
