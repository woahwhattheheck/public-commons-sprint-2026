# Use a saved Community report in scientific reporting

The Community report keeps the exact saved plan, original community table, intervention programme, original modeled context and optional regional watershed source. Preparing it as a scientific source makes that same edition available in **Original sources → Review retained reports** and in the existing ordered scientific-report selector.

## Operator course

1. Open **Communities**, choose a saved plan and build its complete Community report. A report built after an edited intervention CSV retains that unchanged CSV and its import lineage.
2. Open the saved report and choose **Use in scientific report**.
3. Choose **Prepare a new report selection**, or select an existing retained delivery. An existing delivery preserves its original runs, maps, mode and ordered report sources. This Community source is appended once.
4. Choose **Prepare scientific report source**. The original operator queue retains the report ID, original JSON hash and optional delivery ID. Normal task retry reuses that exact selection.
5. When preparation completes, choose **Open scientific report**. The existing scientific report composer receives the exact ordered source choices in the current Workspace. It preserves an existing draft and adds each missing source once; review the combined order, title and contact details before previewing and building the saved report edition. This course uses the retained reports directly.
6. Choose **Open retained report source** to inspect the imported source edition. **Original sources → Review retained reports** previews its unchanged Community HTML and offers every original file and complete source-edition export.
7. Choose **Open prepared delivery form** when composing the full scientific map delivery. Its existing baseline/alternative and complete-model requirements still apply. Review the ordered sources in that original form and build the delivery. The Community planning sections retain their original scope alongside the other scientific reports, with the original source files available for inspection and receiving.

The task’s completed-result buttons remain available after reopening the operator. Source preparation does not change the original plan or report.

## Read changes between saved plans

Build a new Community report from a saved revised plan to receive its **Changes from previous saved plan** register. Open that report in Communities to see interventions added or removed, exact field and order changes, plan-detail changes, selected whole block groups, entered cost estimates, and original scientific/CSV lineage. **Open previous saved plan** returns to the retained parent edition.

Entered-estimate totals and their difference carry the number of interventions with and without an estimate. Missing estimates remain separate. Community counts describe the original whole source block groups, including their overlapping utility and watershed memberships.

The report retains `previous-plan.json`, `plan-revision-summary.json` and `plan-revision-changes.csv`. The CSV stores exact before/after values as JSON. Preparing this report as a scientific source carries those same original files and register sections into the ordered composer. Initial plans and reports created before this register retain their existing content; a new report edition adds the register without changing an earlier report.

## Native course

From the maintained application root, use the actual saved report ID and its `files["community-report.json"]["sha256"]`:

```sh
python -B -m model.community_report_context \
  --workspace ACTUAL_WORKSPACE \
  --report-id ACTUAL_COMMUNITY_REPORT_ID \
  --report-sha256 ACTUAL_ORIGINAL_JSON_SHA256
```

Add `--delivery-id ACTUAL_RETAINED_DELIVERY_ID` to derive the original delivery selection with this report appended. The JSON result includes the imported `source`, its verified binding, the prepared `delivery_selection`, and verified source manifest, recipe and original ZIP descriptors. The returned selection is suitable for the existing delivery form or maintained native delivery API.

`--prepare-only` writes the exact source recipe and companion edition without registering it in the Workspace. It cannot be combined with `--delivery-id`.

The source manifest is the first result file ending in `sources.json`. It can be passed directly to the existing standalone scientific renderer:

```sh
python -B source/observed-report-20261013/render.py \
  --app-root ACTUAL_APPLICATION \
  --workspace ACTUAL_WORKSPACE \
  --manifest ACTUAL_PREPARED_SOURCES_JSON \
  --output ACTUAL_REPORT_OUTPUT
```

Use the renderer’s maintained archive and receiving options for its complete standalone report course. Source preparation and rendering use the original saved report; they do not launch another environmental model run.

## Original-file and source contract

The producer reads the original immutable `community-reports` record through the Workspace. It verifies every saved file and requires `REPORT.json` to index exactly the payload members, with `REPORT.json` and `community-report.zip` as the two additional saved descriptors. Plan ID, table ID, title and scientific-context snapshot must match the saved report.

Every original file is copied unchanged beneath the existing report directory’s `scientific-context/<operation>/retained/` directory. This includes the complete original ZIP, source community CSV, report JSON/Markdown/HTML, all summaries, interventions, and any `original-watershed-context.json`, `received-interventions.csv` and `INTERVENTION_IMPORT.json`. A copy is committed only after its byte length and SHA256 match. The original report directory is found from its verified file descriptor; report IDs and report-selection directory IDs are distinct.

The recipe uses `upstate.observed-report/v1` with `report_context_kind=community_planning`. It is imported through the existing `upstate.sources/v1` document/companion mechanism, and the consumer verifies every recipe input against the imported original member. The operation identity binds the project, saved report, original file inventory, producer source and current consumer edition.

The producer lives inside the original Community report root; imported sources and the full Community report root are retained by ordinary Workspace backup/restore. This adds one backend-only operator extension and uses the existing Community desk and task queue.

## Reading the scientific context

The prepared source uses community-planning edition 3. Its human-readable sections show selected whole-block-group counts in separate rows, with the complete total, available subtotal and number of groups supplying each measure. Missing values remain explicit. Utility and watershed summaries carry the same coverage fields while retaining their separate membership scopes.

Poverty percentages retain the saved paired-group calculation: the numerator counts households below poverty and the denominator counts all households in the same groups with both values present. The report labels both the complete selected-group percentage and the known paired-group percentage, including the number of contributing groups. It does not average the printed block-group percentages. Income rows retain the source currency, reference value and citation, known-group count and range of original block-group medians. Those bounds are not a pooled median or mean income.

Source provenance is presented as labelled URI, vintage, collection/member, file path, byte count and SHA256 fields. Original nested metadata remains legible as separate field rows; the unchanged original JSON and every indexed companion remain available. Intervention estimates show their known-count and entered-total coverage in USD, followed by readable programme and action tables. Modeled totals and paired changes use separate tables with their original units and support.

When the original Community report contains a saved plan revision, the scientific sections retain the original parent/current plan IDs, changed fields, membership scope, entered-cost availability and signed current-minus-previous estimate difference. Added or removed intervention records are shown field by field, while the complete revision JSON, CSV and previous plan remain indexed original companions. Membership changes describe selected geography, and estimate changes describe entered planning inputs.

Preparing an existing Community report with the current producer creates a distinct scientific source edition because the operation identity includes the producer version and source hash. The original saved report, source files and previously prepared editions remain unchanged. Existing ordered selections continue to identify their exact source editions; review the chosen edition when adding the new source in the composer.

Population, households and poverty counts describe the selected whole source block groups. Utility service populations describe whole utility systems. Overlapping utility and watershed summaries keep their original memberships and are not additive.

Interventions, progress labels and cost estimates are recorded planning decisions. Native totals keep their original reporting mask, units and valid-cell count; alternative changes retain the original common-support comparison. The report does not allocate those values to communities or proposed interventions.

Regional context shows each selected original HUC area once and each original NRCS state portion with its edition and designation. A complete query with zero selected South Carolina class matches describes that query’s named classes. Assessment sources remain the basis for water-quality condition and impairment decisions.
