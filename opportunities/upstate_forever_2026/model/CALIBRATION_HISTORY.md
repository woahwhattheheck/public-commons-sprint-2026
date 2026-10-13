# Compare selected profiles across the original evaluation history

A followed-up Calibration result includes **Selected-profile history** below the main result cards. It answers: *What changed in the selected model's annual-load errors on the same original references?* The original selected result, ranking and held-out evaluations remain available.

## Ordinary operator journey

1. Open a completed followed-up Calibration result. Expand the evaluation list to inspect each original selected profile and its training/validation group count.
2. Choose the earlier evaluation and constituent. The default is the immediately preceding evaluation.
3. Read the paired RMSE table. It reports the earlier and current selected predictions on the same original catchment references. Negative RMSE change means a smaller error on that displayed support.
4. Inspect individual catchment changes. Native load change and explicitly declared delivered external-load change are separate. Change the reference filter to inspect added, changed, removed or incomplete support.
5. Open any original evaluation to inspect its complete selection, ranking, measurements and assumptions.
6. Choose **Export selected-profile history**. Open the complete ZIP's index.html, use its full CSV tables, and inspect its original source files. The same native selected Study preserves the original records required to reopen this view in the application.

The table paginates display rows; exported CSVs retain every row. Titles, constituents, physical units and training/validation assignments remain readable. Original IDs and complete structured data are retained in the downloads.

## Scientific matching and interpretation

A paired reference has the same original observation CSV body SHA256, catchment body and companion file identities, selected source layer/filter/identifier field, original reference records, periods and temporal weights, reference method, observed annual mass and physical unit. Shapefile attribute and projection companions participate in this identity. Metadata collection IDs alone do not make identical original bodies different.

The original CSV and source-local record IDs are used together. Reused row labels in another table are different references. A changed catchment edition or changed annual aggregation remains visible as different support. This deliberately exact relation can leave scientifically equivalent re-exports unpaired; review the retained source rather than inferring equivalence from their names.

For each complete matched catchment, the view reports:

- signed residual: modeled annual load minus observed annual load;
- absolute-error change: current absolute residual minus earlier absolute residual;
- native-load change, separate from the change in declared delivered external load;
- original earlier and current training/validation assignment.

The RMSE summaries group by constituent, physical unit and the earlier/current partition pair. They use only the identical complete references in that row. Their catchment membership and sample count are explicit. Descriptive catchment RMSE is the square root of the mean squared residual. It is distinct from the original group-weighted, normalized calibration selection objective.

Earlier and current objective scores each retain their own training selection, weights, normalization and original result. The history never subtracts those objective scores, re-ranks the candidates or substitutes common-support metrics for their saved scientific design. A smaller descriptive error may coincide with changed inputs, physics, external-load assumptions or profile settings. Keep those original records available for the scientist's interpretation.

A previously viewed holdout remains previously viewed. Changed partition assignments are displayed separately, and the original follow-up reuse analysis continues to describe the reference history. The comparison does not assign statistical significance or establish fresh independent validation.

## Complete portable export

The history's identity is derived from its versioned scientific view and complete original selected-report chain. A separate directory, calibration-history-exports/<history-id>, preserves this comparison edition. Existing original Calibration exports retain their own files.

The ZIP contains:

- index.html: self-contained, grayscale scientific report with every comparison table;
- evaluations.csv: selected profile, original training loss, group counts and native identities;
- pair_summaries.csv: paired physical-error summaries and exact catchment membership;
- paired_changes.csv: individual changes plus added, removed, changed and incomplete references;
- reference_rows.csv: every selected prediction and its original scientific support;
- history.json: complete comparison, source matching definitions and retained interpretation;
- original/<calibration-id>/: original result, plan, observation metadata and unchanged CSV, selected profile, relevant Parameter continuation specification, catchment source entry, original source manifest, body and all source companions;
- manifest.json: complete file inventory with original byte hashes.

The native selected Study remains the editable application project. Its existing follow-up closure retains the original observations, profiles, runs, catchment sources and prior evaluation dependencies. Reopening derives the same history from those records. The export resumes from the same content identity, checks retained members, and preserves older completed editions.

## Native use and integration

~~~python
from model import calibration_history, calibration_history_export

view = calibration_history.inspect(workspace, completed_report_id)
package = calibration_history_export.export(workspace, completed_report_id)
~~~

The maintained operator exposes GET /api/calibration/history?id=<report-id> for the readable view and file tickets, and calibration.history.export through the existing task runner. Completed export tasks open their original Calibration result. Source/result reads perform no NDR or SDR execution.

Install the complete current Calibration application cohort. Its existing installer and component fragment include both new model modules, the browser history module, descriptor, provider and guide. Preserve current same-DEM catchment and Parameter working-design source when composing concurrent changes.

Follow the original application's AGENTS.md and current post-call work orders. In the producing native application, operate the populated comparison at desktop and390px, change its filters, page all displayed rows, export, open the HTML and every CSV/source attachment, and reopen the native Study. Use completed original evaluations and their actual source identities. Keep any native producer's running cases and source acquisitions intact.
