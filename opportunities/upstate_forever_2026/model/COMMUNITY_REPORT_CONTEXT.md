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

Population, households and poverty counts describe the selected whole source block groups. Utility service populations describe whole utility systems. Overlapping utility and watershed summaries keep their original memberships and are not additive.

Interventions, progress labels and cost estimates are recorded planning decisions. Native totals keep their original reporting mask, units and valid-cell count; alternative changes retain the original common-support comparison. The report does not allocate those values to communities or proposed interventions.

Regional context shows each selected original HUC area once and each original NRCS state portion with its edition and designation. A complete query with zero selected South Carolina class matches describes that query’s named classes. Assessment sources remain the basis for water-quality condition and impairment decisions.
