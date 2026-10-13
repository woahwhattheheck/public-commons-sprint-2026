# Original Eighteenmile laboratory request-to-report receiving cycle

This companion runs the complete native workflow using the three retained public WQP sources and the prepared original sample plan. The request is authored for the current software receiving demonstration; its analyses use the actual source activity IDs, parameters, units, fractions and methods. Original 2023 laboratory measurements remain unchanged.

## Source case

The original result CSV has 88 rows: 82 numeric results and 6 censored results, at three lake stations. The explicit `lab-request.json` contains one analysis order for each exact original sample activity. Its two recorded parameters are `Microcystins/nodularin` and `Chlorophyll a, corrected for pheophytin`.

The request carries original `ug/L` units; for the six censored records whose result unit is blank, the original reporting-limit unit supplies the existing explicit importer fallback. Chemical basis is unstated. Original fraction and analytical method identifiers remain exact. The request’s laboratory field is blank because this source case does not name a laboratory.

The source CSV is pinned to 47,412 bytes and SHA256 `5b22e3de1a4311963b2ed616886273788bd485897f276663157a7137ce0aaa61`. The request is pinned to SHA256 `808c6874d007ac2efd2ab05c4076dd1d0aee78f0cce1ebcbb254779513aed795`. At receiving time the command rechecks all 88 original activity/site/analysis joins against those bytes.

## Run in the existing native receiving operation

From the original application directory:

```sh
python -B -m source_tools.receive_wqp_laboratory_cycle \
  --workspace ACTUAL_DEDICATED_OBSERVED_WORKSPACE \
  --create-workspace \
  --workspace-title 'Eighteenmile original field observations'
```

Use the accepting worker’s actual interpreter. `--create-workspace` is explicit and defaults false; an existing workspace reconnects normally. `--source-directory` and `--case-directory` retain the original receiver’s defaults and can identify another existing checkout of the same pinned source case. `--actor` records the actual actor when supplied.

The original `source_tools.receive_wqp_field_results` command remains available unchanged. This continuation calls its maintained `receive` API before continuing the same historical seed and applied laboratory revision. A later edited working plan is not substituted.

## Native steps

1. Reconnect or receive the actual original sample plan, raw result CSV, saved laboratory import, native observation source and original field report.
2. Read the preserved empty-result `seed_revision` and the exact laboratory `applied_revision` returned by that receiver.
3. Review and prepare the explicit current demonstration request against the seed revision using the native dispatch API.
4. Reconcile the actual applied results against that request. The source case resolves 88 returned records, preserving 82 numeric and 6 censored original types.
5. Prepare the laboratory reconciliation report source, composing the exact baseline `observed_report_source.delivery_selection`. Existing field observations, coverage sections, sources and figures travel with it.
6. Collect that original source with `observed_context.collect` and render HTML, Markdown, structured JSON and PDF through the maintained scientific formatter.
7. Retain a complete report manifest and a streaming ZIP containing every report asset and original source companion.

The standalone source report uses an observation/laboratory subtitle and footer. It does not require a model baseline raster. The original model-based client delivery remains a separate available application workflow.

## Retained output and retry

Outputs live under `implementation/receiving/wqp-laboratory-cycle/<operation_id>/` and the returned paths are workspace-relative. `result.json` names the original seed/applied revisions, dispatch ID, native reconciliation, source result counts, observation IDs, actual report collection/binding, all scientific outputs, ZIP and complete file descriptors.

The cycle identity includes original source/request hashes, baseline operation, saved revisions, native reconciliation, report source edition/binding, formatter source hash and cycle source hash. A new derived report edition creates a new retained cycle without replaying an already accepted laboratory import into a later plan.

Completed report manifests verify every retained member before reopening. If an earlier rendering ended before its manifest was written, its directory is preserved as an interrupted report before the command renders again. A complete report whose final cycle receipt was interrupted is reused. The ZIP is streamed and checked against the original member set, lengths and SHA256 values; an incomplete earlier ZIP is preserved before replacement.

## Source integration

Additive files:

- `source_tools/receive_wqp_laboratory_cycle.py`
- `observations/eighteenmile_2023/wqp_20261013/field-intake/lab-request.json`
- `observations/eighteenmile_2023/wqp_20261013/field-intake/LABORATORY_CYCLE.md`

The native application also needs `model/implementation_dispatch_report.py`, the current dispatch APIs, maintained original WQP receiver and its original source case, and the scientific formatter’s optional `subtitle`/`footer` parameters. Register the report module in the FIELD12 installer file list. Preserve the current implementation/provider/browser/source union when composing that installer.

Normal application archives already include `source_tools`, model modules and the retained workspace/source files. A standalone installer intended to carry this original receiving case should include the receiver, original field receiver, the full original field-intake case and all three pinned WQP CSVs together.
