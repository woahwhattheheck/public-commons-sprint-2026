# Customer commissioning in the original Installation

The Customer commissioning and receiving section joins a dated customer-use plan to the original Console cycles that perform it. It retains the commissioning payer, accountable merchant and buyer, complete priced units, aggregate spending authority, exact native result and original purchase correspondence inside the same Installation document and edition history.

Open **Delivery operations → Customer installations**, select the current Installation and choose **Edit**. The section follows the existing **Customer-use calendar**. Preparation and review return a complete editable draft; **Preview** and **Save installation edition** remain the only writer.

## Existing records and ownership

| Information | Original authority | Commissioning selection |
| --- | --- | --- |
| Series revisions, periods, dates and cancellations | Console workflow series and customer-use calendar | Explicit original cycle IDs for each dated use |
| Payer and scope | Installation workorder | Same source, payer, scope and terms |
| Buyer and merchant | Original deployments | Existing accountable deployment identities |
| Useful work | Original calendar task | Complete request, output, repeat reason and priced unit |
| Direct or prepaid funding | Calendar settlement group | Original group ID, reviewed units, price and budget |
| Native result | Original Console run, report, calls and customer files | Exact retained facts and selected output files |
| Payment attempt, settlement, fees and output observation | Original received buyer purchase | Explicit correspondence to a retained native call |
| Independent operator and qualified purchase counts | Original Cohort review | Retained original observations; same evaluator |
| Invoice, cash and collection | Existing accounting and commercial workshare | Original records and established workflow |
| Save, recovery and handover | Original Installation and operating case | Same preview SHA, request journal and complete export |

A Console call does not by itself identify a paid purchase. A page, retry, file, allowance use or reopened result does not create a new payment record. Source correspondence is an explicit operator observation; it does not authenticate a transfer.

## Start with complete originals

Receive the existing Console customer handover through the original source exporter:

~~~js
import {exportWorkflowInstallation} from
  '../../../../stellar-forge/mcp-merchant-operator/console/workflow-installation-handover.mjs';

const result = await exportWorkflowInstallation({
  directory: originalCustomerHandoverDirectory,
  input: {periods: reviewedOriginalPeriodSelections},
  output: originalInstallationSourceZip,
  python: installedPython
});
~~~

Each period selection is exactly {cycleId, deliveryIds}. The exporter reopens the original complete profile, selection, handover and customer files; its report engine derives a report from retained original runs. It does not run the workflow again. Its Python packager verifies and writes the complete source ZIP.

Attach that ZIP through the existing **Sources** desk, then use **Customer periods** source intake to select its cycles and prepare the Installation. Keep every earlier selected cycle when receiving a successor handover. Read [original workflow Installation source](operations_installation_workflows.py) and [Console series](../../../../stellar-forge/mcp-merchant-operator/console/WORKFLOW_SERIES.md) for native producer and change rules.

The 814B receiving archive selected for this join contains two completed original cycles, their October and November periods, a full retained profile and two six-file customer deliveries. Its 32 retained merchant calls remain native operational calls; they are not a claim of 32 paid purchases. New commissioning terms and review decisions in a demonstration must be labeled as authored selections.

## Prepare the dated work

Use the original [Customer-use calendar](CUSTOMER_USE_CALENDAR.md) to enter complete useful tasks, buyer deployments, selected dates, exclusions, direct or prepaid funding groups and received-purchase associations. Keep ordinary customer demand and actual operating constraints visible.

The calendar retains four distinct modes:

- **PURCHASE** names a useful task funded by its original direct or prepaid group.
- **ALLOWANCE_USE** draws on a selected original prepaid group.
- **REOPEN** reads an already retained result.
- **FREE_USE** carries no selected funding group.

A prepaid group can support several later uses. Commissioning reviews its price and budget once, using that original group identity. It does not multiply the pass into paid purchases.

Choose **Prepare customer commissioning**. The service reads the same case version and Installation revision, validates the complete workflow source and returns:

- A commissioning row for each original dated use.
- A price-review row for each original funding group.
- The exact selected cycle inventory, including request period, source edition, native calls, steps, result identity and files.
- Separate review bases for prices, aggregate budget, planned work and receiving.

New price rows copy the Installation's currently entered unit price, units, task budget and payment-source selections as editable initial values. Review those values for the actual direct request or prepaid group. Copying an input does not establish a supplier price, customer approval or payment.

## Select exact cycle correspondence

For each dated use, select one or more original cycles. Enter why those cycles perform this buyer's complete task and attach original correspondence sources when available.

The selection retains original series ID and revision, request period, due date, source edition, reason and run ID. **Refresh exact source and review bases** reads the selected bytes and refreshes those facts. The client cannot replace them with an invented completed result.

A cycle may be explicitly associated with more than one dated use. The report displays every such shared association. This lets genuine shared work or a retained result be described without silently treating it as another payment.

If the calendar row was removed, its commissioning row remains visibly unbound. Reassign or remove it explicitly. Removing a row from a draft does not alter an earlier saved edition. Preparation adds missing original rows again; an old calendar identity is never silently rebound to another task.

Changing selected cycles can leave an earlier output or receipt selection that no longer belongs to them. Remove that particular draft selection or keep the original cycle before refreshing. This prevents a source change from silently transferring acceptance to another result.

## Review priced units and aggregate authority

| Funding field | Meaning |
| --- | --- |
| fundingId | Exact original calendar settlement-group ID |
| units | Number of complete priced units; blank remains unentered and zero remains zero |
| priceAtomic | Exact nonnegative whole-number text in the selected asset's atomic units |
| budgetAtomic | That group's selected atomic budget |
| sourceIds | Original price and budget source files |
| note | Complete priced unit and basis for the selection |
| review | Recorded decision, operator, time, reason and exact basis digest |

The service multiplies integer units by the exact atomic price and compares the result with the funding-group budget. It never rounds through a JavaScript floating-point payment amount.

The aggregate budget covers each active original funding group once. The sum of selected group caps must fit the aggregate cap. Each group's current price selection must be reviewed before aggregate approval becomes effective. That review also binds the original workorder, selected payment terms and buyer spending authority.

A direct request's task price and a prepaid pass's price can differ. Enter their actual priced units separately. A free or reopened use can have no funding groups; the choice remains explicit.

Original settled amounts are shown separately and compared by original network and transaction identity. A repeated observation is not automatically another transfer. One intent associated with different settled transactions, or one transaction associated with different intents, leaves the amount comparison unresolved. Conflicting amount, asset or recipient data is also retained for reconciliation. Fees remain in the original receipts and accounting.

Reviewing a budget does not submit a payment. The original buyer's authority and native payment operation remain the execution path.

## Record planning and output decisions

The desk keeps two independent per-use reviews.

**Plan review** binds the dated use, complete task, selected original request and series identity, accountable buyer and merchant, workorder, receiving requirements, source references and correspondence note. An incomplete or cancelled plan can retain a changes-required decision.

**Output review** also binds the exact native result, output-evidence choice, selected customer files and original call-to-purchase correspondence. Accepting an output requires every selected original cycle to be complete and the selected files/calls to match their retained facts.

Choose a useful-output basis:

- **Selected complete native results** retains the complete native result as the review basis.
- **Selected original customer files** additionally names the exact delivery ID, path, byte count and SHA-256 of each required output file.

Enter a decision reason and actual recorded operator/time. **Record plan decision**, **Record output decision** and **Record funding decision** stage only that exact review in the draft.

Review checkboxes support one explicit batch. Every selected item still has its own state, reason and expected basis digest. Price decisions are evaluated before the aggregate-budget decision. If any selected row is invalid or stale, preparation fails without saving any partial result.

A changes-required decision can preserve an incomplete basis. A native call alone never creates an accepted output.

## Receive original purchases

Use [buyer receiving](BUYER_OPERATIONS.md) to import an actual original buyer observation. Select its existing purchase in the original calendar funding group, then add an explicit receipt correspondence:

~~~json
{
  "purchaseId": "purchase-ORIGINAL",
  "cycleId": "series-cycle-ORIGINAL",
  "callId": "ORIGINAL-NATIVE-CALL",
  "note": "The operator's specific source correspondence."
}
~~~

These placeholder IDs are not executable example purchases. Select actual retained IDs shown in the desk.

A selected purchase must already belong to a funding group used by that dated task. The call must belong to that cycle's original report. The desk shows the receipt's network, asset, recipient, intent, settlement/output state and exact amount. It does not rewrite them.

Useful-output acceptance remains distinct from payment settlement. A useful output may be reviewed while its original payment observation remains pending, failed or unknown. Use the original Cohort and accounting reports for their respective conclusions.

## Change, refresh and preserve review history

Review records retain state, actor, observedAt, note and basisSha256. The report adds basisCurrent, status and effectiveApproval.

A material input change makes an earlier review **stale**. Its recorded decision remains visible and its effective approval is false for the changed basis. Saving retains both the earlier immutable edition and the new state.

Examples:

- A changed source edition or original cycle request changes the planning basis.
- A native run progressing to another retained result changes output acceptance; unchanged source planning can remain current.
- Selecting a different output file changes the receiving basis.
- Editing a price, quantity, recipient or relevant buyer/merchant identity changes its price-review basis.
- Adding a new actual purchase observation does not alone revoke unchanged planning-price approval, but it changes the relevant receiving and recorded-amount comparison.
- Changing payer or scope changes the workorder-bound planning and aggregate-budget basis.

The UI labels a previously prepared report when the draft changes. Review actions require a refreshed exact draft and current case version. If source preparation returns after later form edits, its complete result is kept as another retained draft and those later edits stay open.

Refresh, remount and the existing session draft store retain review notes and selections. The parent Installation writer owns uncertain saves: preserve the same request ID, complete body, preview SHA and expected version when recovering an ambiguous response.

## Native API and typed client

Both preparation methods are read-only:

| HTTP route | Operations method | Typed client |
| --- | --- | --- |
| POST /api/operations/{caseId}/installation-commissioning-seed | seed_installation_commissioning | installationCommissioningSeed |
| POST /api/operations/{caseId}/installation-commissioning-review | review_installation_commissioning | installationCommissioningReview |

Seed uses the full original preview envelope: expectedVersion, installationId, expectedRevision and document. A new Installation uses installationId:null and expectedRevision:0. Supply the complete real Installation document.

Review adds actor, observedAt and an explicit reviews array. Each row contains kind, id, state, expectedBasisSha256 and note. Kinds are FUNDING, BUDGET, PLAN and OUTPUT; aggregate budget uses id:"budget" or null. Decisions are APPROVED or CHANGES_REQUIRED. The native service checks original references and SHA-256 fields and returns the complete document, inventory, report and count of staged reviews.

~~~js
const current = await client.read('case', {caseId});
const prepared = await client.installationCommissioningSeed(caseId, {
  expectedVersion: current.value.program.version,
  installationId, expectedRevision,
  document: completeEditableInstallation
});
// Present prepared.value.inventory and prepared.value.report.
const reviewed = await client.installationCommissioningReview(caseId, {
  expectedVersion: current.value.program.version,
  installationId, expectedRevision,
  document: prepared.value.document,
  actor, observedAt, reviews: explicitReviewRows
});
const preview = await client.installationPreview(caseId, {
  expectedVersion: current.value.program.version,
  installationId, expectedRevision,
  document: reviewed.value.document
});
// Retain this exact request privately before dispatch.
const saveRequest = {
  expectedVersion: current.value.program.version,
  installationId, expectedRevision,
  document: reviewed.value.document,
  expectedPreviewSha256: preview.value.previewSha256,
  actor, note: saveReason, requestId: originalSaveRequestId
};
const saved = await client.installationSave(caseId, saveRequest);
~~~

The original authenticated routes and managed source identity remain unchanged. There is no additional credential, database, journal, hosted model or payment dispatch service.

## CLI

Use the existing operations command:

~~~sh
operations() {
  python3 "$SF47_SOURCE/cli.py" operations \
    --workspace "$WORKSPACE" --scenario "$SCENARIO" "$@"
}

operations installation-commissioning-seed \
  --case "$CASE" --installation "$INSTALLATION" \
  --expected-version "$VERSION" --expected-revision "$REVISION" \
  --document original-installation.json --output commissioning-preparation.json

operations installation-commissioning-review \
  --case "$CASE" --installation "$INSTALLATION" \
  --expected-version "$VERSION" --expected-revision "$REVISION" \
  --document reviewed-installation.json --reviews exact-review-rows.json \
  --actor "$OPERATOR" --observed-at "$OBSERVED_AT" \
  --document-only --output complete-reviewed-installation.json
~~~

The document-only option returns the complete document ready for original installation-preview and installation-save. Omit installation for a new Installation and use revision zero. The review file is the exact explicit review-row array.

## Export, inspect and continue

Use the original **Download complete handover**, typed download('installation', ...) or installation-export. The ZIP contains full Installation history, operating-case records, exact original files, selected edition, readable handover and commissioning report.

Import the entire archive through the original case receiver. It validates every edition's source facts, snapshot, preview hash, event history and recomputed report. Facts are checked against original archived Console bytes; a summary alone is insufficient. Old Installations without commissioning remain valid.

Reopen the returned selectedInstallation in the received case. Continue through a new original edition. Preserve the returned case identity; importing a case does not replace another operating case.

Managed Python and Node source manifests both include the domain and interface files. The typed client carries the complete commissioning input and returned native report. Use one matching complete source edition when publishing and receiving.

## Implementation and receiving status

The source includes the domain, typed client, CLI, original HTTP/Installation integration and browser desk. The joined native receiving programme uses the retained original Console handover and customer calendar case. Its result must record actual original selections, hashes, Installation editions, source-change behavior, full archive receiving and same-case browser outcome.

Source publication does not establish completed receiving, buyer payment, a grant target, an independent customer or an award. Retain the actual receiving result with this operation when it completes.
