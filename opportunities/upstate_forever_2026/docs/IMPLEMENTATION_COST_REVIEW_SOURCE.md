# Review saved implementation costs in the original Economic desk

This source consumer connects one exact saved FIELD12 candidate and its existing ledger to the original economic scenario that produced that candidate. It prepares a reviewed decision input for the maintained EconomicWorkbench. The original ledger, task assignments, modeled quantities and model runs remain unchanged.

## Public API

    cost_context(saved_plan, candidate_id)
    preview_cost_review(saved_plan, candidate_id, review)

Both functions are pure consumers of the selected saved plan. The native provider must obtain that exact plan revision from ImplementationStore before calling them. It must preserve plan_id, revision, document_digest, candidate_id and the reviewed operation_id through the original queue. It then gives preview.proposed_input to the existing economic.draft.save or economic.edition.build action. The consumer does not create a second ledger, run a model or save an economic edition itself.

Original-source identity failures raise ImplementationError. An incomplete operator review returns can_apply=false, proposed_input=null and a precise issue; the original context remains available to complete the selection.

## Exact source binding

The candidate's source_link_id resolves to its retained source_links entry and full upstate.implementation-economic-source/v1 snapshot. The consumer verifies the snapshot's source digest, re-derives the exact selected row and source link through maintained import_selection, verifies the original economic edition identity, and compares the candidate's physical benefits with the original source row.

The binding retains the plan ID/revision/document digest, candidate ID, source-link ID/source digest, economic edition ID, selected run ID, producer report ID/source SHA256 and reporting zone. The native provider must still use the existing EconomicWorkbench source/member verification when creating the new edition. A retained snapshot does not substitute for an unavailable native report file.

## Separate ledger meanings

Native budget_lines use nonnegative integer USD cents. A task_id links a row to its actual task; task.candidate_id provides its original attribution. These meanings remain distinct:

| Original kind | Review treatment |
|---|---|
| budget | Retained planning context. Never added to observed expense. |
| commitment | Retained obligation context. Never automatically added to actual expense or remaining forecast. |
| actual | Can be explicitly classified as capital, operating or excluded. |

The same invoice can appear at several accounting stages. Adding budget, commitment and actual would count different stages as separate expenditures. This operation never performs that addition.

Every actual row linked to the selected candidate needs an explicit classification or exclusion. Other candidate and unattributed actual rows start excluded, and may be included only with a reviewed attribution_reason. Partial row allocation is supported with amount_minor and allocation_reason; the original full amount and task attribution remain in the audit. This assigns a cost share in the review, without altering the original ledger.

Actual rows dated after the review's as_of cannot be included. An undated included row requires acknowledge_undated=true. All original rows, including future, undated and excluded rows, remain in the retained source audit. Repeated included task/date/reference/amount combinations appear as a review warning; the operation does not merge or discard original ledger IDs.

## Cost construction

The reviewed capital input is:

    explicitly allocated actual capital + explicit remaining capital estimate

The reviewed annual operating input is an independently entered constant annual forecast. Dated actual operating expenses remain historical context and are not extrapolated, annualized, or added again to that forecast.

The remaining-capital estimate should state its actual scope in its source and note, including any outstanding commitments that the operator intentionally includes. No formula such as budget minus actual or budget plus commitment supplies that estimate.

Both forecasts use nonnegative exact USD cents and retain their source title, reference, as-of date and note. Their source dates cannot follow the selected review date. An explicit zero forecast is allowed with its stated source basis.

The existing economic calculator treats capital as one upfront amount plus a constant annual operating cost. Historical expense dates are preserved as source context; this consumer does not restate past payments to a different price date or discount them from their original transaction dates. The result is a reviewed screening cost basis under that maintained model.

The original cost horizon and real discount rate remain unchanged unless financial_parameters is explicitly supplied with a review reason. An originally uncosted scenario needs those parameters explicitly. discount_rate is a fraction: 0.03 means 3 percent. Preview cost arithmetic uses the maintained decision_analysis._costs implementation.

The resulting cost is USD. If the original scenario's cost uses another currency, acknowledge_currency_change=true is required. This replaces the scenario's cost basis with the reviewed USD input; it does not convert the former cost, other scenarios or the original budget.

## Review selection

The selected schema is upstate.implementation-cost-review-selection/v1.

    {
      "schema": "upstate.implementation-cost-review-selection/v1",
      "as_of": "YYYY-MM-DD",
      "row_decisions": {
        "<original-ledger-row-id>": {
          "classification": "capital | operating | exclude",
          "reason": "<original review rationale>",
          "amount_minor": "<optional integer allocation, never above original amount>",
          "allocation_reason": "<required for a partial amount>",
          "attribution_reason": "<required for shared or unattributed rows>",
          "acknowledge_undated": false
        }
      },
      "remaining_capital": {
        "amount_minor": "<exact integer USD cents>",
        "source": {"title": "<estimate title>", "uri": "<actual reference>", "as_of": "YYYY-MM-DD"},
        "note": "<remaining work and included commitments>"
      },
      "annual_operating": {
        "amount_minor": "<exact integer USD cents per year>",
        "source": {"title": "<forecast title>", "uri": "<actual reference>", "as_of": "YYYY-MM-DD"},
        "note": "<constant annual forecast basis>"
      },
      "financial_parameters": {
        "horizon_years": "<positive number; optional when retaining the original cost>",
        "discount_rate": "<nonnegative fraction>",
        "reason": "<reason for these reviewed parameters>"
      },
      "scope": {
        "kind": "whole_scenario | reporting_zone",
        "note": "<actual implementation cost footprint>"
      },
      "note": "<overall review rationale>",
      "acknowledge_currency_change": false
    }

The placeholders above describe fields, not a runnable financial example. Omit optional amount_minor to select the original whole row. An excluded row contributes zero; an explicitly supplied excluded allocation must be zero. Omit financial_parameters to retain the original cost horizon and rate.

A reporting_zone scope automatically binds the proposed cost to the original producer report and zone. A whole_scenario scope remains the complete original scenario footprint. No cost is prorated by reporting area, raster support or pollutant benefit.

## Context and preview

cost_context returns schema, edition, binding, plan, candidate, source_link, original_economic_input, original_cost, original_cost_summary, original_physical_outputs, ledger_rows, ledger_source_links, ledger_attachments, ledger_totals_minor, candidate_ledger_totals_minor and interpretation.

Each ledger row includes its original row and original task, ID, kind, integer amount, date/reference, task/candidate attribution, available classifications and whether a decision is required. Known source associations are collected with the maintained implementation._source_references reader from the original row and task. source_link_ids names matching retained plan links; unresolved_source_references preserves unmatched declared references. The free-text ledger reference is not guessed to be a file ID. ledger_source_links retains every matched original source descriptor. The native provider can verify and retain associated local-file bytes as review companions before building the economic edition; this pure consumer does not read those files. Totals by kind are provided separately for the entire plan and for directly attributed candidate rows.

preview_cost_review returns schema, edition, operation_id, binding, context, normalized review, summary, issues, can_apply, proposed_input and source_audit. Normalized review can be submitted again without changing its effective operation identity.

The summary includes selected actual capital and operating totals, remaining capital, total capital, annual forecast, included/excluded row counts, separate candidate budget/commitment/actual totals, horizon/rate/footprint and the original calculator's calculated_cost. Unknown original cost remains null.

## Complete original decision selection

The proposed input keeps report_id, report_sha256 and zone_id from the original economic edition. It deep-copies the complete original selection and changes only the selected run's cost. Other scenario costs, physical comparison, targets, budget, cohort and retained metadata survive unchanged.

The selected cost's source identifies the actual saved plan revision and review operation. The complete review is embedded under:

    selection.field12_cost_reviews[operation_id]

That source record retains the full original economic source snapshot, candidate, original economic input, every original ledger row and task, explicit classifications/allocations/exclusions, forecast sources, as-of, original-kind totals and interpretation. The ordinary selection.json and complete economic export therefore carry the review's original basis. Previous retained cost reviews are preserved.

The source model is model/implementation_cost_review.py. The provider and existing EconomicWorkbench own queued operation persistence, verified source availability, final build and download/reopening behavior.

## Original evidence companions and completed-edition replay

The context's ledger_attachments contains one descriptor per unique canonical evidence path. Each descriptor has path, bytes, sha256, source_link_ids and sources; sources retains the exact source_link_id, original same-plan reference and original_filename for every alias. Paths use the maintained evidence convention:

    evidence/<original-sha256>/<maintained-safe-original-filename>

Only exact associations discovered by the original _source_references helper are admitted. The full original source objects appear in source_audit.associated_source_links (also retained as ledger_source_links). Local-file metadata is validated through the maintained implementation_evidence._links contract, including same-plan attachment references, byte/hash declarations and original evidence capacity. External and other source links remain full original metadata and are not silently downloaded.

source_audit.companions declares directory implementation/cost-reviews/<operation_id>, its relative path basis and the complete descriptor list. This same source audit is embedded in the proposed decision selection, so exported selection.json identifies where the evidence accompanies the review. Descriptor creation does not assert that a source file was read. The native provider must verify each original regular file's bytes/SHA and retain the exact original bytes under that directory before building the economic edition. Alias references can share a retained member only when their complete declared byte identity matches.

The provider retains the full original plan separately and supplies a complete review package containing source/audit records, these evidence members and the original economic decision package. The ordinary generic economic exporter retains the full source metadata and companion paths in selection.json; it does not independently copy arbitrary FIELD12 attachment bytes. The combined cost-review package is the artifact that carries both.

Before invoking EconomicWorkbench, the provider journals the exact predicted edition ID and implementation source hashes for the frozen proposed input. A retry first validates and reconnects any recorded completed edition using the maintained full edition verifier and exact input comparison. The final review receipt pins that completed edition permanently. If an earlier engine attempt never completed, a later engine may process the same frozen reviewed input through the existing workbench after recording a new attempt; the original attempt is retained. This does not replace an already-completed edition, mutate the saved ledger, or execute retained source code.
