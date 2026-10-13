# Land-management cases in the existing scientific operator

The Profile workbench now creates named management cases against an original saved native profile and its exact coefficient CSV. The existing sourced-profile materializer creates the edited tables and profiles. The existing Scenario experiments engine runs, resumes and compares the native cases.

This implements WO20 and the current Tim data-to-results/assumption-control direction in WO48–49. The full current campaign remains at https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8R2SQ0NP. Tim's incoming private data stays in the appropriate existing project storage.

## Use the product

1. Open an original scientific profile in **Profile workbench** and find **Land-management cases**.
2. Name the design and explain its scientific purpose and assumptions.
3. Add a named nutrient-loading, cover/support, or retention practice. Select an original land-cover code and native coefficient, enter its absolute target, and retain the source title, URI, exact locator and applicability. Units and nutrient load type come from the original table.
4. Keep the practice. Each practice becomes a separate named case. Add explicit combinations by selecting two or more practices and explaining their interaction question.
5. Preview the exact original and target coefficients. No-op cases remain identified with the original baseline; equivalent combinations share the same numerical configuration while retaining every selected name and source rationale.
6. Prepare native profiles. Open the derived profiles and download the complete source selection, exact native profile JSONs and edited coefficient CSVs.
7. Choose the completed original baseline run and any retained mapped land-cover scenarios. Prepare the native experiment, then run that exact saved experiment. The original operator queue retains progress, failures, resume controls and downloads.
8. Open Scenario experiments for actual results, maps and paired reporting. Export the full editable project, reopen it independently and continue the same saved case.

The editable design download also carries the unfinished practice editor. Its baseline profile ID and exact original table hash prevent applying it to a different source edition. Browser recovery is scoped to the selected Workspace and profile. An interrupted request retries the same original operation ID.

## Scientific interpretation

Nutrient loading, cover factor C, support factor P and nutrient retention are separate controls. The application does not supply a universal percentage reduction for fertilizer, no-till, cover crops or buffers. Read the five original source files in source/management-practices-20261013/ for primary observations and conditional published choices.

Targets are absolute coefficients. For example, a P target of0.5 is unchanged when the original value is already0.5. A conservation-named choice can increase a modeled output; signed results are retained.

A coefficient choice applies to all selected code cells in the modeled domain. A spatial intervention uses an actual retained land-cover scenario and its mapped source masks. The report measures the actual changed-input area from completed LULC rasters and native table values, separately from the reporting area. It does not substitute a nominal polygon area.

### Coupled management or controlled retention

Application-rate loads pass through native NDR's load*(1-efficiency) source term. Measured-runoff loads enter directly. The preview displays both load and efficiency, their original tags, and the source term before runoff normalization and routing.

Retention cases offer two explicit modes:

- **Use explicit management inputs:** native source coupling is retained. Changing application-rate retention efficiency can also change effective loading.
- **Hold effective nutrient source:** when efficiency changes, the retained source materializer receives an explicitly derived raw application rate that preserves the effective total source. The original load tag stays intact. In a combined nutrient-loading case, the adjusted rate preserves the newly selected loading practice's effective source at the original efficiency. The formula and method source are retained with the changed cell.

The controlled raw rate is selected_load*(1-original_efficiency)/(1-selected_efficiency). An efficiency of1 cannot preserve a positive effective source and is rejected. Zero-source cases remain zero without division by zero. Measured-runoff inputs require no compensation. Nitrogen surface/subsurface fractions remain separately selected inputs; source holding refers to total loading before that split.

These controls produce explicit model inputs. The actual native output remains the basis for reported effects and interactions.

## Per-area results

The original experiment summary and CSV now retain:

- Paired reporting densities for baseline, alternative and signed change.
- Actual changed-input area on the model domain, its reporting-area intersection, and the intersection with valid paired outputs.
- Whole paired-reporting response divided by changed-input hectares.
- Export change density restricted to paired-valid changed cells.

The final two quantities have different numerators. A downstream response can extend beyond the changed pixels. The report labels both and retains the original mass totals, coverage, coefficient changes, original CSV/raster source identities and grid geometry.

Global native parameter changes or different land-cover support prevent attributing the entire response to local changed-input area. The source record explains that condition while retaining useful paired reporting density. Zero-area ratios remain undefined. Summarizing previously completed cases adds this accounting from their retained inputs and outputs once; it does not repeat the native model runs.

## Published pasture treatment course

The source packet includes six coupled annual N/P treatment pairs from Endale et al. (2021), supplementary Table S4: three tall-fescue endophyte types, each with broiler litter and inorganic fertilizer. The retained recipe, exact annual-load CSV, matched-contrast CSV and `ENDALE_2021_PASTURE_CASES.md` preserve the actual 2007–2009 source context. `source_tools/prepare_endale_pasture_cases.py` binds those pairs to the selected original profile and an explicitly confirmed pasture class. It previews by default; `--prepare` uses this same maintained management API.

In the graphical workbench, open **Land-management cases → Use a published pasture treatment source**. Select the actual eligible land-cover class, choose the nitrogen compartment, explain project applicability, and confirm that the coefficient applies to the whole selected class. **Preview these six source cases** reads the proposed inputs. **Add these six cases to this design** deliberately appends the validated pairs to the current design while preserving manual practices, combinations and the unfinished practice editor. Then use **Prepare profiles** and the existing native experiment controls.

The original profile must use measured-runoff for both nutrients. Choose an existing surface-only nitrogen boundary only when its original subsurface share is zero; otherwise explicitly select the surface-only scenario assumption for all six cases. Each case preserves its paired N/P observations, with no independent nutrient cross-product or inferred subsurface measurement. The original baseline, selected class and original table remain linked in the output. The case applies to that selected class throughout the model domain. A pasture subset requires an existing explicit scenario/reclassification scope; the source study's two one-hectare replicates do not define the modeled changed area.

After the six cases complete, compare litter with inorganic fertilizer within each endophyte using the existing completed runs. Keep the P-down/N-up differences visible. See the source guide for exact commands, source applicability and independent receiving steps.

## Maintained command interface

The graphical workbench uses the same functions exposed by this original module:

```sh
python -m model.management_cases --workspace "$WORKSPACE" catalog --profile "$PROFILE_ID"
python -m model.management_cases --workspace "$WORKSPACE" preview --selection "$MANAGEMENT_SELECTION"
python -m model.management_cases --workspace "$WORKSPACE" prepare --selection "$MANAGEMENT_SELECTION"
python -m model.management_cases --workspace "$WORKSPACE" inspect --case "$MANAGEMENT_CASE_ID"
python -m model.management_cases --workspace "$WORKSPACE" prepare-experiment --selection "$NATIVE_SELECTION"
```

The native selection contains case_id, the original baseline_run_id, and selected scenario_ids; original source_run_ids can be supplied for existing native results. The returned experiment is an ordinary original experiment. Run it through the maintained operator's experiment.run action.

## Six-treatment execution and editable delivery

After preparing the published cases, the maintained course helper connects the
actual saved selection to the original experiment engine, native report writer
and full-Workspace exporter:

```sh
python source_tools/run_endale_pasture_course.py \
  --workspace "$WORKSPACE" \
  --prepared "$PREPARED_PASTURE_DIRECTORY" \
  --baseline-run "$ORIGINAL_COMPLETED_BASELINE_RUN" \
  --output "$PASTURE_COURSE_DIRECTORY" \
  --execute --deliver
```

Use an output directory outside both the application and Workspace and separate
from the prepared-source folder. Omit `--execute` to prepare the original experiment
without executing models. Additional retained land-cover scenarios can be selected
with repeated `--scenario` arguments; original source runs can be bound with repeated
`--source-run` arguments. The helper checks the complete native state, preserves
failed cases for the original resumable executor, and uses the actual saved profile
and table. It rebuilds the six published inputs through the same recipe builder
before starting, so a matching treatment name alone cannot substitute other values.

After the six treatments complete, the three within-endophyte fertilizer
comparisons use their already completed runs on the original baseline landscape.
These comparison passes require completed native outputs and perform no additional
model solve. Their original HTML/CSV/JSON reports retain nitrogen and phosphorus,
source inputs, common support, and per-area accounting. Additional scenario cases
remain separate land-cover comparisons in the main experiment.

The optional delivery produces the full editable project archive and reopens it
with the original portable receiver. A separate Python process imports the
application inside that received archive and checks the saved management design,
completed native runs and exact original reports. Repeating the command reuses
valid summary-bound report files, preserving the frozen delivery edition. A process
interruption between archive completion and its receipt is reconciled against the
original archive contents before the receipt is recovered.

The script emits `course-result.json` throughout progress. Complete native results,
downloadable reports and successful independent reopening are recorded separately.
Open the actual resulting project, report screens and every outgoing attachment as
specified below; the cold process does not replace product inspection.


## Integration and receiving

Apply the complete guarded source bank to the current application, preserving ROOT9125's coefficient authoring and every existing native source/version binding. install_profile_workbench.py retains the new profile components, primary source packet, routes and original full-Workspace restore checks. The experiment metrics/report changes accompany this source bank in their original modules.

Use the actual received Workspace. Record its baseline, profile, original coefficient table, grid and selected model versions. Compile the changed Python modules in that same runtime. Operate a source-bound single practice, a separate second practice and an explicit combined case; also exercise unchanged coefficients, source-holding and a conflicting combined edit. Use meaningful actual source choices and existing original runs where identical; preserve all accepted native results.

On the actual native runtime, prepare and execute the new cases, then summarize the original completed cases to add per-area context. Inspect the true outputs and the edited source CSVs, profile JSONs, report HTML and full CSV. Compare source terms and support as appropriate to each actual case. Export and independently reopen the full editable project and confirm the saved cases and sources remain usable.

### Owner's rendered-product instruction

Before presenting the changed app or any attachment, the producing worker must open/run/render its exact outgoing version and LOOK at the actual populated screens and files. Operate the controls at presentation width and390px; inspect applicable empty/loading/error states, downloads and cold reopening. Open every outgoing HTML/CSV/JSON/report/project in its normal recipient-facing viewer. Fix unreadable, clipped or broken output in the original source. Source checks or screenshots that nobody viewed do not replace operating and seeing the product. This is focused product work; build no extra verification product or broad test suite.

Keep existing owners, original histories, scientific units, native InVEST3.20 pins, source attribution and current outbound controls. Continue actual useful runs and integration with the existing receiver.
