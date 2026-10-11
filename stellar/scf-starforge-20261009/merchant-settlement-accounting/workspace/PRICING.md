# Review pricing and retain its accounting source

The **Pricing decisions** area accepts the original saved merchant pricing
report directly. It calls the existing
[`preparePricingReportImport`](../PRICING.md) converter and keeps the exact
report bytes beside its validated accounting terms in this same workspace.

Open the workspace with the existing [server command](README.md#open-on-the-merchant-host).
Existing workspaces reopen normally; their earlier runs and terms selections
remain available. This feature adds no package dependency or alternate payment
or accounting engine.

## Complete the review

1. Download **Report JSON** from a saved version in the original merchant
   pricing workspace. Choose that report under **Pricing decisions**, name the
   review, and supply a short accounting reference when the original quote
   description needs one. The file can contain a session or retained-history
   observation. The browser uploads the exact file bytes without reparsing or
   serializing the report.
2. Choose **Review and retain pricing**. The original converter validates every
   configured alternative and creates the accounting terms. The review retains
   the original report, generated terms, original source hashes, observation
   range, full quote descriptions, operator, and import time. The current terms
   selection remains in effect while the new review is inspected.
3. Inspect the payment alternatives. Atomic amounts and USD values are displayed
   as their original decimal strings. Unknown unit costs remain `null` in the
   source and **Unknown** in the interface. Selecting an option shows its full
   asset, recipient, original quote description, and accounting reference.
   Download either original file whenever needed.
4. Compare against original source terms or any retained accounting choice.
   The comparison uses the original accounting option identities. It shows
   added, removed, changed, and unchanged alternatives, with exact before/after
   quote, cost, amount, and reference values. Complete source and assumption
   context is available below the table.
5. Choose **Use these accounting terms**, then give the reconciliation a name
   and choose **Reconcile with these terms**. The existing selector and run
   queue own those actions. The run checks that the reviewed terms are still
   selected and captures their original pricing report with the merchant's
   selected journal, verification, and recovery inputs.
6. Open the completed reconciliation. Its **Captured pricing decision** section
   identifies the frozen report and terms and downloads either exact file.
   Existing ledger, exception review, run comparison, and archive operations
   remain available. Select source-inclusive export to include the original
   pricing report in the retained handoff.

The original pricing observation describes the pricing decision's source
range. The accounting event scope comes from the run's captured merchant
inputs. Shared monthly costs, demand targets, and challenge costs remain
pricing context according to the original converter's allocation fields.

Selecting a later review or returning to original source terms affects future
runs. Earlier reconciliations retain their own exact report and accounting
terms. Reopening the application restores the saved reviews and source choice.

## Original file custody

Each saved review records its report and terms SHA-256 values. The generated
terms use the existing immutable terms-import store; an identical prior terms
file is reused. The report is retained at
`inputs/REVIEW_ID.pricing-report.json`. Uploading the same report with the same
accounting reference returns its existing review and preserves the current
selection. A different reference creates a separately retained review.

A reconciliation using reviewed pricing adds these files and metadata:

| Retained item | Meaning |
| --- | --- |
| `sources/pricing-report.json` | Exact original uploaded pricing report |
| `sources/terms.json` | Exact accounting terms selected for this run |
| `input-manifest.json` → `pricing` | Review, operator, source range, file hashes, and original summary |

Downloads check the recorded hashes. A changed or missing retained source
returns an error before it can be selected or captured. Source-inclusive TAR
exports copy the verified frozen report and terms. The original accounting CLI
continues to reproduce the report from `sources/terms.json` and the other
captured inputs; it does not recalculate pricing assumptions during accounting.

Pricing report uploads use the converter's 64 MiB limit. Complete generated
terms and provenance must fit the original 200 KB accounting limit and 200
payment alternatives. The workspace retains up to 2,000 pricing reviews under
its existing 32 MB state/history limit. Archives retain the existing 256 MB
limit. A selected JSON file that the original converter cannot map is reported
with that converter's original reason; no alternative is removed to make it fit.

## Existing application integration

`openAccountingWorkspace` attaches `workspace.pricing`, using the same retained
workspace state, serialized writes, revision check, and history. Its methods
are `review`, `detail`, `select`, `compare`, `file`, and `runFile`. The native
accounting `begin` method additionally accepts `expectedTermsSelection` when a
caller wants the queued run bound to a particular reviewed selection.

| Method and route | Operation |
| --- | --- |
| `POST /api/pricing/reviews` | Retain `reportBase64` original file bytes and converted terms with `revision`, `name`, optional `accountingReference`, and `actor` |
| `GET /api/pricing/reviews/ID` | Original converted options, provenance, saved review, and selection state |
| `POST /api/pricing/reviews/ID/selection` | Select that review's original terms using `revision` and `actor` |
| `GET /api/pricing/reviews/ID/compare?baseline=SELECTION` | Exact comparison with `source` or an existing terms-import ID |
| `GET /api/pricing/reviews/ID/download/report` | Exact original uploaded report |
| `GET /api/pricing/reviews/ID/download/terms` | Exact generated accounting terms |
| `GET /api/runs/RUN/pricing/download/report` | Exact report captured by the completed run |
| `GET /api/runs/RUN/pricing/download/terms` | Exact accounting terms captured by the completed run |

Writes use the same original workspace request header and local-origin rules.
The browser preserves the selected file, name, and reference across a saved-state
refresh. If a revision changed, it keeps the submitted draft and offers the
existing reload, inspect, and reapply controls. Reapply uses the currently
edited file, name, and reference. If the selected terms changed before a run,
select the intended reviewed terms again before reconciling.
