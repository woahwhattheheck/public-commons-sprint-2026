# Cohort delivery

Cohort delivery connects a saved customer adoption plan to its original frozen Cohort acceptance review. It gives the operator a complete view of scheduled purchase opportunities, original customer intents, delivery dates, accountable buyer operators, and remaining work.

Open **Grant Operations → Cohort delivery** in the original operating case. The same calculation is available through the installed `grant-cohort-delivery` command and the typed `@tokenjunkielabs/starforge-merchant/grant/cohort-delivery` module.

## Open the original plan and review

1. Save the current adoption plan from **Customer adoption plan** as an edition in the case.
2. Select the original completed or in-progress review in **Cohort acceptance** and freeze that review using its existing workflow.
3. Open **Cohort delivery**, choose the saved adoption plan and frozen cohort review, and select **Compare selected sources**.

A complete comparison JSON file can also be opened with **Open JSON**. The CLI also accepts the complete saved delivery schedule report and selects its retained candidate plan. The selected documents must retain the same original case and tranche. A different source plan revision or UTC window remains visible in the comparison's source differences.

The comparison receives the whole saved plan edition and whole native `COHORT_EVALUATION` review, including its snapshot, original purchase history, selected participants, source metadata, and rule. Download either original document from **Saved editions and sources**.

## Read the delivery report

The overview shows planned paid purchases, recorded cohort completions, recorded independent completions, remaining due opportunities, unmatched intent groups, and work completed after its planned time.

The opportunity table separates each scheduled acquisition date and named funding group. Use the search box or filter to find due work, late delivery, or adjusted outcomes. Each row retains its original opportunity identity and associated intent groups. A funding group is one acquisition with its original useful uses attached. Prepaid uses retain the planner's original acquisition count. Planned useful tasks remain a separate workload measure.

**Due remaining** means planned complete purchases due by the frozen review's observation cutoff minus the recorded complete purchases placed with that opportunity, floored at zero. Original intents that have not been associated remain visible in **Original intent placement**. Inspect those placements before treating a remaining figure as undelivered work.

The daily view gives two dates their proper roles:

- Recorded first attempts and completed-from-attempts use the original intent's first-attempt UTC date.
- Delivered-on-date uses the current completed output's actual UTC date. It includes work that finished after the original cohort window.
- Planned purchases retain their scheduled date; the comparison never shifts a plan window to fit the observations.

Recorded completions and independent completions retain the classifications from the original frozen review. That review's original targets, coverage findings, team-operated population, later completions, refunds, and cancellations remain available. The source case's **WALKTHROUGH** or **LIVE** mode is displayed prominently.

## Associate original identities

Original buyer and merchant deployment IDs match automatically when their accountable operator IDs agree. Facilitators use their original IDs and accountable operators. A useful operation also retains its original merchant, agreed scope, and expected complete output.

When the adoption plan used a proposed identity or the recorded deployment has a different original ID, open **Identity associations**. Choose the planned and recorded identities and enter the source basis linking them. This annotation belongs to the comparison; it retains both original IDs and source documents.

The comparison can use an operator's explicit association without changing the native cohort's independent-participant classification. The original review continues to supply that classification.

## Place original intent groups

One original intent group appears once even when its history contains repeated purchase observations. Automatic placement requires a single planned opportunity with:

- the associated original buyer, merchant, and useful operation;
- the same network and asset;
- the selected facilitator, when the plan names one; and
- the original first-attempt UTC date.

Two matching schedules on the same day remain ambiguous. An intent on a different date stays visible as a date mismatch. Choose **Place** beside the original intent, select the appropriate opportunity with matching identities, and record why it belongs there. The original attempt and completion times are retained.

The comparison never allocates a single intent to several opportunities. All additional original intents remain visible, including those beyond the planned count. Payment and completion amounts retain the original network, asset, and atomic-unit strings.

For a later refund or cancellation, the original gross completion remains visible alongside the current cohort result. The comparison does not revive an earlier delivered state into a current independent completion.

## Save, export, and reopen

**Save comparison edition** attaches one full comparison JSON source to the existing Operations case using its current version and recording operator. The original `source.add` journal writer owns this save. The attached JSON contains the complete original documents, associations, assignments, calculated report, and operator note.

After the writer returns, the desk reads the original source bytes again and reopens the complete comparison. It checks the source's retained byte count and SHA-256 and compares the downloaded text with the same submitted request.

If a return is interrupted, **Resume same save** reuses the retained request ID and complete original payload. **Reopen accepted source** finishes the original readback. An accepted write is retained through navigation and browser-session reload. A source/version rejection leaves the full comparison available for revision.

| Export | Contents |
| --- | --- |
| JSON | Complete editable comparison, original plan, native frozen review, and calculated report |
| CSV | Opportunities, original intents, daily measures, operators, associations, native amounts, outcomes, products, and findings |
| Readable HTML | Full operator report with original source documents embedded as readable JSON |
| Editable comparison input | Full original documents and the operator's identity and intent-placement choices |
| Original cohort archive | Existing native cohort export, including original source files |
| Complete case | Existing Operations export with original history and attached comparison editions |

The desk shows 40 opportunity or intent rows per page while exports retain every row. On a narrow screen, controls stack vertically and data tables scroll horizontally.

## Installed command

Prepare the comparison from the actual saved files:

```sh
starforge grant-cohort-delivery seed \
  --plan original-adoption-plan.json \
  --review original-cohort-review.json \
  --name "Customer rollout — recorded delivery" \
  --output cohort-delivery-input.json

starforge grant-cohort-delivery compare \
  --input cohort-delivery-input.json \
  --output cohort-delivery.json

starforge grant-cohort-delivery html \
  --input cohort-delivery.json \
  --output cohort-delivery.html

starforge grant-cohort-delivery csv \
  --input cohort-delivery.json \
  --output cohort-delivery.csv

starforge grant-cohort-delivery reopen \
  --input cohort-delivery.json \
  --output reopened-cohort-delivery.json
```

The source command is `node stellar/scf_2026/sf47_budget_model/workspace/cohort_delivery_cli.mjs` with the same subcommands and options. Existing output files are preserved. Use a new destination or stdout.

To add explicit choices, edit the complete input's `links` and `assignments` arrays. Each choice needs its original source basis in `note`:

```json
{
  "links": [
    {
      "kind": "buyer",
      "plannedId": "planned-customer",
      "observedId": "original-buyer-deployment",
      "note": "The original installation handover names this proposed buyer as the receiving deployment."
    }
  ],
  "assignments": [
    {
      "intentId": "original-native-intent-group-id",
      "targetId": "occurrence:original-schedule:2026-10-12",
      "note": "The original order retained the scheduled scope and moved its start to the following business day."
    }
  ]
}
```

The example describes the field shape. Select actual identifiers from the complete comparison's `joins`, `records`, and `rows`; each record's `candidateGroupId` selects a complete `candidateGroups` entry with its valid `targetIds`. Candidate lists are shared across matching original intents so a large cohort retains one full list per source identity group.

## Native integration and receiving

The original authenticated routes supply the input:

- `GET /api/operations/{caseId}` lists current sources and frozen reviews.
- `GET /api/operations/{caseId}/sources/{sourceId}` downloads the saved adoption edition.
- `GET /api/operations/{caseId}/reviews/{reviewId}` returns the full frozen cohort review.
- `POST /api/operations/{caseId}/command` with `action: "source.add"` records the new comparison.
- The original `cohort-reviews/{reviewId}/export.zip` and case `export.zip` routes provide complete receiving sources.

For the existing native SCF receiving case, use its already requested full review return and adoption edition: `operation-ce7a44c92e754424bbe9e7547a0d98c9`, original plan `plan-884f92ceac834ec588b3271011f1e0e1`. Its native owner can feed those same retained files to the command above, save the comparison in that same case, and reopen it after restart. The application adds a delivery view to the original operation.

The comparison engine is pure ESM and shared by the browser and Node command. It imports the maintained original cohort planner for all prospective schedules, funding quantities, and economics.

| Source | Purpose |
| --- | --- |
| `cohort_delivery_comparison.mjs` and `.d.mts` | Complete calculation, identity joins, deterministic reopening, exports, and typed contract |
| `operations_cohort_delivery.mjs` and `.css` | Installed operator desk and original case journal receiving |
| `cohort_delivery_cli.mjs` | Local complete-file interface |
| `COHORT-DELIVERY.md` | This operator guide |

The standard launch source rosters, authenticated static registration, Operations navigation, and distribution contribution include this complete arm.

## Merchant agent workflow

The installed Merchant MCP and typed client operate the same saved-source comparison as the desk and command above. The source module is `cohort_delivery_agent.mjs`; the public typed export is `@tokenjunkielabs/starforge-merchant/grant/cohort-delivery-agent`.

Start with the current original case. Select its saved adoption source by source ID and SHA256 and its complete frozen `COHORT_EVALUATION` review by review ID. The seed downloads the whole saved plan, verifies its recorded length and SHA256, and reads the original review. An optional `expectedReviewBusinessSha256` pins the selected review's business identity. The original comparison engine verifies the case and tranche and retains both complete documents.

All nine tools use the existing configured `workspace` alias:

| Tool suffix after `merchant_grant_cohort_delivery_` | Operation |
| --- | --- |
| `seed` | Read `caseId`, `expectedVersion`, `planSourceId`, `expectedPlanSha256`, `reviewId`, optional review business SHA, title and note; retain the full initial comparison |
| `edit` | Apply explicit identity associations, intent placements, title or note to the complete document and retain its complete predecessor |
| `review` | Read the current `caseId` and `expectedVersion`; verify the full original plan source and frozen review against the selected comparison |
| `refresh` | Read the newly selected current plan source and frozen review using the same source fields as seed; retain the previous explicit choices and full predecessor |
| `prepare` | Prepare one original source request using `caseId`, `expectedVersion`, `requestId`, `actor`, `note`, `createdAt` and the complete reviewed document |
| `save` | Commit the verified prepared file using its returned `preparedSha256`; retain the original response and recover its complete saved source |
| `request` | Reopen the retained request by case, request ID and prepared SHA; inspect its original native event and accepted response |
| `open` | Reopen the complete saved comparison using `caseId`, `sourceId` and `expectedSourceSha256` |
| `export` | Retain all JSON, CSV or readable HTML bytes from the complete document |

For document-taking tools, supply the full `inputs` object or the existing verified `input` reference with `expectedInputSha256`. A reference can select an original host input, retained snapshot or completed transfer. `inputPointer` selects a complete document inside an original response. The returned snapshot identifies the retained whole file; read its complete bytes through `merchant_grant_file_read`. Saving uses a verified reference to the entire prepared object and its separate `expectedPreparedSha256`.

### Associate and place the actual recorded work

The complete comparison exposes `document.joins`, `document.records`, `document.rows` and `document.candidateGroups`. Use their original identifiers to build the edit:

```js
const changes = [
  {
    action: 'LINK_IDENTITY',
    kind: 'buyer',
    plannedId: selectedPlannedBuyer.id,
    observedId: selectedRecordedBuyer.id,
    note: sourceBasisForBuyerAssociation
  },
  {
    action: 'PLACE_INTENT',
    intentId: selectedOriginalIntent.id,
    targetId: selectedOriginalOpportunity.id,
    note: sourceBasisForPlacement
  }
];
```

Other identity kinds are `merchant`, `operation` and `facilitator`. `UNLINK_IDENTITY` removes a selected explicit association using its kind and planned ID. `CLEAR_PLACEMENT` removes a selected original intent placement. `TITLE_NOTE` changes the comparison title or note.

Select valid opportunities from the candidate group named by the record's `candidateGroupId`. Its `targetIds` preserve the complete original opportunity list. A same-date ambiguity between purchased funding groups remains explicit until the operator chooses the actual group. Identity associations retain their basis and do not change the frozen review's native completion, refund, independence or team-operated classifications. Planned funding identities, useful-result quantities, exact amounts and original timestamps remain in their complete source documents.

An edit or source refresh that invalidates an existing choice returns `state: "EDITABLE_INPUT"` with the whole editable input, complete previous document and precise finding, such as `UNKNOWN_IDENTITY_LINK` or `INTENT_IDENTITY_CONFLICT`. Use `edit` on that result to correct the original association or clear the obsolete placement. The same workflow then recalculates the complete comparison. The retained inputs make the constraint repairable without dropping the original intent or silently changing its participant, network or asset.

### Review, save and reopen

Review and prepare verify that the comparison still contains the exact saved plan and the complete frozen review selected from the current case. Preparation records a named comparison edition inside `input.recording`, while retaining its original `planSourceId`. The source filename begins `sf47-cohort-delivery-` and the saved document uses the existing `stellar-forge.sf47-cohort-delivery-comparison.v1` schema, so the original Cohort delivery desk and command reopen it directly.

The existing adoption request owner retains the prepared bytes and source attachment request before sending. It uses the original client's `attach` operation and the current case's native actor/action handling. Retain the same request ID, complete input, creation time and prepared SHA across retries. Repeating the same MCP prepare reopens that original prepared request after its accepted source attachment advances the case version. A changed operation uses a newly selected current case version and its own request.

The owner retains the complete accepted response before downloading the source. If that read is interrupted, `save` resumes from the same original response and case event; `request` can inspect that retained operation. The returned source ID, length and SHA256 identify the complete saved comparison. Export its JSON, CSV and HTML, and carry the original case through the existing case export/import operation. On the receiving case, select its actual current source ID and SHA and call `open`, or open the same saved source in the Cohort delivery desk.

### Typed operation

Use the existing configured `GrantWorkspaceClient`. The source selection and edited document are the same as the MCP sequence:

```js
import {
  seedGrantCohortDelivery, editCohortDelivery,
  reviewGrantCohortDelivery, prepareGrantCohortDelivery,
  saveGrantCohortDelivery, openGrantCohortDelivery,
  exportGrantCohortDelivery
} from '@tokenjunkielabs/starforge-merchant/grant/cohort-delivery-agent';

const seeded = await seedGrantCohortDelivery(client, caseId, sourceSelection);
const edited = editCohortDelivery(seeded, changes);
const reviewed = await reviewGrantCohortDelivery(
  client, caseId, sourceSelection.expectedVersion, edited
);
const prepared = await prepareGrantCohortDelivery(client, caseId, {
  expectedVersion: sourceSelection.expectedVersion,
  requestId, actor, note, createdAt, document: reviewed
});
await retainPrepared(prepared);
const saved = await saveGrantCohortDelivery(
  client, prepared, prepared.preparedSha256,
  {retainResponse: retainOriginalNativeResponse}
);
const opened = await openGrantCohortDelivery(
  client, caseId, saved.source.id, saved.source.sha256
);
const json = exportGrantCohortDelivery(opened, 'JSON');
const csv = exportGrantCohortDelivery(opened, 'CSV');
const html = exportGrantCohortDelivery(opened, 'HTML');
```

`retainPrepared` and `retainOriginalNativeResponse` are the caller's durable original-file retention callbacks. The Merchant MCP supplies that ownership automatically. A direct-client retry passes the same prepared object and, when retained, `acceptedResponse` to `saveGrantCohortDelivery`. The module also exports `inspectGrantCohortDeliveryRequest` and `refreshGrantCohortDelivery` for that same saved operation and subsequent source review.

JSON retains the complete selected wrapper, including the full original plan and frozen review and any retained predecessor. CSV and HTML use the original comparison engine's complete exports.


## Reconcile the original commercial result

Open **Commercial reconciliation** in the same Cohort delivery desk and choose **Start commercial reconciliation**. This joins the frozen review's complete canonical transactions to the existing plan and its purchased funding groups. It compares original atomic quantities, selected-currency payment values, actual service costs, refunds and contribution without changing the underlying financial records.

The saved comparison contains the whole selected plan, frozen review, original transaction proof and every entered valuation, cost, adjustment and allocation. Existing delivery-only editions retain their original output and reopen unchanged. Starting this section creates an explicit optional commercial selection in the same comparison input.

### Select the reporting basis

Choose one reporting currency and one original transaction population:

| Population | Exact native meaning |
| --- | --- |
| Settled inside the original review window | Transactions whose original `settlesInWindow` classification is true |
| Original intent first attempted inside the window | Transactions whose original `firstAttemptInWindow` classification is true, including a later observed settlement retained by that review |

The complete source keeps both native flags, the exact settlement timestamp, all original purchase and intent-group IDs, and source metadata. Transactions outside the selected population remain in the report. The plan remains its original whole-window prospective baseline; a still-open recorded window and its actual cutoff stay visible.

Keep network fees **separate** unless the operator actually bears them and intends to include them in this service-cost analysis. **Include as cost** adds the valued original network fee once per canonical transaction. Record other payment or supplier fees as their own cost rows, keeping a fee already included through the native transaction out of those rows.

### Enter dated asset values

The payment-amount table compares exact atomic strings by original network and asset. A planned unpriced group stays unknown, and an unresolved native transaction stays unknown. Known subtotals remain available beside incomplete totals.

For currency analysis, enter one selected valuation for each exact network/asset: original decimal places, reporting-currency value per whole asset unit, actual valuation timestamp and its source reference. Values do not cross networks, asset identities or reporting currencies. Native XLM fees retain their original seven-decimal stroop unit, separately from the asset used for the payment. The calculation uses exact decimal and integer arithmetic; it does not round transaction quantities through JavaScript floating-point numbers.

A zero atomic quantity has a known zero currency value. A positive quantity without its selected valuation remains unvalued. Original amounts, fees, dates and quote sources remain present in complete JSON, CSV and HTML.

### Retain shared transactions and purchased groups

The native frozen review already deduplicates canonical transactions by network and transaction hash. Commercial reconciliation consumes those canonical records directly, including each record's original observations and any amount or fee conflicts.

One transaction can support several original intent groups. If all of those groups already point to one opportunity, that opportunity receives the transaction's amount once. If the transaction spans several opportunities, use **Allocate one original transaction** and select the complete original parts. Every selected target must be one of the transaction's placed original opportunities, with matching network and asset. The atomic parts must equal the complete original known amount exactly.

For example, the editable shape is:

```json
{
  "network": "the-original-network",
  "transactionHash": "the-original-transaction-hash",
  "parts": [
    {"targetId": "funding:original-group-a", "amountAtomic": "40000000"},
    {"targetId": "funding:original-group-b", "amountAtomic": "20000000"}
  ],
  "note": "Original invoice or funding source showing the whole allocation."
}
```

Use the actual transaction's `candidateTargetIds` and original atomic amount. A quantity conflict must be corrected in the original recorded source and frozen review. An unmatched transaction remains visible and unallocated. Allocating payment value does not create another intent, purchase or useful task, and does not change the original delivery or independence classifications.

### Record complete service costs

Record supplier, active-labor, other payment-fee and other service-cost rows with their actual timestamps and original source references. Select the original service component when the cost belongs to that complete service; leave the component blank for whole-case shared overhead.

The planner's service component retains all linked funding groups and shared useful results. One actual cost row enters the whole reconciliation once, even when that component supports many purchased groups. The service table retains its original planned currency and each original cost-row ID.

A non-labor row uses its explicitly entered amount. A labor row uses actual active hours multiplied by its selected hourly cost; its direct amount stays blank. Missing amounts or labor terms remain unknown. Enter `0` when the source establishes a zero.

Keep **Costs still being recorded** while the register is incomplete. The report shows known subtotals and leaves complete total cost and contribution unspecified. Choose **Complete selected-window cost coverage** only with an explicit source note describing the complete coverage. An unresolved cost or an included but unknown/unvalued network fee still keeps the total incomplete. Whole-case coverage does not assert that each individual service component has a separately complete cost allocation.

Existing cost or adjustment rows can be corrected by entering their original ID. Valuations replace only the selected exact network/asset. Commercial form drafts survive recalculation, validation errors and browser-session reopening. A saved comparison edition preserves the original prior source in the case history.

### Reconcile refunds and adjustments

A refund adjustment deducts its source-backed reporting-currency amount; another revenue adjustment adds its amount. Keep the actual timestamp inside the original recorded window and cutoff.

Select an original refund cash row where available. A selected row must be current in that original review window, cannot be void, and can be used once. A same-currency refund must retain the exact original cash amount. If its original currency differs, enter the explicitly sourced reporting-currency value and retain the conversion basis in the source reference.

Associate each relevant original refunded intent with its actual refund adjustment. An adjustment can cover several retained refunded intents, but each intent is associated once. Original refund cash rows and refunded intents without their corresponding reviewed values remain visible, and adjusted revenue and contribution remain incomplete. The native cash rows and transaction observations are preserved in the comparison.

The resulting comparison is:

```text
adjusted revenue = selected valued settlements − reviewed refund values + other revenue
complete cost = complete recorded service costs + included valued network fees
contribution = adjusted revenue − complete cost
variance = recorded/valued result − original planned value in the same reporting currency
```

These values belong to this explicit analytical selection. The existing accounting and Buyer Expenses applications retain their original books, source records and allocation histories.

### Operate the same complete selection through CLI and MCP

The installed command can produce the full editable commercial selection from an existing comparison:

```sh
starforge grant-cohort-delivery commercial-seed \
  --input cohort-delivery.json \
  --output commercial-choices.json

starforge grant-cohort-delivery commercial \
  --input cohort-delivery.json \
  --choices commercial-choices.json \
  --output commercial-comparison.json

starforge grant-cohort-delivery html \
  --input commercial-comparison.json \
  --output commercial-comparison.html

starforge grant-cohort-delivery csv \
  --input commercial-comparison.json \
  --output commercial-comparison.csv
```

Edit the complete choices object from `commercial-seed`; its schema is `stellar-forge.sf47-cohort-commercial.v1`. The same `commercial` field can be supplied in complete editable comparison input to `compare`. `reopen` recomputes the full commercial report from its retained original sources and explicit choices.

The existing `merchant_grant_cohort_delivery_edit` tool adds three actions:

| Action | Complete operation |
| --- | --- |
| `START_COMMERCIAL` | Seed the optional selection on an original comparison |
| `SET_COMMERCIAL` with `commercial` | Apply the whole reviewed selection, retaining the full predecessor |
| `REMOVE_COMMERCIAL` | Return this successor to a delivery-only comparison while retaining its full predecessor |

The existing source refresh carries all commercial choices with the original associations and placements. If a retained transaction, cost component, refund or actual-date constraint no longer fits the new source, it returns complete editable input and the exact finding. Correct the whole selection through the existing edit operation. It never silently discards a now-invalid transaction allocation or cost source.

Continue through the original **review → prepare → save → request recovery → open → export** operation documented above. Preparation still binds the complete original saved plan and frozen review. The same source attachment and request journal save the full successor; the same desk and command reopen it. JSON, CSV and readable HTML include all transactions, allocations, valuations, costs, adjustments, original refund rows, shared-service sources, coverage and actionable findings.

## Receive original Work and supplier invoice costs

The commercial desk can now select the current case's original Work and supplier invoice lines directly from the complete frozen Cohort review. Each selection retains its full original record, contributor, linked Work and source-attachment metadata. This joins original operational costs to the recorded service result without copying quantities into an unrelated ledger.

### Select the complete original source and actual portion

Open **Cohort delivery → Commercial reconciliation**, start commercial reconciliation if necessary, and use **Original Work and supplier invoice costs**. The source table lists all original Work and invoice lines, including invoice-linked Work. Read the complete original context, select a portion, and enter:

- A stable selection ID, or leave it blank to create one.
- The actual selected hours for Work or actual selected USD amount for an invoice line.
- The existing complete shared service component, or the whole comparison for shared overhead.
- The reporting-currency value per original unit: currency per hour for Work, or currency per original USD for an invoice.
- The actual valuation time and source for a known hourly cost or non-USD currency conversion.
- The selected original date interval and an explanation of the actual portion and service allocation.

Work retains its recorded civil-date interval. An explicitly selected partial interval must stay inside that original interval, the frozen review window and its cutoff date. Enter the actual corresponding hours; the calculator does not infer daily proration from the length of an interval. Invoice lines retain their original issue date, native USD amount and original line identity. An invoice valued in USD uses a unit cost of one. A different reporting currency requires an explicit dated conversion. An empty rate stays unknown; an entered zero is a known zero.

The calculator adds exact decimal portions across all selections of the same original record. Their total cannot exceed the original recorded hours or invoice-line USD amount. The report and export show selected and unselected quantities side by side. Several portions can serve different original shared service components while preserving all purchased funding groups and useful results.

A supplier invoice records an original liability. Its issue-date cost selection is distinct from cash settlement. Original Work state and hours likewise retain their native meanings. This operation keeps the original Work, Invoice, Cash, Cost funding and Buyer Expenses records with their current owners. The original cost ID and funding basis are retained as source context; selecting a cost does not establish funding eligibility.

### Resolve linked Work and invoice coverage

A native supplier invoice line can reference original Work. If both that Work and that invoice line contribute selected costs, the desk shows their exact association in **Invoice-linked Work review**. Their selected portions remain visible together.

Remove a duplicated portion, or retain the actual source explanation showing that the two portions represent distinct costs. For example, a supplier's retained detail can distinguish invoiced materials from separately paid assembly labor. The complete cost and contribution remain unknown while any selected association lacks that review; the known recorded subtotal remains visible. Previously entered reviews are preserved when an overlap is no longer active, with their current inactive status shown.

This source review is also available through the same complete agent document and CSV/HTML export. It applies to each original Work/invoice-line association, including a Work record linked by several invoice lines.

### Refresh sources while preserving authored choices

Select the new full saved adoption plan and frozen review, then choose **Refresh selected sources and keep choices**. The editor retains the complete predecessor input and carries all explicit identity associations, original intent placements, selected portions, unit costs, valuation sources and overlap reviews into the successor.

A changed original Work record, invoice, contributor, linked Work or attachment metadata produces an editable successor with the actual source constraint. The comparison retains the old source witness and all authored quantities and rates. **Retained and current original source** displays both complete versions. Edit the selected portion, review its source, and explicitly choose **I reviewed and accept the complete current original source** only for that selection. Accepting one source does not silently accept other changed records. An invoice-linked Work change also requires review of the affected invoice selection's linked source context.

The editor can retain several unresolved source changes while the operator fixes them one at a time. Download the full editable successor and predecessor at any point. The same browser-session recovery restores the selection and form drafts. A complete calculated successor is saved through the existing comparison edition operation. Unknown hourly values and unreviewed overlap are represented in the calculated report; a missing, void, changed, overallocated or out-of-period selected original requires correction before that edition can be calculated.

### Use the same original-cost intake through CLI and agents

```sh
starforge grant-cohort-delivery original-costs \
  --input cohort-delivery.json \
  --output original-cost-catalog.json

starforge grant-cohort-delivery original-costs-receive \
  --input cohort-delivery.json \
  --choices selected-original-costs.json \
  --output editable-successor.json

starforge grant-cohort-delivery compare \
  --input editable-successor.json \
  --output original-cost-comparison.json
```

The catalog contains the complete original records, the current `selection`, and `sourceReviews` identifying unchanged, changed and missing original context. Build the receive object from its selection's `selections`, `overlapReviews` and `note`; omit the selection's schema property. Each selected portion carries `id`, `sourceKey`, `serviceId`, `quantity`, nullable `unitCost`, `valuationAt`, `valuationSource`, `periodStart`, `periodEnd`, `allocationNote`, and its retained `source` witness.

The complete source key is supplied by the catalog. Existing selection IDs keep their previous source witness even if the caller omits the `source` field. Add only the reviewed selection IDs to `acceptSourceIds` to rebind those rows to their complete current originals. New selections receive their original source directly. Quantities, dates, rates and overlap reviews are always supplied explicitly; source acceptance does not replace them.

`original-costs-receive` writes the full editable successor. `compare` then calculates it or reports the specific remaining constraint. This permits several changed records to be repaired independently. `reopen`, `csv` and `html` retain the same full source and original-cost report.

The existing `merchant_grant_cohort_delivery_edit` operation adds two actions:

| Action | Complete operation |
| --- | --- |
| `RECEIVE_ORIGINAL_COSTS` with `originalCosts` | Apply the complete selected portions, overlap reviews, note and explicit source acceptances to the current document |
| `REMOVE_ORIGINAL_COSTS` | Remove this successor's original-cost selection while retaining the complete predecessor document |

The existing refresh operation carries this selection inside the complete commercial choices. It returns `EDITABLE_INPUT` with the precise original-source, quantity, date or valuation finding while the operator repairs it. The original nine-tool **review → prepare → save → request recovery → open → export** path remains the native persistence operation.

The exported source API provides `inspectCohortOriginalCosts(document)`, `selectCohortOriginalCosts(document, selection)` for the full editable input, and `receiveCohortOriginalCosts(document, selection)` for its calculated comparison. The optional original-cost selection uses schema `stellar-forge.sf47-cohort-original-costs.v1`. Comparisons without that field retain the prior commercial report exactly.
