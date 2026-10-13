# Compare saved sample quality-control reviews

A repeat sampling visit produces new observations and a new scientific review. Keep the first review and its original samples visible while explaining what the repeat review supports. This workflow compares two retained QC reviews of an existing Implementation plan through explicitly selected group pairs. It preserves the original methods, units, criteria, applicability and report identities, and saves the comparison as its own readable edition.

Use this workflow to explain a follow-up cycle, such as an original field-duplicate review followed by a documented repeat collection. The comparison describes the selected reviews. A difference in a precision metric does not by itself demonstrate an environmental change or identify why the samples differ.

## Begin with the original saved reviews

Open the existing Implementation plan and its sample quality-control history. Save each scientific review through the ordinary QC workflow before comparing it. Each selected review belongs to an exact saved plan revision and contains its full original selection, relationship declarations, reviewer, date, original results and criterion.

Choose the **Before** and **After** reviews by their actual saved report identities. Both must be distinct retained reviews of the same original plan. Read their original plan revisions, review dates and titles before selecting any groups. Before and After describe the order you choose; the application does not infer collection chronology. You may deliberately compare the reports in either order, and the reported difference always follows that order.

The original plan can have advanced since either scientific review. A later field edit does not revise an already-saved review. The comparison should continue to open the retained Before and After source editions, while the normal field editor shows the current plan and its own revision history.

For the prepared simulated headwaters chapter, use the initial and repeat QC report IDs returned by the existing field operation. Keep its current scientific Workspace and original plan. The demonstration contains explicitly simulated observations and authored project criteria; the application calculates and retains the scientific reviews. Receiving this comparison does not require another NDR or SDR run.

## Work through the existing desk

From the original Implementation plan, open **Field records**, then **Sample quality control** and **Compare saved QC reviews**. The comparison uses the original authenticated operator, report bank and Tasks workflow.

1. Choose **Before review** and **After review** from the saved report catalogue. The choices show the original title, revision, date and report identity. Select **Load selected reviews and start explicit pair selection**.
2. Enter the comparison title, reviewer, comparison date, scientific purpose and any comparison notes. The date is the date of this authored comparison; preserve collection and laboratory dates in their original source.
3. Choose a **Before group** and an **After group**. Enter **Relationship and source basis**, add any pair notes, then select **Add this explicit pair**. Repeat for each pair you intend to compare.
4. Select **Calculate comparison**. Read the original values, criteria and definitions on both sides, the reported difference or withheld reason, and the retained unmatched groups.
5. Select **Save complete native comparison**. Follow its original queued task until the saved comparison returns. Open it again using **Open exact saved comparison** in the saved catalogue.
6. Use **Export complete original source package** for the complete readable comparison and both original reviews. Use **Retain scientific report source**, then **Open this comparison in Scientific Reports**, to include the exact retained comparison in the normal report composer.

Each original group can appear only once on its selected side. The model accepts one to 10,000 explicit pairs. Every original group you did not pair remains listed as unpaired, and both complete original reviews remain retained.

The browser keeps the current draft for its original Workspace and plan. Loading selected source reports is an explicit replacement of the pairing selection: if pairs already exist, the previous selection enters the local history and the pair list is cleared. Up to ten previous selections are retained; the title, reviewer and other comparison metadata remain. Use **Download current draft and prior selections** before a substantial revision or when browser storage is unavailable. This local draft is separate from every already-saved comparison.

Changing the current draft invalidates its unsaved preview. A saved comparison keeps its exact source and pairing selection. The catalogue can reopen it while you prepare another draft.

## Declare why two groups should be compared

Select one original group from each review and record the relationship that makes the pair useful to discuss. A group name, nearby sampling date or similar result identifier is not enough to infer a control relationship.

Review the complete original group on both sides:

| Source detail | What to retain in the comparison |
| --- | --- |
| Control relationship | Field duplicate, laboratory duplicate, split sample, replicate or blank as originally declared |
| Original records | Every original result, sample, activity, visit and site identity used by that review |
| Measurement definition | Parameter, unit, basis, fraction, observation method and activity method |
| Original result form | Numeric value, original result text, qualifier, QA disposition and reporting limits |
| Criterion | Metric, entered maximum, source, applicability and admitted qualifier/QA selections |
| Review context | Reviewer, date, purpose, saved report and original plan revision |

Record the reason for the pairing, such as a repeat field-duplicate collection after a retained handling review. Keep unmatched groups visible as unmatched. A blank in the original review does not acquire a later counterpart merely because the repeat review contains two numerical results.

A change in control type or measurement definition is material. For example, an original field duplicate and a later laboratory duplicate address different sources of variability. Equal unit labels alone do not establish scientific equivalence when fraction, method, basis or sampling role changes. Use the comparison's explicit definition/applicability output together with the responsible scientist's interpretation.

## Read metrics and outcomes together

The original evaluator calculates duplicate relative percent difference from two compatible nonnegative numerical results with positive mean:

RPD (%) = 100 × |x − y| / ((x + y) / 2).

For compatible replicate groups it retains the sample standard deviation and relative standard deviation using the original sample count and definitions. Blank evaluation retains its original numerical result and entered maximum when applicable. The [complete original QC guide](../model/IMPLEMENTATION_QC.md) explains the evaluator, quantitation conditions and source-disposition rules.

Read each original metric first. For an admitted pair, the comparison calculates **After value − Before value**. RPD and RSD differences are expressed in **percentage points**. Absolute-difference and numerical-blank metrics retain the original unit. This subtraction is not a relative percentage improvement or a concentration trend.

A lower RPD describes lower relative disagreement within that selected control pair. It does not demonstrate that the water body improved, prove that a handling change caused the result, or erase the initial review. The original sample values and dates remain different records.

### Conditions for a numerical difference

A pair can be useful to document even when its numerical difference is withheld. The application retains both original values, outcomes and source groups, and displays the exact reasons. It admits a difference only when all of these conditions hold:

| Required agreement | Actual comparison rule |
| --- | --- |
| Control type and relationship | The original kind and relationship are equal, such as duplicate / field duplicate on both sides. |
| All measurement definitions | The complete definitions agree. Parameter, unit, basis, fraction, observation method (`method`) and activity method each have exactly one nonempty original value on each side. |
| Full entered criterion | The entire original criterion agrees, including metric, threshold, method source, applicability and any quantitation conditions. |
| Admitted source dispositions | The original accepted-qualifier sets and accepted-QA-status sets agree. Their order in the saved selection does not matter. |
| Original evaluability | Neither group has an original evaluation reason, a `not_evaluated` outcome or a conflict with its associated sample definitions. |
| Numerical metric | Both original reviews select the same metric, both values are finite numbers, and their subtraction is finite. |

The comparison does not convert units, infer missing methods or reconcile changed criteria. Even if an original review could calculate a descriptive result with unspecified definitions, this comparison requires all six definitions to be explicit before reporting its difference. Read a withheld reason such as `different_criterion` together with both retained criteria; preserve the source distinction in the written interpretation.

### Criteria and applicability can change

An outcome transition needs its full original context. A group may move from exceeding a criterion to meeting a criterion because the metric changed, the entered maximum changed, the admitted source qualifiers changed, or the applicability changed. Read the original criterion on each side before explaining the transition.

Keep these dimensions distinct:

| Dimension | Question it answers |
| --- | --- |
| Original metric | What was calculated from that review's selected original records? |
| Definitions and control role | Are these measurements and control relationships suitable for this comparison? |
| Criterion and applicability | Which authored requirement was applied, and did the original records support evaluation? |
| Original outcome | Was the selected metric descriptive, within/exceeding the entered criterion, or unavailable for evaluation? |
| Reviewer decision | What use did the reviewer allow, restrict, exclude or require follow-up for? |
| Field task | What work was assigned or completed, and what original evidence supports it? |

The comparison does not silently replace either review's criterion with a common threshold. If one side lacks an applicable numerical metric, retain its original reason. A censored blank keeps its original less-than text and nonnumeric value; no zero or fraction of its limit is substituted.

### A useful teaching interpretation

The retained headwaters example has an initial eastern pair of 0.120 and 0.200 mg/L as P, followed by a separately collected repeat pair of 0.125 and 0.130 mg/L as P. Both use the declared total-phosphorus, whole-water and method definitions in the original field-design source.

The initial pair's RPD is 50%. The repeat pair's RPD is approximately 3.922%. With the initial review selected as Before and the repeat review selected as After, their direct difference is approximately −46.078 percentage points. Read the exact native saved metrics and the implemented comparison's labels when presenting the actual case.

The demonstration's maximum RPD of 20% and minimum five times each original quantitation limit are explicitly authored criteria. They are not a universal analytical-method threshold. The repeat pair meets that entered requirement in this prepared example, while the first exceeded review remains attached to its original results. The censored original field blank remains a distinct applicability discussion.

An appropriate explanation is: “The first selected duplicate pair exceeded our entered precision criterion. We retained that review, recorded the follow-up work and reviewed a new collection. The repeat pair has its own original source and meets the criterion entered for that review.” Preserve the original intended use and task evidence when discussing what may now be reported.

**Needs expert review.** Before adapting these authored demonstration choices to an actual monitoring programme, the responsible scientific reviewer should assess the sampling design, analytical method, concentration range, control relationship and applicable project requirement.

## Continue decisions and corrective work in their original record

The comparison provides an explanation of the selected saved scientific editions. The existing **Review decisions and follow-up** workflow remains the place to record a use decision, assigned task, evidence and closeout.

Open the relevant original review to inspect its retained action history. Original laboratory QA, computed QC outcome, reviewer use decision and task completion remain separate. A completed field task does not automatically change a review's outcome, and a new comparison does not close a reviewer decision.

For the teaching cycle, preserve the original corrective task and repeat-field attachment. The initial pair's documented use decision and the repeat pair's decision stay attached to their respective original groups. When composing a client report, include the selected comparison alongside the original QC and follow-through sources that substantiate the explanation.

## Save a complete comparison edition

Review the full pairing selection, original source identities and scientific explanation before saving. Keep both original saved reports intact. Retain the comparison's returned identity and the exact selected source editions with its readable report and machine-readable output.

The comparison identity includes the complete authored selection, original report identities and hashes of both original reviews. Saving an identical selection and source edition reuses its retained comparison. A changed purpose, pairing or source produces a different comparison identity. The comparison's top-level revision follows the selected After report; the complete original revision on each side remains recorded, even if you chose them in reverse chronological order.

Use the maintained operator's original task and operation identity when a response is lost or interrupted. The comparison dialog retains the complete request and the actual accepted task identity, including a task returned through the operator's existing request coalescing. Choose **Recover original request** when no acceptance was received; use **Refresh original task**, **Open native task** or **Resume original task** after acceptance. **Download exact retained request** preserves that operation for diagnosis. An actual input conflict should be reconciled against the retained original request and source, preserving both.

The same original pending operation must be resolved before a second save, source-retention or export is started. Closing and reopening the dialog retains its local request state. A completed task remains in the ordinary Tasks view and the saved comparison catalogue.

The saved view displays twenty pair cards per page and offers **Find saved pairs / source context**. Filtering changes the visible cards; it does not alter the saved comparison. The preview displays the first twenty pairs and offers its complete JSON. The saved JSON, CSV, printed report and complete source package retain all pairs.

Download the complete report package and keep its files together. Extract it into a new directory and open **report.html**. Its original-review links lead to **before-review.zip** and **after-review.zip**. Extract each of those into its own directory and open that directory's **report.html**. Those two ZIPs preserve every original filename and byte, so the original report's relative source links continue to work.

The individual prefixed source files also remain in the comparison package for verification. Use the original-review ZIPs for independently navigating an unchanged original HTML report. The comparison package contains:

| Retained member | Purpose |
| --- | --- |
| `report.html` | Complete readable and printable comparison, original criteria, source relationships and download links |
| `qc-comparison.json` | All original pair details, differences, reasons, unmatched groups and source identities |
| `qc-comparison.csv` | All pair rows, values, direction, units and authored relationship basis |
| `qc-comparison-selection.json` | The complete reviewer-authored selection |
| `comparison-inputs.json` | Both original report identities and their complete source inventories |
| `before-review.zip`, `after-review.zip` | Each complete original report under its original filenames |
| `before-*`, `after-*` | Retained original review JSON, plan, source records, inventories and laboratory/evidence files |
| `plan.json`, `summary.json` | The selected After plan edition and its dated summary |
| `observed-report.json`, `qc-comparison-sources.json` | The retained scientific-report recipe and source collection |
| `manifest.json` | The ordinary saved-report inventory with file lengths and SHA-256 values |

Saving and inspection check the retained original source bytes and recalculate the comparison from those exact saved reviews. The unchanged original-review ZIPs are verified against their original inventories. Export verifies the complete comparison package before returning it. A changed or incomplete source should be repaired from its original retained edition; it should not be replaced by a reconstructed value or a screenshot.

**Retain scientific report source** imports the saved comparison and companions into the original source collection. **Open this comparison in Scientific Reports** then opens the existing composer with that exact retained source. Keep the original reviews and applicable follow-through reports in the customer report when they are needed to explain the comparison.

## Reopen on the receiving computer

Use the application's ordinary complete scientific Workspace transfer when another operator needs the editable plan, original review history and comparison. Retain the selected comparison package alongside that project transfer for direct reading.

After receiving, select the actual restored Workspace and open the same plan and saved comparison. Check the original Before/After report identities and group bindings against the sender's selection. Open its retained original source reports and downloaded report output before continuing any field or review work.

A receiving machine should use its own normal output directory and authenticated file links. Keep sender-local temporary paths as historical source facts rather than treating them as paths on the new machine. When the receiver retains a completed export task whose sender-local ZIP is absent, the operator exposes its saved comparison and offers a new local ZIP export from those exact retained sources. Preserve the transferred task as history and use the supplied local re-export action. Do not copy a sender-local absolute path into the receiver's filesystem.

## Integration contract

The maintained implementation is [model/implementation_qc_comparison.py](../model/implementation_qc_comparison.py), with its original operator provider in [operator/implementation_qc.py](../operator/implementation_qc.py) and browser dialog in [operator/web/implementation_qc_comparison.mjs](../operator/web/implementation_qc_comparison.mjs).

A selection has schema `upstate.implementation-qc-comparison-selection/v1` and these fields:

| Field | Source and meaning |
| --- | --- |
| `plan_id` | Original common plan identity |
| `before_report_id`, `after_report_id` | Two distinct saved QC report identities from that plan |
| `title`, `purpose`, `reviewer`, `as_of` | Required authored comparison context; `as_of` is a valid comparison date |
| `notes` | Optional overall interpretation |
| `pairs` | One to 10,000 explicit pair objects |
| Pair `id` | Unique valid identifier within the selection |
| Pair `before_group_id`, `after_group_id` | Actual original group identities; each group is used once at most on its side |
| Pair `basis` | Required authored relationship and source basis |
| Pair `notes` | Optional interpretation specific to that pair |

The corresponding native model calls are:

```python
from model import implementation_qc_comparison as comparison

preview = comparison.preview(ws, selection)
saved = comparison.save(ws, selection)
catalogue = comparison.catalog(ws, selection["plan_id"])
received = comparison.inspect(
    ws, saved["plan_id"], saved["comparison_report_id"]
)
report_source = comparison.scientific_source(
    ws, saved["plan_id"], saved["comparison_report_id"]
)
archive = comparison.export(
    ws, saved["plan_id"], saved["comparison_report_id"],
    output_directory / "qc-comparison.zip",
)
```

Here `ws` is the already-open original Workspace, `selection` is the complete authored selection from its actual retained reviews, and `output_directory` is an existing or chosen native path outside that Workspace. Keep the original operator as the coordinator of queued work when operating through the UI.

The authenticated operator routes and action payloads are:

| Operation | Route or native action | Required payload |
| --- | --- | --- |
| Read saved comparisons | GET `/api/implementation-qc/comparisons` | `workspace`, `plan_id` |
| Open saved comparison | GET `/api/implementation-qc/comparison-inspect` | `workspace`, `plan_id`, `comparison_report_id` |
| Calculate an unsaved selection | POST `/api/implementation-qc/comparison-preview` | `workspace`, `selection` |
| Retain a comparison | `implementation.qc.comparison.save` | `{selection}` |
| Retain its scientific source | `implementation.qc.comparison.source` | `{plan_id, comparison_report_id}` |
| Export the retained comparison | `implementation.qc.comparison.export` | `{plan_id, comparison_report_id}` |

Queued native actions use the ordinary `/api/actions` submission envelope with `workspace`, `action`, `payload` and the original `operation_id`. The existing task polling/resume workflow supplies the accepted task identity and completion result.

A retained result includes `plan_id`, `revision`, `comparison_report_id`, `comparison_id`, `comparison`, `directory` and `files`. The operator adds authenticated `_downloads` for its current Workspace. Scientific-source retention adds `report_source` and `delivery_selection`; export adds the actual archive identity. The saved comparison schema is `upstate.implementation-qc-comparison/v1`.

The comparison's `original.before` and `original.after` preserve each plan revision, original report ID and review ID. Each pair contains both complete original groups, both metric names and values, `after_minus_before`, `delta_unit`, its comparable/withheld result and every reason. Consumers should preserve those original fields instead of reducing the result to a pass count.

## Inspect the exact outgoing product

The producing reviewer opens the current application and looks at its actual rendered output. Follow one full populated course through original saved reviews, explicit group matching, comparison detail, save, export and independent reopening. Inspect a useful screenshare width and a narrow phone width, including the original result, criterion and reason text.

Exercise the applicable unmatched, unavailable, empty, loading and error states. Confirm that a source or Workspace switch does not display a stale comparison from the preceding selection. Open the actual downloaded report and package contents, and verify that the original source identities remain intelligible to another scientist.

Repair clipped tables, unreadable labels, stale selections or broken downloads in the maintained source and repeat the affected real interaction. Source review and scripted checks support this work; the producing reviewer still inspects the actual pixels and operates the outgoing version.

Keep the original scientific operation, browser receiving course and existing project owner. This comparison consumes retained QC reports and does not start another model solve.

## Source and method context

- [Original sample QC and follow-through guide](../model/IMPLEMENTATION_QC.md).
- [Simulated headwaters field chapter](SIMULATED_FIELDWORK.md), including its exact original input records, criterion declarations and native continuation.
- [Original field/QC browser operating course](SIMULATED_FIELDWORK_BROWSER.md), including the same recorded rehearsal and independent downloads/reopening.
- [EPA National Functional Guidelines for Inorganic Superfund Methods Data Review, January 2017](https://www.epa.gov/sites/default/files/2017-01/documents/national_functional_guidelines_for_inorganic_superfund_methods_data_review_01302017.pdf).
- [EPA New England Environmental Data Review Program Supplement, April 2013, section 2.8](https://www.epa.gov/sites/production/files/2016-04/documents/epa-ne-edr-supplement.pdf).

Use each primary reference within its stated analytical and project scope. The comparison preserves the actual reviewer-entered source and applicability instead of imposing an external threshold.
