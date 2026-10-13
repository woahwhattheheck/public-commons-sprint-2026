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

## Export and receive one complete source handover

Open **Communities → Reports**, open the retained report, and choose **Export source handover**. The form identifies the original project, report and report edition. Choose **Export complete source handover** to queue the export. When it completes, **Open source handover** offers one `community-source-handover.zip` through the operator's normal downloads.

The file carries the byte-exact original report ZIP, original saved report record and a handover manifest binding their identities. Its original report edition stays visible. The existing **Transfer editable study** action remains available when the recipient needs to continue the editable plans and their full study history.

In the destination Workspace:

1. Open **Communities → Reports → Receive source handover**. This control is available before any Community tables or plans have been imported locally.
2. Choose the exported handover ZIP and **Review original report**. The operator retains the actual file and verifies its complete identity before displaying the original title, project, report edition, plan, table and member count.
3. Choose **Prepare a new report selection**, or select an existing retained delivery. The latter keeps its original runs, maps and ordered report sources.
4. Choose **Receive original report source**. The queued operation remains bound to that original upload and selected destination Workspace. Closing or replacing the form, changing the file or switching workspaces invalidates an unfinished preview.
5. On the completed task, choose **Open scientific report**. The current scientific composer receives the original ordered selection with this report appended once and preserves its existing draft. Review the source order and report details, then preview and build.
6. **Open retained report source** inspects the received originals. **Open prepared delivery form** continues the existing mapped-delivery workflow.

The completed task and its download/source buttons remain available after reopening the operator. Ordinary task recovery reuses the same selected original file. The receiving Workspace owns the imported source; the source retains the donor's original project, report, plan and table identities. Earlier report editions retain their original content.

The same operation is available to a native receiver through the maintained model API:

```python
from model import community_report_handover

exported = community_report_handover.export(
    original_workspace, original_report_id,
    report_sha256=original_report_json_sha256)
metadata = community_report_handover.inspect_archive(
    retained_handover_path, expected_sha256=original_handover_sha256)
received = community_report_handover.receive(
    receiving_workspace, retained_handover_path,
    expected_sha256=original_handover_sha256,
    delivery_id=existing_delivery_id_or_none)
```

When the donor Workspace is offline, package its already retained original report ZIP and ID-bearing saved record in an actual receiving Workspace:

```python
exported = community_report_handover.export_archive(
    receiving_workspace, original_report_zip, original_saved_report_record,
    original_project_id=original_project_uuid,
    report_sha256=original_report_json_sha256)
```

This route first uses the maintained archived-report receiver to verify the full original inventory and scientific context. It preserves the original record bytes, including its recorded ID, and the complete original ZIP. The destination Workspace retains the handover; the manifest continues to identify the original donor. The resulting file uses the same operator preview, receiving action and scientific composer as an ordinary export.

From the actual application root, the corresponding command is:

```sh
python -B -m model.community_report_handover \\
  --workspace ACTUAL_RECEIVING_WORKSPACE pack-archive ORIGINAL_REPORT_ZIP \\
  --report-record ORIGINAL_SAVED_REPORT_RECORD_JSON \\
  --original-project-id ORIGINAL_PROJECT_UUID \\
  --report-sha256 ORIGINAL_REPORT_JSON_SHA256
```

The export returns normal Workspace-relative file descriptors. Inspection reads the complete original archive without creating a receiving source. Receiving returns the same `source`, `delivery_selection` and retained-file contract as the original archive intake below; the existing scientific renderer and portable receiving continue from that result.

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

The producer lives inside the original Community report root; imported sources and the full Community report root are retained by ordinary Workspace backup/restore. The maintained operator extension uses the existing Community desk and task queue, with a focused source-handover controller for complete original-file receiving.

## Reading the scientific context

The prepared source uses community-planning edition 3. Its human-readable sections show selected whole-block-group counts in separate rows, with the complete total, available subtotal and number of groups supplying each measure. Missing values remain explicit. Utility and watershed summaries carry the same coverage fields while retaining their separate membership scopes.

Poverty percentages retain the saved paired-group calculation: the numerator counts households below poverty and the denominator counts all households in the same groups with both values present. The report labels both the complete selected-group percentage and the known paired-group percentage, including the number of contributing groups. It does not average the printed block-group percentages. Income rows retain the source currency, reference value and citation, known-group count and range of original block-group medians. Those bounds are not a pooled median or mean income.

Source provenance is presented as labelled URI, vintage, collection/member, file path, byte count and SHA256 fields. Original nested metadata remains legible as separate field rows; the unchanged original JSON and every indexed companion remain available. Intervention estimates show their known-count and entered-total coverage in USD, followed by readable programme and action tables. Modeled totals and paired changes use separate tables with their original units and support.

When the original Community report contains a saved plan revision, the scientific sections retain the original parent/current plan IDs, changed fields, membership scope, entered-cost availability and signed current-minus-previous estimate difference. Added or removed intervention records are shown field by field, while the complete revision JSON, CSV and previous plan remain indexed original companions. Membership changes describe selected geography, and estimate changes describe entered planning inputs.

Preparing an existing Community report with the current producer creates a distinct scientific source edition because the operation identity includes the producer version and source hash. The original saved report, source files and previously prepared editions remain unchanged. Existing ordered selections continue to identify their exact source editions; review the chosen edition when adding the new source in the composer.

Population, households and poverty counts describe the selected whole source block groups. Utility service populations describe whole utility systems. Overlapping utility and watershed summaries keep their original memberships and are not additive.

Interventions, progress labels and cost estimates are recorded planning decisions. Native totals keep their original reporting mask, units and valid-cell count; alternative changes retain the original common-support comparison. The report does not allocate those values to communities or proposed interventions.

Regional context shows each selected original HUC area once and each original NRCS state portion with its edition and designation. A complete query with zero selected South Carolina class matches describes that query’s named classes. Assessment sources remain the basis for water-quality condition and impairment decisions.


## Receive an original report when its Workspace is offline

A complete Community report ZIP and its saved report record can be received as
scientific source in an actual destination Workspace. This continues the original
report edition without rebuilding its plan, importing intervention edits again,
or assigning the sender's project ID to the recipient.

Use the inner original `community-report.zip`, its exact saved
`revised-report.json` (or original saved record), the original project UUID from
its receiving receipt, and the record's
`files["community-report.json"]["sha256"]`. A broader receiving package may
contain these originals; keep that package unchanged and extract the named
original members first.

~~~sh
python -B -m model.community_report_context \
  --workspace ACTUAL_RECEIVING_WORKSPACE \
  --report-archive ORIGINAL_COMMUNITY_REPORT_ZIP \
  --report-record ORIGINAL_SAVED_REPORT_RECORD_JSON \
  --original-project-id ORIGINAL_PROJECT_UUID \
  --report-sha256 ORIGINAL_REPORT_JSON_SHA256
~~~

The existing live-Workspace `--report-id` route remains available. Choose exactly
one route. The archive route accepts the same `--prepare-only` and optional
`--delivery-id` controls. Its returned `source`, `delivery_selection` and
`sources.json` feed the same scientific report composer and standalone renderer.

The receiver checks the saved report's immutable identity and selection, the
original ZIP size and SHA256, exact member inventory, each member's byte length,
SHA256 and ZIP CRC, original plan/table identities, original file index, and any
saved revision register. Member paths stay inside the receiving directory.
Interrupted copies resume from verified original members. The exact ZIP and
saved record remain companions of the typed scientific source.

The recipe's original project/report/plan IDs describe the sender. The actual
destination project owns the newly imported source collection and scientific
report edition. Cross-project Community source IDs remain provenance; this
source-only receiving route does not recreate editable sender records. Use the
existing complete Workspace or selected **Transfer editable study** archive to
continue those original editable records.

Reports made before the parent-plan change register retain their original
content. Receiving an archive does not calculate a replacement register or relabel
it as a newer Community report format. A newer report must be built from the
actual saved plan through the ordinary live-Workspace route.

After preparation, pass the returned `delivery_selection` source choices to
`observed_report_render.prepare`, render with the existing report renderer, and
use `observed_report_render.archive_report` for complete receiving and independent
reopening. All received source bytes, original report companions and the rendered
scientific report follow ordinary Workspace backup/restore.
