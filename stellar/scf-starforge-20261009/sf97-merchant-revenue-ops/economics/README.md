# Supplier costs in the merchant pricing workspace

Use this workspace to retain the supplier's original bill, credit note or quotation, allocate its amounts to the merchant's routes, and carry the reviewed cost basis into the existing SF97 pricing decision. It opens beside the original merchant pricing page and uses that page's current seller configuration and captured traffic.

The source documents, their classified line editions, allocations and saved pricing reviews have separate identities. This lets an operator correct a supplier document or change an allocation without rewriting the earlier decision.

## Open the existing merchant

Start the original pricing workspace with its existing seller configuration and either its operations listener or retained operations export. Open `/economics` on its printed loopback URL. The page follows Saved pricing source, Original cost and usage files, Map charge columns, Charges and allocations, Cost scope and coverage, Review and save, Saved editions and comparison, Apply costs to pricing, and Exports and recovery. Existing host captures can be supplied with `--supplier-usage FILE` and `--accounting-report FILE`; retain their original files and use the selected captures as source context. The existing startup, private-state and source-selection instructions are in [Merchant pricing workspace](../WORKSPACE.md).

Use the same merchant configuration that supplied the route IDs in the selected traffic. For a period review, choose the original retained history and its actual effective interval. The original history service reports retention clipping; retain that interval when deciding how much supplier cost the period covers.

## Bring the supplier's original records

Upload the original file first, then classify and map its contents. Each immutable original can be at most 16 MiB. Give the source a title that another operator can recognize, such as the supplier, account label, native document number and service period. Keep account labels, document numbers and line references as text, including leading zeroes and punctuation.

| Source kind | Useful original input | Role in the review |
| --- | --- | --- |
| BILL | Supplier invoice, debit statement or documented billed charge | An explicit supplier charge, with the source's own amount, currency and period |
| CREDIT_NOTE | Supplier's credit or adjustment document | A signed reduction to the corresponding cost basis |
| QUOTE | Published tariff, dated offer or provider quotation | A separately identified proposed or estimated cost |
| USAGE | Original supplier quota snapshot, provider usage export or request record | Quantity and coverage context |
| ACCOUNTING | Original merchant settlement/accounting report | Payment-option totals, classifications and source lineage |
| SUPPORT | Contract, explanation, correspondence or other supporting original | Context for an entered line, allocation or period decision |

A provider's call allowance measures its own quota units. It does not establish that every reserved call was billed. In the maintained supplier quota engine, the allowance is reserved when a request enters supplier dispatch; cache hits and later provider outcomes have different behavior. The account snapshot also lists configured route membership. Membership alone does not measure a route's share of supplier charges.

Keep quota observations as USAGE sources. Use the supplier's charge record or an explicitly identified quotation for monetary lines. The [original supplier account guide](../../sf30-seller-sdk/supplier-quota/README.md) defines the actual dispatch, rolling-window and cooldown semantics.

## Map or enter the monetary lines

For a CSV, choose comma, tab, semicolon or pipe as its actual delimiter. The parser accepts at most 10,000 data rows, 256 columns and 65,536 characters per cell. Headers must be unique and have no surrounding padding. Correct an unsuitable export in a separately retained working file rather than concealing its header differences.

Map each needed field explicitly to a source column or a constant. The available fields are `reference`, `supplier`, `kind`, `currency`, `amount`, `quantity`, `unit` and `description`. Trimming is an explicit mapping choice. Check the source column for the amount, currency and native line reference before saving. Keep all the original upload's columns even when only some are mapped.

The workspace assigns a stable line ID from the source UUID and its one-based data row. The supplier's `reference` remains a separate field; duplicate invoice references do not merge different source rows. Every mapped row is retained or has an explicit exclusion with its reason. Use exclusions for actual headings, subtotal rows or out-of-scope records, preserving their source location.

For a PDF, statement note or a small tariff table, enter the reviewed lines manually while retaining that original as their source. Use the supplier's original line reference or a stable operator reference tied to the source location. Record the interpretation of a combined charge, discount or credit in the line description or supporting record.

Amounts are signed decimal text with at most six fractional digits. Enter a decimal point explicitly and keep monetary values out of spreadsheet floating-point conversions. Bills and quotations use nonnegative amounts; credit notes use nonpositive amounts. A bill containing an original negative adjustment can retain that row as an explicitly classified `CREDIT_NOTE`; the mapper does not guess a credit from its sign. Each line uses the source currency's three-letter uppercase code. Quantities are nonnegative exact decimals with a named original unit, and separate currencies and quantity units remain separate.

A quotation is its own cost basis. Reclassifying a public tariff as a BILL would change the meaning of the record. When a later bill arrives, retain that new original and its new line edition so the quotation and billed amount can be compared.

### A provider tariff as a quotation

The [Linkup pricing page](https://docs.linkup.so/pages/documentation/platform/pricing), checked on 2026-10-11, lists API-key standard search at USD 0.005 per successful request and a standard sourced answer at USD 0.006. Keep the selected depth and output type with each QUOTE line. Its prepaid and promotional-credit arrangements require the account's original billing records to establish money paid. A selected quantity can support a cost estimate; record that quantity and its basis explicitly.

## Allocate costs to routes

Use the existing merchant route identity for every allocation. Allocate a source line's signed amount among the routes that actually use that charge. Preserve a shared or unresolved portion as the displayed unassigned remainder.

For example, an original positive line of USD 12.000000 can retain explicit allocations of USD 7.000000 and USD 4.000000, leaving USD 1.000000 unassigned. That example explains the allocation arithmetic; it is not a supplier invoice or a recommendation for either route. A credit uses the same signed arithmetic and reduces its selected cost basis.

The sum of the allocations and the unassigned remainder must equal the original line exactly. Allocations record their basis as `EXPLICIT_AMOUNT`, `OPERATOR_WEIGHT` or `HTTP_2XX_WEIGHT`, with the applicable weight and explanation. For weighted splits, the implementation distributes the smallest remaining units deterministically so signed amounts and quantities are conserved. Review the resulting amounts; a weighted split is an explicit operator choice, not a supplier's measured charge split.

Do not hide an allocation difference inside a rounded per-request rate. A shared account's membership, a merchant's target sales volume, or an upstream request counter can inform an operator's allocation explanation only when the source supports that relationship.

Keep the reason for an allocation with the review. Direct source line references, a supplier's product breakdown, or a separately retained usage export are useful explanations. When the source cannot support a route split yet, leave the amount unassigned and continue reviewing the known portions.

## Review the selected period and coverage

A supplier's billing period and the merchant's traffic period can differ. In the cost edition, retain `pricingVersion`, `period.from`, `period.through`, the edition's reason and its `contextSourceIds`. Use actual `YYYY-MM-DD` dates, with `through` on or after `from`. Record the period interpretation in `periodAlignment.reason`; confirm alignment only when the retained cost and original traffic support the selected interval.

The proposal also checks each allocated source's own metadata period against the edition's exact `from` and `through` dates. A missing or wider supplier period remains visible and cannot become a per-fulfilled proposal merely by confirming alignment. Select a matching complete review interval, or retain the broader charge and its source explanation for a later compatible review.

Assess every route in the saved pricing review with `UNKNOWN`, `PARTIAL` or `COMPLETE` coverage and a note. Complete coverage describes the cost sources covering that route and period. An absent bill is not a zero charge. If the source supports a route having no cost, use the explicit `zeroCostConfirmed` decision and explain its basis.

Review the original captured HTTP-2xx denominator before creating a per-fulfilled cost proposal. Upstream started/completed counts can include failures before supplier dispatch. Provider calls, billed requests, successful customer responses and native settlement records are distinct observations.

Retain any missing or clipped traffic, shared charge, unassigned amount and source coverage explanation in the saved assessment. Refreshing live operations creates another source selection; it does not amend an earlier saved period or pricing review.

## Reconcile amounts and currencies

Review billed costs, credits and quotations in their own groups. A source credit may leave a route with negative net cost for the selected period. Keep that result visible with the original credit rather than forcing it into the existing nonnegative SF97 per-fulfilled cost field.

USD and other currencies remain separate. A non-USD supplier amount is still useful in the source and allocation report, but it cannot silently become a USD pricing term. Retain any actual conversion record as its own source and keep its date, currencies and basis explicit; this workflow performs no automatic foreign-exchange conversion.

The [original merchant accounting report](../../merchant-settlement-accounting/README.md) preserves native atomic amounts by their complete payment-option identity. Its transfer-matched merchant USD quote is a quoted value based on the merchant's approved terms. It does not establish a realized USD payout. Use the original classification and amount fields in the economic review.

## Compare corrected source editions

If a mapped column, signed amount, currency, source classification or native line reference needs correction, save a new edition against the retained original. If the supplier issues a replacement document, upload that document as its own original before creating its lines.

Compare the earlier and later editions using their retained source identities. Review which lines changed, which allocations remain attached, and which cost totals or coverage decisions changed. Preserve both versions in the merchant's history. A previous saved pricing decision continues to identify the exact cost sources that informed it.

A credit note is a distinct original event. Keep the invoice and credit together in the review; replacing the invoice with its net total would remove the supplier's original adjustment history.

## Carry a reviewed cost into SF97

Select `BILLED` or `QUOTED` as the proposal basis, the period and the route coverage assessment, then review the proposed per-fulfilled USD cost. Bills and their signed credit notes inform the billed basis; quotations remain the quoted basis. The proposal carries the cost edition and original pricing source into the existing workflow.

A usable USD proposal requires documented compatible periods, complete route coverage, no unassigned money, no non-USD cost for the route, a positive original HTTP-2xx denominator, healthy original observations and a nonnegative net cost. Missing zero cost needs the explicit zero-cost confirmation. Inspect each unmet condition and resolve its underlying source or coverage decision; the original line, allocation and economic result remain available even when they cannot populate a pricing term.

The per-fulfilled value rounds upward to one micro-USD. The exact cost/count ratio and the resulting reconstruction remainder remain visible. Thus multiplying the displayed unit cost by the original count can be slightly greater than the source amount. This pricing-field rounding does not change the conserved source allocations.

Open the existing SF97 review and inspect the proposed cost beside its other merchant assumptions. Known eligible costs can become an explicit reviewed term. Missing costs, non-USD costs or a negative net credit stay visible as their original economic result.

Save the pricing review with the source selection that informed it. The existing workflow then handles reuse of assumptions, complete payment-option review, explicit atomic price changes, seller configuration packages and retained release staging. See [Prepare a seller price change](../WORKSPACE.md#prepare-a-seller-price-change).

Keep monthly volume targets and forward cost assumptions identifiable as planning inputs. A source-based proposal can guide a price decision without changing the meaning of the merchant's original payment and usage observations.

## Reopen and hand over the review

Return through the same private merchant workspace to reopen its uploaded originals, saved line editions, allocations, period assessments and linked pricing decisions. Choose `COST_EDITION` to export the selected private cost edition and its retained originals. Choose `WORKSPACE_BACKUP` to preserve the complete pricing-and-cost workspace for recovery. Each TAR includes an exact file manifest and is limited to 512 MiB. A full backup records its pricing, price-decision and cost revision boundaries and retains every cost edition referenced by that pricing prefix, including a proposal saved while export capture is in progress. The full backup includes the captured original pricing, repricing and cost chains and originals, plus the committed scenario plans selected before the pricing boundary; prior exports, pending attempts, live environment values and external seller-release runtimes are outside that backup.

A saved scenario plan keeps its original plan ID, complete original record bytes and source pricing version. The backup descriptor lists these under `snapshot.scenarioPlans`; a plan added after that selection belongs to a later backup. Restore reopens those same comparisons in the maintained [Scenario planning workspace](../PLANNING.md).

Keep the original SF97 report and release handoff with the chosen price decision. A cost-edition export and a complete workspace backup serve different receiving tasks.

A useful operator handover identifies the merchant configuration, supplier and account labels, source documents and service periods, chosen cost basis, any unassigned amount, the coverage decision, and the saved SF97 review. The receiving operator can then trace a displayed cost back to its original source and review the actual decision without reconstructing it from a screenshot.

## Retained cost-edition fields

| Field | Operator use |
| --- | --- |
| `label`, `reason` | Identify this review and explain what changed |
| `pricingVersion` | Pin the original pricing capture used by this edition |
| `period.from`, `period.through` | Retain the selected original review interval |
| `periodAlignment.confirmed`, `periodAlignment.reason` | Preserve the documented relationship between cost and traffic periods |
| `contextSourceIds` | Link the original usage, accounting or supporting captures |
| `imports`, `lines` | Retain explicit mappings, exclusions and the reviewed original monetary lines |
| `coverage` | Preserve each route's coverage state, note and explicit zero-cost decision |
| Line `allocations` | Preserve route ID, signed amount, optional quantity, basis, weight and reason |

## Recover the whole private workspace

Use the original workspace command and a new private state directory:

```bash
node stellar/scf-starforge-20261009/sf97-merchant-revenue-ops/workspace/cli.mjs \
  --config /private/merchant/seller-service.json \
  --snapshot /private/merchant/original-seller-traffic.json \
  --restore-cost-workspace /private/merchant/pricing-cost-backup.tar \
  --state /private/merchant/restored-pricing-cost \
  --port 8457
```

Continue to provide the merchant's original configuration and its selected original source inputs: `--snapshot`, `--history` or `--ops-url` as described in the main workspace guide. Restore writes the verified retained files directly beneath the new `--state` directory. If that restore is interrupted, use the same archive and directory to continue its incomplete restoration. An incomplete restore cannot open as a completed workspace.

Open the printed loopback origin and revisit the saved pricing review, selected cost edition, original uploads and comparison. Recover the external seller release through its original release lifecycle when that is also needed; the cost workspace backup does not recreate a running merchant or supply its live credentials.

## HTTP integration

The economics surface retains the original workspace's exact Host, Origin and token checks. Use its existing private browser session or an authorized local client. Never place the workspace token or supplier credentials in an uploaded source, reference URL or exported guide.

| Interface | Contract |
| --- | --- |
| `GET /api/economics/state` | Read the current economics state and revision |
| `POST /api/economics/list` | Page `SOURCES`, `PRICING`, `EDITIONS` or `EXPORTS` using `kind`, `after` and `limit` of at most 100 |
| `POST /api/economics/pricing` | Open an original saved pricing source |
| `POST /api/economics/source-inspect` | Inspect a retained original, including recognized native usage and accounting formats |
| `POST /api/economics/map-charges` | Apply the explicit source mapping and retain original row identities |
| `POST /api/economics/capture` | Retain the selected original host context |
| `POST /api/economics/weights` | Calculate the exact conserved weighted allocations |
| `POST /api/economics/preview` | Review the proposed cost book before saving |
| `POST /api/economics/save` | Save `{requestId, expectedRevision, book}` |
| `POST /api/economics/edition` | Reopen a saved edition |
| `POST /api/economics/compare` | Compare `{before, after}` editions |
| `POST /api/economics/proposal` | Prepare `{edition, basis, routeIds}`, with `basis` equal to `BILLED` or `QUOTED` |
| `POST /api/economics/apply-pricing` | Use the proposal fields plus `proposalSha256`, `requestId`, `expectedPricingRevision` and `label` to save a new original SF97 review |
| `POST /api/economics/export` | Export `{requestId, kind:"COST_EDITION", edition}` or `{requestId, kind:"WORKSPACE_BACKUP"}` |

Raw source upload is `POST /api/economics/uploads/UUID`. Send the original bytes as the body, the original workspace token in `x-sf97-workspace`, and URI-encoded JSON source metadata in `x-sf97-source`. Metadata identifies `label`, original `name`, source `kind`, `supplier`, `reference`, optional `period`, `note` and optional credential-free HTTPS `url`. Use a fresh source UUID for a new original; an exact retry of the same source request retains that request's identity.

Downloads use the returned `/cost-files/source/UUID`, `/cost-files/edition/UUID/NAME` and `/cost-files/export/UUID` URLs within that private workspace. Preserve the actual returned IDs and filenames.

For a cost save, use the current economics revision as `expectedRevision`, or `null` only for an empty economics workspace. An applied proposal separately uses the current original pricing revision as `expectedPricingRevision`. If another operator has saved meanwhile, reopen that current state and compose the intended change. Retain the request ID for an exact retry; use a new request for changed content.

Applying the proposal creates another original SF97 pricing review with its cost input, report, provenance and proposal retained. It does not silently change the live seller's atomic prices. The existing saved review and repricing/release steps perform that explicit price decision.
