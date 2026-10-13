# Integrated conservation planning — native intake edition

This edition joins source preparation, selected native model runs, original polygon inventories, conservation portfolios, whole-scenario analysis, physical watershed reports, economic decisions and parameter studies in the Upper Savannah scientific application. All work uses the original Workspace, retained inputs, task queue, download tickets and scientific archive.

## Open the integrated application

Use the maintained public application at `opportunities/upstate_forever_2026`. Open the existing scientific workspace from this application so its actual sources, model outputs, operator tasks and registered source paths remain available.

~~~bash
python operator/server.py --workspace /path/to/scientific-workspace \
  --source-root /path/to/original-inputs
~~~

The conservation interface is part of the shared operator. It preserves the scenario-experiment desk, run programmes, conservation studies and registered source/report extensions. The CLI exposes the same planning inventory, portfolio, selected scenario, native run, report and economic decision operations.

## Operating journey

1. **Prepare sources.** Import the original source files and parameters. Retain the reporting boundary, model domain, original land-cover classes and grid. The source-preparation desk and native-run desk expose the original Workspace operations.
2. **Execute the selected models.** Run NDR, SDR or both under an explicitly selected profile. Native stage reuse follows actual source and parameter identity. The baseline and alternatives used together must have compatible retained grids and selected outputs.
3. **Build native inventory.** In Conservation portfolios, choose a completed baseline, optional compatible alternatives and an original polygon layer. Choose its original feature ID and unit kind. The operation summarizes common-valid annual mass for the same cells in every selected run; it retains missing context as unknown.
4. **Choose the planning objective.** Use restoration against a completed alternative, avoided conversion against an evaluated conversion, or current baseline export. Choose actual available pollutants, filters, original-feature inclusion/exclusion, and budget, area or count limits. A cost budget requires a supplied cost table. Inclusion specifies the candidate universe; it does not force every included unit into the result.
5. **Preview and save.** Review the selected units, original attributes, unknown costs, physical changes, feasibility, optimization bound and preference stability. Save the retained inputs and the full analysis.
6. **Run selected land cover.** Specify original and target land-cover codes with their reason. The application uses the chosen units' original geometry and reporting boundary. Prepare or execute the ordinary native scenario on the retained grid.
7. **Compare native scenarios.** Open the saved portfolio's completed evaluation in Scenario analysis. Review common-support pollutant results, fixed baseline priority scales, planning areas and weight preferences. Whole-scenario physical reports are available through the scenario-report desk.
8. **Build portfolio report.** The report joins the saved planning result with its actual native evaluation. It reuses or executes a baseline with the original baseline land cover and the evaluation's model selection, profile and native version.
9. **Build economic decision.** Supply a dated source, cost basis, capital and annual operating assumptions, planning horizon and discount rate. The action uses the same matching physical baseline and produces the editable desk, CSVs and full ZIP. The economic desk also opens physical scenario reports from the shared report producer.
10. **Study alternatives.** Use the scenario-experiment desk for saved scenario and profile combinations. Portfolio weight preferences reuse retained physical results; scientific parameter changes execute the corresponding native calculations.

## Original Gura receiving operation

The two receiving drivers retain the official InVEST 3.20.0 Gura NDR and SDR data archives, original table values, watershed and subwatersheds. The reference case uses the original 15 m projected grid and zero added buffer. Native output rates are converted to annual mass once per 0.0225 ha pixel; the planning inventory then sums those existing mass outputs without another conversion.

`source_tools/receive_gura_reference.py` prepares and runs the original inputs, with optional direct reference-model comparison. `source_tools/receive_gura_planning.py` continues through a declared class-5 agriculture to class-8 forest scenario, original subwatershed intake, constrained portfolio, selected original geometry, combined native run and report. It verifies the retained table descriptions before accepting those class meanings.

The driver records actual progress, IDs and errors under `gura-receiving`. Completed native stages are reused according to their retained identity.

## Retain and transfer

Back up the Workspace through the original operator. The archive includes selections, native inventories, original treatment geometry, sources, native outputs, reports and application source. Restore verifies the saved inventories and portfolio artifacts. The printable report and complete ZIP provide the same original identifiers and calculations as the interactive workbench.

## References

- [Portfolio inputs, methodology and CLI](../model/PORTFOLIOS.md)
- [Selected-model native operations](../model/SELECTED_MODEL_OPERATIONS.md)
- [Scenario analysis](SCENARIO_ANALYSIS.md)
- [Physical scenario reports](../model/SCENARIO_DECISIONS.md)
- [Economic decision methods](../model/DECISION_METHODS.md)
