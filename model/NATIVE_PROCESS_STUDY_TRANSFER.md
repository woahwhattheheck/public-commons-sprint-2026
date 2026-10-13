# Native process reports in editable Study transfers

This component joins a saved scientific-report edition to its original native process work. In Sources, prepare a scientific report from one or more actual Native process report sources. Then use that saved edition's existing **Transfer editable study** action. The maintained transfer queue previews the complete dependency selection, writes the ordinary project archive and verifies the received project through the same restore workflow.

The component is an extension of the saved scientific-report transfer. It does not create another archive format, renderer, numerical model or source importer.

## What travels with the saved report

The saved scientific edition keeps its original reading order and complete PDF/HTML/report-source products. For each native process source, this adapter verifies the actual native-process source URI, source ID, metadata, immutable identity and original recipe inputs before following editable records.

| Retained item | Original binding |
| --- | --- |
| Process report | Original native-process identity digest and source-body hash |
| Baseline and alternatives | The complete original ordered run ID array; first run remains baseline |
| Model scope | The report's actual selected NDR/SDR stages |
| Producing execution | Captured version basis, original implementation and each stage identity |
| Native outputs | Original output descriptors, vector companions and model argument bytes |
| Parameter and landscape inputs | Original parameter profile, biophysical table and scenario records |
| Grid | Original prepared-grid identity, domain and reporting geometry |
| Process quantities | Original model packets and their exported tables |
| Report continuation | Original imported source choice and native report capture, including source-only or failed-render capture |

When the source belongs to the same project, the existing native run visitor retains each original run, prepared grid, parameter profile, scenario, original source collection and declared run files. The adapter adds the exact process capture and its own imported source edition. The archive therefore reopens both the original saved scientific report and the Native process report desk, with the original scientific work available.

A report source imported from another project retains its complete original CAS bodies and companions. Its source project and original run IDs remain explicit in the lineage receipt. The receiving project does not acquire unrelated local records that happen to share a label.

## Completed stages and later parent progress

A source can legitimately describe a completed NDR stage while the parent run is still unfinished. The adapter validates the selected stage's original completion, files, arguments, input signature, reuse binding and producing execution. It uses the maintained native run visitor, whose existing completed-run check permits an unfinished parent.

An unselected stage can finish later. Stage-specific producing runtime remains checked exactly. For the producer's historical observed-run fallback, native continuation can retain that prior runtime on the completed stage before another model updates the parent runtime. The adapter checks that retained stage runtime first, otherwise the observed run runtime. It validates the captured model's actual version and implementation while allowing unrelated runtime fields to advance. The report keeps its original fallback label and captured full runtime; it is not relabeled as stage-specific evidence.

A changed selected native stage is a different source condition. If a selected stage's original files, completion, arguments, reuse or producing implementation no longer agree with the saved report, preview identifies the mismatch. Preserve the existing report/source edition and prepare a new report from the current selected stages through the normal producer.

## Source-only and interrupted rendering

The original process producer imports its complete scientific source before rendering a PDF or HTML report. A verified source-only product or an original render failure can therefore still feed the shared scientific composer. Its selected-study transfer retains the original capture, source identity and available files.

No completed parent-run state or rendered process PDF is invented. The saved scientific-report edition selected for transfer must itself satisfy the maintained completed-edition contract. Its source's original process state remains unchanged.

## Maintained integration

The additive helper is:

```python
from . import native_process_study_transfer
native_process_study_transfer.include_source(closure, collection_id, entry)
```

It returns `False` for another producer and `True` after validating and retaining this producer. It is called only by `scientific_report_study_transfer._source`, after the selected ordered source collection is queued through `closure.need("sources", collection_id, ...)`.

The helper writes its typed original binding into the existing `closure.report_source_records`. The maintained report lineage receipt and receiving verification preserve it. Generic source traversal stays unchanged, so older selected-study receipts keep their original dependency semantics.

Reads use original CAS objects and recorded Workspace members. The adapter never calls `Workspace.source_file`, creates source views or invokes the native process producer. The helper exposes `lock_paths(closure)` for each selected same-project capture's original `.operation.lock`. The maintained transfer capture holds these locks with its original Workspace/native-model guards and per-run locks while staging. Unchanged-file checks, the verified archive writer and ordinary restore remain in the same transfer workflow.

The component fragment extends `study-transfer` and `native-process-reports` with this helper and guide. The actual generic scientific-report dispatcher is maintained by the scientific-report transfer owner and composes the single call above.

## Receiving the existing native case

Use the original receiving operation and its actual completed scientific-report edition. In the current application:

1. Reopen the original native process product, preserving its selected baseline, alternatives and completed models.
2. Open its verified source in **Scientific reports**, retaining the current ordered report selection.
3. Prepare and reopen the saved scientific-report edition.
4. Choose **Transfer editable study** and preview that exact saved edition.
5. Export its ordinary Study archive outside the active Workspace.
6. Restore through the original portable receiver and reopen the saved scientific report and native process product.

Compare the original report ID, ordered run IDs, model scope, source-body hash, producing stage identities and recorded relationship. Same-project native runs, grids, profiles, scenarios and process files must remain available. Source-only or failed process rendering remains recorded as such.

The original Gura native case, completed regional source-water case and explicitly simulated Piedmont demonstration retain their separate project and input identities. This component needs no additional numerical solve.
