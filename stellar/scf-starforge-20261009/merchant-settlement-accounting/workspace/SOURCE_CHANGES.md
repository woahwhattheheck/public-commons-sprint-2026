# Company chart source changes

This workflow replaces an unused QuickBooks or Xero accounting plan when the selected company's chart or organization source changes. It runs inside the existing merchant or buyer accounting workspace. Staff compare the original and current source editions, review every mapping and valuation, retain a native successor preview, then explicitly authorize cancellation of the unused predecessor and creation of that exact successor.

The original accounting handoff, economic rows, native plan history, provider identifiers and accountant returns remain in the same workspace. New QuickBooks plans still require the original review before posting or downloading their journal request. New Xero plans still use the original draft, native-response and accountant-return controls. Preparing or applying a source change does not invoke either provider.

## Open the complete workflow

Start or reopen the existing configured accounting application and open **Chart source changes** from the accounting, QuickBooks or Xero page. The direct route is `/source-changes.html`. A buyer-source workspace exposes the same workflow for its original Xero plans.

Use the original Connections page at `/connections.html` for approved QuickBooks company and chart captures. For Xero, retain the new organization/chart context through the existing page at `/xero.html`. Those existing workflows keep provider authorization, company or tenant selection, original source responses and saved source identity.

The source-change page also accepts an existing normalized QuickBooks company snapshot. This is the complete original `stellar-forge.quickbooks-company.v1` object produced by the maintained company normalizer, including its three source-document strings, source digests and integrity. A hand-edited list of account IDs is insufficient.

An older QuickBooks plan without a retained company snapshot remains accessible through its original page. Its missing historical chart cannot be reconstructed by choosing a new chart, so this replacement workflow requires an actual retained baseline.

## Staff workflow

1. **Select the original plan and the target source edition.** Keep the same QuickBooks realm and sandbox/production environment, or the same Xero tenant and demo/books identity. Xero contexts must already be retained in this workspace. QuickBooks source selections come from the original Connections review or a validated original snapshot.
2. **Compare the editions.** Read company name, base currency and account changes. Accounts are matched by their original native IDs. A renamed account or changed Xero account code remains connected to that same ID. The comparison identifies selected accounts that have changed or become unavailable.
3. **Review the successor mappings.** Existing eligible account IDs provide initial suggestions. Missing or ineligible accounts remain unselected. Staff choose the replacement accounts and explicitly review dates, values, descriptions and valuation notes. The workflow does not infer exchange rates. Original economic rows, buyer allocations and exclusions remain fixed.
4. **Retain the review.** Supply a reason, operator, successor name and explicit valuation confirmation. The exact source comparison, both source editions, original plan, complete native successor request and preview are retained before cancellation is possible. Keep the review UUID, successor UUID and original timestamp.
5. **Apply the exact review.** Confirm that the predecessor is unused, that no downloaded request from it was imported externally, and that the mappings are approved. The application retains an application UUID, exact request hash and cancellation intent before calling either original native method.
6. **Inspect the successor in the original provider page.** The source-change receipt links the cancelled predecessor and the successor. Continue normal QuickBooks review/posting or Xero draft/reconciliation/return from that successor. Any external accounting action still belongs to those original controls.
7. **Download the handoff and preserve the operating workspace.** The source-change download includes both source editions and the original retained plan files. The original full operating backup preserves the entire workspace and all other accounting work. Reopen that workspace and inspect the same review and native plan IDs.

The interface retains pending command bodies before dispatch. Large snapshot drafts use a browser database scoped to the current original workspace. The current workspace binding returned by the server controls every new request. The binding stored in an older review remains provenance; it is not permission to replay a pending command into a different workspace.

## Which plans can be replaced

| Provider | Required unused state | Preserved original restrictions |
| --- | --- | --- |
| QuickBooks | DRAFT or REVIEWED, no cancellation, no native posting attempt and no received response | Other reviewed or booked plans continue to reserve the same realm/environment event IDs. The new plan remains DRAFT until its original review. |
| Xero | Active plan, all journals READY and unattempted, no native operation, capture, return intent or accountant return | All other active plans continue to reserve tenant/component identities and buyer workspace/economic IDs. The original cancellation also rejects a RUNNING operation. |

An attempted or posted plan can be compared when its original sources remain available. It cannot be replaced through this workflow. Correct it through its existing provider and accountant-return process. Never use a new source-change UUID to bypass an attempted plan's native history.

The implementation preserves the exact selected economic event/component set. It does not remove conflicting plans from the workspace, temporarily cancel them to manufacture a successful preview, release another plan's reservations, or change the original accountant baseline.

## Retained phases and recovery

| Phase | Actual retained state | Continue with |
| --- | --- | --- |
| PREPARED | Both editions and the exact successor preview exist; no application intent exists | Review and approve this exact record |
| APPLYING | The original application intent exists; cancellation may already have completed | Inspect the same review, then resume its original application UUID |
| CANCELLED_PENDING_SUCCESSOR | The original predecessor is cancelled; the exact successor still needs confirmation or creation | Resume the same application UUID and successor request |
| COMPLETED | The native successor matches the retained preview and original economic source | Open the original successor or download the handoff |

A lost response is not evidence that an action failed. Keep the original request body and UUID. Read the same review before retrying. If the backend already retained an application intent, use `resume` with its original application UUID. Resume does not allocate a new successor or reverse a completed cancellation.

A known pre-intent application rejection is retained in that same review and in the original workspace history. Its receipt includes the application UUID and canonical request SHA256. Repeating that exact rejected request remains rejected. The browser can return to review only after matching the bound rejection and a fresh copy of that same retained record with no application intent. A generic 400/409, HTML response or network failure cannot release the pending command.

If an initial prepare request has no retained review, the explicit bound `SOURCE_CHANGE_NOT_FOUND` result and a fresh matching catalog allow the original draft to be reviewed again. An unreadable or unrelated 404 is an unknown outcome.

### A save with an uncertain durable outcome

The original accounting Store now marks `WORKSPACE_COMMIT_UNKNOWN` when it cannot confirm a durable save. A rename may have published the new `workspace.json` before a later directory sync failed. All subsequent mutations, including already queued actions from other accounting pages, are rejected until the original workspace closes and reopens. The response includes `outcomeUnknown: true` and `reopenRequired: true`; the normal state view also exposes the retained diagnostic.

Keep the original action and close the application through its existing lifecycle. Reopen the same workspace so the actual saved edition becomes authoritative, then inspect and resume the original review. Do not restore an older backup or delete the original workspace to resolve an uncertain response.

Xero plan creation now uses the original QuickBooks immutable packet pattern. Completed packet members are retained through interruption. A repeat of the same request reuses only files whose byte count and SHA256 match. Partial or conflicting bytes are preserved for diagnosis. A failed save does not delete a possibly committed successor's files. Xero context imports use the same immutable member publication, with an original import intent that preserves the request, creation time and source-observation metadata. An unchanged import UUID resumes those exact retained identities. A complete older context/source pair can be verified and reused; ambiguous partial earlier packets remain preserved.

The full Store history remains retained under its existing limits of 100,000 entries and 32 MB. The interface may show a shorter recent history; cancellation reconciliation uses the original full history and exact native cancellation fields.

## CLI

The installed command is:

```sh
starforge accounting-source-changes status --url http://127.0.0.1:8446
```

The original workspace command also dispatches this same implementation:

```sh
starforge merchant-accounting-workspace source-changes status --url http://127.0.0.1:8446
```

Replace the URL with the actual configured loopback address. The supported actions are:

```sh
starforge accounting-source-changes sources --url URL --offset 0 --limit 50
starforge accounting-source-changes inspect --url URL --input /private/inspection.json --out /private/inspection-result.json
starforge accounting-source-changes prepare --url URL --input /private/review-request.json --out /private/review-result.json
starforge accounting-source-changes detail --url URL --change REVIEW_UUID
starforge accounting-source-changes apply --url URL --change REVIEW_UUID --input /private/approval.json --out /private/approval-result.json
starforge accounting-source-changes resume --url URL --change REVIEW_UUID --input /private/original-request.json
starforge accounting-source-changes download --url URL --change REVIEW_UUID --out /private/source-change.json
```

For an already stopped workspace, replace `--url URL` with `--workspace /private/original-accounting`. That opens its original exclusive lease without a listener or provider operation. A running workspace continues through its existing URL. Connections review selection requires the already configured server; the stopped CLI accepts original QuickBooks snapshots and retained Xero contexts.

Every input file is an exact UTF-8 JSON object. Preserve its UUIDs, binding, original timestamp and body before dispatch. Result files are private create-only outputs: an identical retained file can be reused; a different existing file is preserved. A failed output write does not undo the accounting action. Inspect the original record before continuing.

## HTTP and typed embedding contract

The existing server's host, origin and `X-Workspace-Request: 1` checks remain in effect. POST bodies use `Content-Type: application/json`. Source-change requests have a 32 MiB whole-body limit; the original QuickBooks normalizer separately limits the combined source responses to 8 MiB.

Every successful JSON result returns:

```json
{
  "schema": "stellar-forge.accounting-source-change.v1",
  "binding": {
    "workspaceId": "the current original workspace identity",
    "sourcesSha256": "the current configured source identity"
  }
}
```

Additional fields depend on the action. Identifiers in the following table refer to actual retained UUIDs.

| Method and path | Input | Result |
| --- | --- | --- |
| GET /api/source-changes | None | Current binding/revision, original plan eligibility, retained Xero contexts and source-change records |
| GET /api/source-changes/sources | offset, limit query values | Paginated original Connections reviews, total and nextOffset |
| POST /api/source-changes/inspect | binding, kind, planId, target | Before/after comparison, actual normalized target accounts, defaults and predecessor eligibility |
| POST /api/source-changes/prepare | Inspection inputs, stable review id, predecessorSha256, comparisonSha256, rationale, valuationConfirmed and successor | The complete retained review and native preview |
| GET /api/source-changes/:id | None | Retained review, original intent/rejections and actual predecessor/successor state |
| POST /api/source-changes/:id/apply | binding, stable application id, previewSha256, current revision, actor, note and all three confirmations | The retained original application outcome |
| POST /api/source-changes/:id/resume | binding and original application id | Continuation of that exact retained intent |
| GET /api/source-changes/:id/download | None | A complete source-change JSON handoff attachment |

The target is one of:

```ts
{ kind: "qbo-review", id: reviewId, sha256: review.previewSha256 }
{ kind: "qbo-snapshot", snapshot: originalNormalizedCompany }
{ kind: "xero-context", id: contextId, sha256: contextSha256 }
```

A prepare request keeps its original `id` and successor identity. The successor contains `id`, canonical ISO `createdAt`, `name` and `actor`, plus:

- QuickBooks: `txnDate`, optional `docNumber`, and every original row as `{rowId,amount,debitAccount:{value},creditAccount:{value},description}`.
- Xero: `valuationBasis` and every included/excluded component. Included rows use `{componentId,decision:"include",date,amount,debitAccountCode,creditAccountCode,valuationNote,description}`. Original excluded rows remain `{componentId,decision:"exclude",reason}`.

The apply confirmations are exactly `unusedConfirmed: true`, `noExternalImport: true` and `mappingConfirmed: true`. Values and mappings are validated again against the current original source and native preview before the cancellation intent is retained.

Bound source-change errors contain `schema`, current `binding`, `reopenRequired`, `error`, `message` and `outcome`. Outcome is `unknown`, `not_found` or `rejected`. A terminal rejection additionally contains `command: {id,requestSha256,state:"rejected",error,message,createdAt}`. Host/body/parser failures outside this handler may lack the source-change binding; clients must treat those as unknown.

Canonical request hashes use recursively key-sorted JSON from the original QuickBooks canonical serializer. They cover the complete request, including binding and revision. Whitespace in a JSON transport is not a new request; changing a parsed field under an existing UUID is rejected.

The installed SDK exports are `./accounting/source-changes` and `./accounting/source-changes/model`, with adjacent TypeScript declarations. A hosting adapter supplies the original leased Store and existing QboWorkspace/XeroWorkspace instances:

```js
const changes = new SourceChangeWorkspace(workspace, {
  qbo: existingQuickBooksController,
  xero: existingXeroController,
  connections: existingConfiguredConnections
});
```

The existing accounting server constructs this once per active original workspace. Close the source-change controller before closing the native controllers and Store so its retained cancellation/create operation drains. It never closes a borrowed connection or starts a new provider engine.

## Downloads, complete backup and reopen

The source-change attachment uses `stellar-forge.accounting-source-change-handoff.v1`. It retains the immutable review bytes, current record, comparison and both original native plan packets. Each embedded file carries its path, byte count, SHA256 and base64 bytes; the handoff itself has a canonical SHA256.

QuickBooks' existing journal-export restriction remains effective. An unreviewed successor or cancelled predecessor does not gain a separate journal-entry download through this page. The handoff explicitly lists withheld native request files and their hashes. Complete private operating backup retains the entire workspace, including those original files.

Use the original **Operating backup and recovery** workflow, or stop the workspace and its original input writers and run the existing commands with a host-configured private passphrase:

```sh
starforge merchant-accounting-workspace backup \
  --workspace /private/merchant/accounting-workspace \
  --state-root /private/merchant \
  --out /private/backups/accounting-source-change \
  --pass-env STARFORGE_ACCOUNTING_BACKUP_PASSPHRASE --quiesced

starforge merchant-accounting-workspace verify-backup \
  --bundle /private/backups/accounting-source-change \
  --pass-env STARFORGE_ACCOUNTING_BACKUP_PASSPHRASE

starforge merchant-accounting-workspace restore \
  --workspace /private/merchant/accounting-workspace \
  --state-root /private/merchant \
  --bundle /private/backups/accounting-source-change \
  --pass-env STARFORGE_ACCOUNTING_BACKUP_PASSPHRASE --quiesced
```

These are the original encrypted operating recovery APIs. Restore uses the original absolute paths, preserves changed existing files and continues an interrupted restore using the same backup and paths. Buyer-source mode preserves its complete original accounting directory and issued source. The new source-change records and files are inside that directory and therefore join the same backup.

After reopen, read the current catalog, open the same review UUID and verify the original predecessor, successor, preview hash, phase and application intent. Continue from the actual saved state. Provider tokens and authorization stores remain under the original host's separate credential and grant-store custody.

## Commissioning in an existing receiving operation

Use the original accounting receiving owner, workspace and provider transport. Supply an actual unused original plan, its already retained target chart edition, and staff-reviewed successor values. Complete the interface sequence from comparison through original successor review, preserve the exact download, then use the owner's original backup/reopen step and inspect the same IDs.

If the selected receiving plan already has a native attempt or an accountant return, verify its comparison and refusal to replace it, and retain the real reason. That existing plan is not an eligible unused predecessor. A complete replacement needs another actual unused plan selected by the original owner. No provider or application run is implied by source publication.
