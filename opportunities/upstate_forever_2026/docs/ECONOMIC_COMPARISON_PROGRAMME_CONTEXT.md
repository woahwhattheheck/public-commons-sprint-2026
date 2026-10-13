# Original implementation design in an Economic comparison report

This extension uses the existing saved Economic comparison source and ordered Scientific Reports publisher. It adds readable implementation design, original price provenance, reviewed forecasts and copied cost-effectiveness values to the same report. It does not run a hydrologic model, create a second source provider, recalculate an Economic edition or infer a current field condition.

Consumed direction: `opportunities/upstate_forever_2026/CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.3`. The report is intended to make the original 30 m headwaters simulation useful for a practical choose, inspect, revise and editable-handover course. The original numerical routing/profile interpretation remains with `source_tools/headwaters_parameter_course.py`; native decision margins and target screening remain with their existing saved reports.

## What the report reads

`model/economic_comparison_source.py` already verifies the complete saved comparison, its original manifest and every retained member. The new presentation additionally reads `first-edition.json` and `second-edition.json` from that captured comparison directory. Each edition's canonical digest must match the original comparison identity's first/second record digest. Its report ID, report SHA256 and reporting zone must match the saved comparison.

For every scenario, the complete original cost input in the comparison must equal the cost row in that edition's retained selection. These are original source reads, not lookups of the latest edited plan or current catalogue. The existing copied editions and their complete packages continue to travel through the source collector, scientific report and selected Study.

The original report sections remain in order. An additional compact section appears only where an original programme or reviewed FIELD12 cost source actually exists.

## Original design versus a reviewed forecast

The native cost-review operation deliberately preserves unknown original cost metadata. Thus a machine-planting successor can legitimately retain the original hand-planting `programme`, `priced_basis` and `native_binding`.

The report does not change that inheritance. It shows:

- The **original implementation design and price basis**: actual retained treatment hectares and footprint identity, class transitions, spacing, planting positions, species quantities, original planting method, proposed start and task durations.
- The **original source components**: benchmark planting, authored preparation/layout/contingency, explicit annual allowance, separate material comparison and separate assistance multiplication. Amounts are copied from retained integer cents and formatted as decimal USD; no arithmetic is used to derive a new estimate.
- The **reviewed successor forecast**: exact remaining-capital and annual-operating amounts, source title/reference/date, rationale, original saved plan/revision and as-of date.
- The **reviewed ledger decisions**: budget, commitment and actual totals remain separate; selected actual capital, observed operating history, remaining capital and explicit annual forecast remain distinct. Every row's selected amount, classification, attribution/allocation explanation and exclusion reason is retained.

A reviewed cost's pointer must be exactly `/field12_cost_reviews/<operation_id>`. The complete audit is resolved from the original saved edition's selection. Its schema, pointer and canonical operation identity are checked against the exact original binding and decisions. An absent or corrupted original audit is an error, not permission to invent a replacement forecast. The audit's run, report ID, source SHA and zone are compared with the current edition; currency, capital, annual forecast, horizon, rate, scope, review reference and date are also compared. A legitimate later manual edit can retain the old pointer: a mismatch therefore labels the audit as historical context instead of rejecting the whole comparison or misrepresenting its current cost.

Original hand-option component totals are never relabeled as recalculated machine-option totals. If the original design/price/binding is identical in both editions, that context is printed once and labeled First / Second. The reviewed forecast remains separately labeled with its actual edition. If inherited design metadata belongs to a different physical source, explicit per-edition binding flags mark it as historical design context; its hectares are not adopted as the current report's treatment quantity.

## Quantities and interpretation

Implementation treatment area is not the model's common finite-cell support or the reporting-zone area. The programme binder has its own original native footprint and exact class-transition gate. This report preserves that binding; it does not substitute a reporting area or recompute a treated area from pollutant outputs.

All physical baseline, alternative, signed avoided export, units and support remain the existing saved comparison values. The original completed Economic `annualized_cost_per_unit`, units and basis are also copied into a small table. Unavailable values stay unavailable. Separate nitrogen, phosphorus and sediment axes are not added.

The original course's profile comparisons retain their own baselines and actual support groups. This report does not turn a descriptive parameter range into a confidence interval, or combine independent support groups. ECHO's original pre-delivery source-loading accounting is not substituted for native stream-delivered export. No source-to-stream retention fraction, intake concentration, field-effect claim or species/spacing hydrologic response is inferred here.

The authored restoration programme uses an original land-cover endpoint. Its species mix, establishment lag, mortality, maintenance schedule and price assumptions do not constitute a rerun of the physical model. A matched-control planting benchmark does not establish riparian practice eligibility.

## Source-price distinctions

The retained price rows explicitly distinguish FY25 scenario benchmarks, FY26 assistance rates and SCFC material prices. Their original units, printed page, scope and exclusions appear in the report; complete publisher metadata and source rows remain in the saved input.

Assistance is not a full installed cost. Material-only prices are not added a second time to a complete planting benchmark. The original programme records whether either amount entered capital; the report displays those actual flags. No grant award, future fiscal-year availability, current contractor quotation, automatic inflation or actual expenditure is inferred.

Unpriced scope, species suitability and establishment limitations remain visible. Dates and durations are editable planning assumptions, not proof that work occurred.

## Use the existing report course

After saving the original Economic editions and their comparison:

1. Open the saved comparison in the existing Economic desk.
2. Prepare its scientific-report source through the existing comparison report action.
3. Review the original design and reviewed forecasts in the preview/source context.
4. Open or append the returned exact source pair in the maintained ordered Scientific Reports composer.
5. Render, export and reopen the complete report or selected Study through the existing native controls.

The existing CLI is unchanged:

```sh
python -B -m model.economic_comparison_source \
  --workspace ORIGINAL_WORKSPACE \
  --comparison-id SAVED_COMPARISON_ID \
  --preview
```

Use the returned source key and operation ID for the corresponding existing import command. Optional `--delivery-selection` keeps the operator's existing ordered source selection; it does not replace unrelated scientific sources.

## Edition and replay

The source presentation edition advances to `economic-comparison-scientific-source-20261013-v2-programme`. New previews bind the actual adapter source hash and new recipe. Original comparison members and their identities are unchanged.

A retained prior source key still selects its original captured recipe and original operation. The existing completed-source verification and handoff binding remain unchanged. No historical report is silently rewritten merely because the formatter or adapter was upgraded.

The public provider, queue, original publisher, Study transfer and received comparison opener remain the same. This is a source presentation successor, not a new native solve or a second report service.

## Required actual receiving and visual review

The producer must use the existing original native receiving course. Open the actual completed original and reviewed editions, create the source, render the PDF/HTML/Markdown/data outputs, export their complete package and reopen it independently. Verify original physical quantities and the exact original/restated forecast distinction using the retained input JSON.

Per repository `AGENTS.md` version `2026-10-13.1`, open/render and **LOOK at the exact outgoing product and attachments** at desktop and narrow width. Operate the actual source/report controls, downloads, saved-source reopening and received Study. Capture accessible screenshots, but do not treat screenshot capture as visual inspection. Repair actual wrapping, clipping or misplaced units in the existing formatter rather than changing the scientific quantities.

Source review is not a claim of Python execution, native report completion or browser inspection. The same native course owns the first actual traceback and final client-visible verification.
