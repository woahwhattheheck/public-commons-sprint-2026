# Execute and deliver a saved watershed study

The headless study commands use the same Workspace, native runs, scientific
catalogue, scenario ensembles and paired raster products as the operator.
They are intended for an equipped native worker carrying a complete application
and an existing project.

Needs expert review: interpret the retained scientific profiles, chosen
land-cover changes and explored parameter cases in the context of the study
area. The catalogue stores the source references for each varied value.

## Complete operating path

Run commands from the application directory
(opportunities/upstate_forever_2026 in the public repository). UPSTATE_PYTHON
is the interpreter containing this application's native geospatial dependencies.
UPSTATE_WORKSPACE is the absolute path to the existing Workspace.

First read the saved selections:

~~~sh
"$UPSTATE_PYTHON" -B -m model.ensemble_cli \
  --workspace "$UPSTATE_WORKSPACE" context
~~~

The response contains actual grid, profile, scenario, native run and ensemble
records, together with the available source-backed studies. Select the prepared
grid and observed baseline belonging to the project, the profiles to compare
and any saved land-cover alternatives. The selected grid and profiles must
contain the models required by the study.

| Study | Models | Varied cases |
| --- | --- | --- |
| routing-ndr-v1 | NDR | Native mfd and d8 routing |
| routing-lmax-sdr-v1 | SDR | Native mfd/d8 routing crossed with maximum L 122/333 |
| routing-lmax-v1 | NDR and SDR | Linked mfd/d8 routing crossed with SDR maximum L 122/333 |

The source catalogue carries the original InVEST 3.20.0 module references and
guide sections. Maximum L is dimensionless. The engine retains the selected
reference profiles before deriving the varied members and reuses equivalent
native parameter selections. Preview therefore gives the actual member count.

With UPSTATE_GRID_ID, UPSTATE_BASELINE_ID, UPSTATE_PROFILE_ID and
UPSTATE_ALTERNATIVE_ID set to the selected saved IDs, one command prepares the
study, runs the original native models, computes physical comparisons, writes
the printable report and CSV/JSON exports, and builds the original paired
raster products and their portable ZIPs:

~~~sh
"$UPSTATE_PYTHON" -B -m model.ensemble_cli \
  --workspace "$UPSTATE_WORKSPACE" \
  run-study routing-lmax-v1 \
  --grid-id "$UPSTATE_GRID_ID" \
  --baseline-scenario-id "$UPSTATE_BASELINE_ID" \
  --base-profile-id "$UPSTATE_PROFILE_ID" \
  --alternative-scenario-id "$UPSTATE_ALTERNATIVE_ID" \
  --with-raster-products
~~~

Repeat --base-profile-id to include other retained source profiles. Repeat
--alternative-scenario-id to evaluate additional saved land-cover changes.
Omit the alternative option for a parameter-only study. Choose the NDR or SDR
catalogue study when that is the model scope prepared in the selected grid.
--title and --reason optionally name the study and its scientific question;
the sourced catalogue title and question are the defaults.

Each selected alternative receives the full retained parameter design.
The engine reuses complete native stages when the same run selection already
exists. Raster analysis follows those completed native runs and uses the
existing streaming paired-product kernel.

## Review or retain the exact design

study-design validates the complete selection and prints ordinary design JSON
on stdout. Its brief workload notice goes to stderr. It performs the same
source/model/profile/scenario validation as the operator preview.

~~~sh
"$UPSTATE_PYTHON" -B -m model.ensemble_cli \
  --workspace "$UPSTATE_WORKSPACE" \
  study-design routing-lmax-v1 \
  --grid-id "$UPSTATE_GRID_ID" \
  --baseline-scenario-id "$UPSTATE_BASELINE_ID" \
  --base-profile-id "$UPSTATE_PROFILE_ID" \
  --alternative-scenario-id "$UPSTATE_ALTERNATIVE_ID" \
  > "$UPSTATE_DESIGN_JSON"

"$UPSTATE_PYTHON" -B -m model.ensemble_cli \
  --workspace "$UPSTATE_WORKSPACE" preview "$UPSTATE_DESIGN_JSON"

"$UPSTATE_PYTHON" -B -m model.ensemble_cli \
  --workspace "$UPSTATE_WORKSPACE" prepare "$UPSTATE_DESIGN_JSON"
~~~

UPSTATE_DESIGN_JSON is the chosen output filename. The design contains the
complete axis values, reasons and original references. prepare returns the
retained ensemble ID. The normal JSON-design path also supports independently
sourced axes and profile comparisons through the engine's existing schema.

The first reference profile remains first. Derived profiles preserve their
actual source collection and biophysical table identity, the selected native
model parameters and the source references attached to each variation.

## Continue the same operation

Set UPSTATE_ENSEMBLE_ID to the saved ID printed before execution or recovered
with list. Continue the original native runs and complete all report products:

~~~sh
"$UPSTATE_PYTHON" -B -m model.ensemble_cli \
  --workspace "$UPSTATE_WORKSPACE" \
  continue "$UPSTATE_ENSEMBLE_ID" --with-raster-products
~~~

The command invokes the existing Workspace.run and Ensembles.run methods.
Completed native stages keep their original run IDs. Interrupted or failed
members resume through those methods. The explicit continue command also
resumes the original paused raster selection, clearing its own retained pause
request through EnsembleWorkspace.resume.

Independent native members continue after ordinary member failures.
--stop-on-error stops the native loop at its first failure and still exports
the results already completed. The operation record includes the native
progress and actual error details, so the completed cases remain usable while
the affected member is repaired.

A repeated run-study with the same saved selections and catalogue title/reason
reuses the same design identity. continue is the direct recovery route when an
ensemble ID is already known.

## Export the completed native results

Use export when the original models have already run through the operator or
another native process:

~~~sh
"$UPSTATE_PYTHON" -B -m model.ensemble_cli \
  --workspace "$UPSTATE_WORKSPACE" \
  export "$UPSTATE_ENSEMBLE_ID" --with-raster-products
~~~

This refreshes missing physical summaries and writes the report release. With
--with-raster-products it also computes the selected paired raster analyses
from the completed original run artifacts. Each saved alternative produces its
own coherent scenario contrast. The same design_cohort function feeds both the
shared paired desk and the command-line consumer.

The cohort binds pairs from each actual member's baseline and the selected
land-cover alternative, using the identical profile within each pair.
It retains the planned member count and lists pending members with their
original run states and errors. Available physical outputs and the saved
model scope determine which pollutant products can be included.

A cohort with completed pairs can produce its available result while the
operation retains unfinished members explicitly. Original all_pairs support
requires all selected completed pairs at a pixel. planned_member_count keeps
the full design visible alongside the selected and valid pair counts.
The paired report's improvement fraction divides by the actual valid pair
count at each pixel.

Read a particular cohort directly:

~~~sh
"$UPSTATE_PYTHON" -B -m model.ensemble_cli \
  --workspace "$UPSTATE_WORKSPACE" \
  cohort "$UPSTATE_ENSEMBLE_ID" \
  --scenario-id "$UPSTATE_ALTERNATIVE_ID"
~~~

The response includes the directly executable selection, actual paired run IDs,
available pollutants, pending members, planned/selected counts and readiness.
The complete selection is also saved when an operation starts that raster
product.

## Returned files and progress

Every complete command prints one final JSON result on stdout.
Progress notices use stderr and identify the saved ensemble and operation
path before the first native execution. Add --quiet-progress before the
subcommand to suppress these notices.

The operation record is saved at:

~~~text
ensemble_results/ENSEMBLE_ID/operation.json
~~~

It links the original native state, the actual process hostname/PID/interpreter,
the source catalogue selection, final run progress, printable release, paired
products and portable archives. The PID identifies the producing invocation.
Current native progress remains in the original ensemble/run files.

| Retained location | Contents |
| --- | --- |
| ensembles/ENSEMBLE_ID.json | Immutable scientific design and original native run selections |
| ensemble_results/ENSEMBLE_ID/state.json | Original native execution and comparison progress |
| ensemble_results/ENSEMBLE_ID/summary.json | Canonical physical comparison data |
| ensemble_results/ENSEMBLE_ID/operation.json | Command state, actual process, source selection and product paths |
| ensemble_results/ENSEMBLE_ID/paired-selections/SCENARIO_ID.json | Selection used by the original raster consumer |
| ensemble_reports/REPORT_ID/ | Printable report, CSVs, JSON, methods and ensemble-report.zip |
| ensemble-products/ANALYSIS_ID/ | Original paired raster analysis, retained tiles and reports |
| ensemble-products/controls/SELECTION_ID.json | Original paired-product progress |
| ensemble_results/ENSEMBLE_ID/paired-exports/ | Portable complete result archives |

The scalar release includes report.html, pairs.csv, sensitivity.csv,
robustness.csv, report.json, METHODS.md, release.json and ensemble-report.zip.
The command result includes verified file paths, byte counts and SHA256 values.
The paired archives use the original portable project's manifest, reports and
raster files; the command retains the returned archive identity.

Retries reuse an archive when its recorded report revision and actual file
hash still match. A new export uses an exclusive new filename. The original
Workspace backup transfers the complete scientific inputs and application
along with these retained results.

The existing original ensemble execution lock serializes native work for a
design. The command also keeps an operation lock while linking its reports and
raster products. Multiple views continue to read the original native progress.
There is no additional background job queue.

## Meaning of the outputs

The scalar comparison report uses alternative minus baseline for each
land-cover effect and varied minus reference for parameter sensitivity.
Negative change indicates lower modeled export in the selected comparison.
Nitrogen/phosphorus annual totals are kg/year; sediment annual totals are metric
tonnes/year. Shared-cell totals, full-coverage totals and geographic support are
preserved separately.

The paired raster report uses baseline minus alternative. Positive reduction
therefore indicates lower modeled export under the alternative. Its quantiles
describe the selected retained parameter cases at each pixel. The original
native raster units and source inputs travel with the product.

Parameter-only baseline sensitivity stays in the scalar report. The paired
raster consumer evaluates the saved baseline-versus-land-cover contrasts.

See [ENSEMBLES.md](ENSEMBLES.md) for design semantics and source references,
[PAIRED_ENSEMBLES.md](../PAIRED_ENSEMBLES.md) for streaming support and portable
products, and [REGIONAL_MODEL_AND_ENSEMBLE.md](../operator/REGIONAL_MODEL_AND_ENSEMBLE.md)
for the complete source-to-operator workflow.

## Exit codes and recovery

| Exit code | Result |
| --- | --- |
| 0 | Requested operation completed, or the requested read/design validation succeeded |
| 2 | Incomplete operation, unavailable cohort, invalid selection or a retained runtime error |
| 130 | Keyboard interruption with existing native progress preserved |

Inspect the same saved ensemble after an interrupted terminal:

~~~sh
"$UPSTATE_PYTHON" -B -m model.ensemble_cli \
  --workspace "$UPSTATE_WORKSPACE" list

"$UPSTATE_PYTHON" -B -m model.ensemble_cli \
  --workspace "$UPSTATE_WORKSPACE" inspect "$UPSTATE_ENSEMBLE_ID"
~~~

Repair the affected native input or environment and use continue with that same
ensemble ID. The original source selections, completed native stages and paired
tile results provide the recovery path.
