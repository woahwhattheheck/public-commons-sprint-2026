# Scenario decisions — operator and receiving guide

TokenJunkieLabs · Upper Savannah scientific workbench · ECSA-20261012

## Open and assess the retained runs

Open the normal operator URL printed by the existing server and choose **Scenario decisions**. The panel reads the completed native runs and their retained comparison artifacts from the selected scientific workspace.

Choose a native comparison to open its original baseline and alternatives, or select the completed cases in the workbench. The baseline, grid, profile, scenario, model version and reporting scope remain attached to the numbers. Changing the baseline changes the comparison operands; **Build native paired comparison** uses the original task queue and original raster comparison implementation.

The physical table keeps nitrogen and phosphorus in kg/year and sediment in metric_tonnes/year. A negative alternative-minus-baseline change means lower modeled export. Zero is a real numeric result. A blank or missing quantity remains unavailable and is not converted to zero.

Choose a saved **Watershed report** to use its original baseline, alternatives and catchments. Each pollutant in that report has a common mask across every run in the report. The decision panel uses its retained common_mass values and keeps every zone separate, including overlapping or nested catchments.

The native difference raster covers the intersection of valid baseline and alternative cells. A full-area comparison is established when this intersection count equals both original valid-cell counts on the same grid. Cases without that equality still show their original individual totals and retained intersection change. They become eligible for full-area percentages and ranking when comparable support is available.

## Make the decision explicit

Select the geography, metrics and cases relevant to the purpose. Choose an objective or set each metric's direction explicitly. The physical numbers remain visible when directions or weights change. Pareto comparisons identify cases for which another eligible case is at least as good on every selected metric and better on at least one. An undominated case is a tradeoff candidate; it is not an automatic recommendation.

Weighted priority requires explicit weights. The table uses min/max normalization across the eligible common alternatives for each geography. Saving retains the calculated common cohort, minimum, maximum, normalized weights and constant-criterion flags, together with all physical comparison rows. A score is a dimensionless decision aid; it does not replace modeled mass. Reassess the priorities when the candidate set, scope, selected metrics, model inputs or objective changes.

A parameter-profile change is visible beside the case. When both the profile and land cover change, the observed modeled difference includes both changes. The original experiment and ensemble tools support separately controlled parameter comparisons.

Development counterfactuals and restoration alternatives answer different questions. Greater added export under a development case can identify higher protection value, while lower export can identify a preferred restoration or development option. State that purpose in the saved assessment.

## Save and reopen

Enter an assessment title and purpose, then choose **Save assessment**. The existing operator task queue saves an immutable record under workspace/decision-views/. It contains the complete view settings, original selected run and comparison metadata, the scientific methods registry, the full computed comparison, and independent digests of the source snapshot and assessment. Saved watershed reports retain their original JSON artifact hashes.

Select the saved assessment to reopen its original operands and settings. Editing and saving produces a new revision and retains the prior view ID. **Refresh original results** returns to the current workspace catalog. The browser also retains the current draft selection for the same workspace.

The JSON/CSV/text downloads from the panel contain the computed comparison and its source references. The saved workspace task also exposes the original assessment record as a download.

## Transfer and continue

The original portable backup already carries every regular file in the scientific workspace and every application file under model/ and operator/. The new decision records and source therefore travel with the working project. The extension host installer adds saved-decision reference checks to the original receiving step; the decision manifest exposes the panel through the existing authenticated operator.

On the receiving host, use the normal restored application and workspace paths. Open **Scenario decisions**, reopen the saved assessment, change a selected case or criterion, and save a new revision. The previous assessment and its source operands remain available.

The same source operation has a CLI:

    python3 -B -m model.decisions --workspace /owned/upper-savannah-study catalog
    python3 -B -m model.decisions --workspace /owned/upper-savannah-study list
    python3 -B -m model.decisions --workspace /owned/upper-savannah-study show VIEW_ID
    python3 -B -m model.decisions --workspace /owned/upper-savannah-study save selection.json

The selection file is an object with title, purpose and the exported selection. Include assessment with the panel's full computed comparison when saving weighted priorities, so the original common cohort and normalization ranges travel with the record.

## Continue after an interrupted task

The panel shows the retained workspace task state. A failed task preserves the current draft and the original error. **Resume interrupted task** uses the original task ID and resume endpoint. Repeating the same request while its outcome is uncertain reuses the operation ID. Correcting the payload produces a separate explicit request.

## Data and method boundaries

Annual InVEST outputs represent the selected model inputs and parameter basis. The panel does not invent a calendar year. Whole census block-group population totals in the retained community source describe those named block groups; they are not a count of utility customers or an automatic watershed allocation.

The seven map-family meanings and source links are in operator/decision_methods.json. Current export, future conversion threat, drinking-water protection context and high-quality-water designation remain distinct uses of the original modeled data.


## Source integration

Install these source files into the current maintained application. The extension host registers the decision module, its exact API routes, task action, navigation entry, styles and transfer verifier from operator/extensions/decisions.json. The original operator keeps its workspace selection, task queue, authentication and file tickets.

The extension host package is a separate additive integration shared by the source and native-run desks. Use its documented installer once on the cumulative application, then include this desk's manifest. When updating an already installed desk, compare changed source files with the current edition before replacing them.

The initial receiving target named in the project thread is /mnt/data/eco12-source with /opt/pyvenv/bin/python. The actual workspace selected on that host determines the displayed results. Choose the completed regional workspace when its input owners publish that run.

For source adoption, inspect one existing saved native comparison and one retained common-mask watershed report. Save an assessment, reopen it, change the objective and one case, and save a revision. Carry those two assessments through the normal portable export/restore and reopen them in the receiving application. This directly exercises the new user path.
