# Review implementation costs in the original Economic desk

In a saved native implementation plan, open **Costs → Review economic costs**. This follows one Economic scenario already frozen into a plan candidate, compares its original estimate with the actual saved ledger, and saves a new Economic input and complete edition through the existing Economic desk.

The source plan revision, ledger rows, task assignments, physical outcomes and modeled runs remain unchanged. An unsaved browser draft stays separate from the saved revision being reviewed. The portable field workbench continues to record its ordinary ledger; this native source review becomes available after that plan is saved or reconciled in its original workspace.

## Choose the exact original candidate

Choose **Saved implementation candidate**. The catalogue includes only candidates that retain an original Economic source. Each choice is bound to the original plan revision and document digest, selected modeled run, producer report and source hash, Economic edition and reporting zone.

The dialog shows the original capital, annual operating estimate, currency, horizon and real discount rate when available. **Complete frozen scenario, cost and modeled source context** and **Download original source context** preserve the full original meaning, including an originally uncosted scenario.

If the candidate is missing, use the maintained Economic desk's **Plan implementation** flow to retain the actual original scenario. A hand-entered label or an unrelated ledger row cannot supply the missing scientific source.

## Review the original ledger

The ledger table keeps three accounting meanings separate:

| Kind | Treatment in this review |
|---|---|
| Budget | Original planning context, never added to actual expense |
| Commitment | Original obligation context, never automatically added to actual expense or a remaining forecast |
| Actual | Explicitly classified as capital, operating context or excluded |

The displayed whole-plan and directly attributed totals remain separate by kind. The review does not add budget, commitment and actual together.

The default **Required decisions** filter shows candidate-linked actual rows that still need a choice. Use **Candidate actuals**, **Shared / other actuals**, **All actuals**, **Selected capital**, **Selected operating**, **Excluded actuals**, **Budgets and commitments**, or **All original rows** to inspect other records. Search matches the original row label, invoice/reference text, date, task, candidate and exact IDs.

The table shows 25 rows per page, with the full matching count and original total. **Download all matching rows** includes every matching row, its original task and current review decision, regardless of the visible page.

Choose **Review row** to inspect one actual row and record:

- **Classification:** Capital, Operating context, or Exclude.
- **Allocated amount, USD:** Leave blank to use the whole original amount. A partial amount requires its allocation reason and cannot exceed the original expense.
- **Decision or exclusion reason:** An explicit exclusion requires a reason.
- **Reason for shared or other-candidate attribution:** Required when an expense is not already linked to this candidate through its original task.
- **Undated acknowledgement:** Required before including an actual expense with no recorded date.

Choose **Keep row decision**. The selection retains the original ledger ID and source row. It does not move the ledger row to another task or candidate. Shared and unattributed actual rows start excluded; the operator can deliberately include an allocated share with its rationale.

Actual expenses dated after the review's as-of date cannot be included. A duplicate-looking invoice remains a separate original row; the native preview warns about repeated included task/date/reference/amount combinations without silently merging or discarding them.

**Inspect original**, the complete row details, and **Download original row and choice** expose the exact source row, task and attribution. Budget and commitment rows remain read-only context.

## Enter explicit forecasts

Set the **Review as-of date**, choose the actual **Explicit cost footprint**, and record both the footprint and overall review rationale. The available footprints are the whole original scenario or its original reporting zone. The preview binds a zone-scoped estimate to the existing producer report and zone; it does not prorate by map area or pollutant benefit.

Enter both forecasts explicitly:

### Remaining capital forecast

Enter the USD amount still needed to complete the reviewed implementation scope, along with its original estimate source title, reference or URI, source as-of date and scope/basis note. A deliberate zero is allowed with its stated source basis.

The reviewed upfront capital is selected actual capital plus this remaining estimate. Budget less actual, outstanding commitments, or the original estimate do not silently fill it. Explain any commitments that the estimate deliberately includes.

### Annual operating forecast

Enter an independent constant annual USD forecast, its original source title/reference/as-of date and basis note. Actual operating expenses stay visible as historical context. They are not annualized, extrapolated, or added again to the annual forecast.

Both amounts preserve exact USD cents. Their source dates cannot be later than the review's as-of date. Blank forecast amounts stay unset.

## Retain or explicitly review financial parameters

When the original scenario has a sourced cost, the original horizon and real discount rate are retained. Select **Supply reviewed financial parameters** only when you intend to replace them, and record the reason. An originally uncosted scenario requires explicit values.

The rate field uses a fraction: 0.03 means 3 percent. The maintained Economic model compares an upfront capital amount with a constant annual operating cost. Historical transaction dates stay in the audit; this review does not restate payments to another price date or discount each payment from its original date.

The FIELD12 ledger and both reviewed forecasts use USD. When the original scenario uses another currency, explicitly acknowledge replacing that scenario's cost basis with the reviewed USD input. No exchange-rate conversion is performed. Other scenario costs and any original budget retain their own original currencies.

## Preview the whole review

Choose **Preview reviewed Economic input** after recording all decisions and forecast sources. The native preview validates the exact saved revision and original scenario binding, all actual-row choices, allocations, dates, forecast sources and footprint.

The preview also displays the original comparison in the selected reporting zone with signed avoided-export values, annualized costs and the prepared decision criteria. Negative physical outcomes remain negative; the native engine reuses the retained physical comparison.

The preview shows selected actual capital, remaining capital, combined upfront capital, actual operating context, the separate annual operating forecast, horizon, rate and footprint. The full expandable preview and **Download full review and source audit** retain:

- Every original ledger row and task, including excluded, unassigned, future and undated rows.
- Explicit classifications, allocations and reasons.
- Forecast sources and as-of dates.
- The complete frozen Economic source, original selected scenario and physical outcomes.
- The complete proposed input for the maintained EconomicWorkbench.

Any edit invalidates the old preview. A new complete preview is required before saving.

**Download review selection** saves the source-bound review in its native API form. **Download browser review draft** also works while fields are incomplete. **Open review JSON** can restore either form; a bound review for another saved plan revision or candidate is rejected. The dialog stores separate drafts for each saved revision and candidate.

## Save inputs and build the complete edition

Choose **Save inputs and build Economic edition** from a valid current preview. The normal native queue saves the reviewed Economic input and builds the complete edition as one retained parent operation.

The original scenario selection is copied in full. Only the selected run's reviewed cost changes. Other scenario costs, targets, budgets, scientific source binding and earlier cost-review provenance remain with the selection. The new selection embeds the full review audit, so the ordinary Economic source and complete export retain its basis.

The resulting **Saved Economic edition** panel shows:

- The original plan revision used and the current native plan revision.
- The saved Economic input ID, selected run, original report and reporting zone.
- **Open complete Economic edition**, using the provider's verified original edition URL.
- **Open in Economic desk**, opening the retained edition without replacing the desk's existing input draft.
- Original source and edition downloads, **Refresh original receipt**, and **Download complete receipt**.

The Economic desk opens the edition's existing full comparison and ordinary controls. Its current input draft remains retained. An unresolved Economic task must be recovered before a new retained edition is opened through the desk.

The ordinary Economic decision-package.zip carries the selected scenario, cost review metadata and source paths. The complete cost-review-package.zip additionally retains the actual associated invoice/evidence bytes and the nested original Economic package. Use the complete review package when handing over both the comparison and its original accounting evidence.

No implementation-plan revision is issued by this operation. The open FIELD12 browser draft is not replaced by a historical receipt.

## Recover the original request

The browser retains the complete queued action, payload and operation ID before sending it. A network error after submission leaves the original request available as **Recover original request**. Recovery resends that same identity; it does not silently create a new review.

After a task ID is known, **Check original task** and **Open original task** follow it. An interrupted native task exposes **Resume original interrupted task**. A definitively failed or cancelled task can be downloaded and retired back to review. Unknown or active requests remain fixed.

Closing the dialog retains its review and original request. Reopening the same plan recovers the pending operation even if the latest saved plan has since advanced. Completed receipts refresh their original source and edition tickets; they never overwrite newer plan edits.

Browser storage failure is displayed explicitly. The operator can download the draft or original request, and no new request is sent until its identity has been retained.

## Integration

The native helper is operator/web/implementation_cost_review.mjs. The existing FIELD12 Costs tab loads it only in the native workspace. The original economic_desk.mjs exposes openSavedEdition({workspace_key,edition_id}), waits for its actual mount/catalog and preserves an existing input draft or unresolved task.

The source consumer is model/implementation_cost_review.py. The provider owns /api/implementation-costs/catalog, /context, /preview, /detail and action implementation.cost-review.apply. The preview's native operation_id is authoritative; the browser does not recompute its source digest. The provider and existing EconomicWorkbench verify the saved original source and own durable save/build/replay.

See IMPLEMENTATION_COST_REVIEW_SOURCE.md for the exact pure model contract and source audit fields.
