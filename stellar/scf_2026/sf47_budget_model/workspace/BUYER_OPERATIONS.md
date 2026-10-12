# Native buyer work in delivery Operations

Receive original SF88 Inbox observations in an existing SF47 grant delivery case. The exporter reads selected original jobs and verifies saved response files through the maintained buyer reader. The receiver links those observations to the original deployment and purchase records, retains the complete private source, and includes it in the normal case export and reopen workflow.

## Start with the existing purchase

Use the Inbox that owns the original intent. Keep its original request, attempt, terminal, recovery, accounting and response files together. The exporter invokes the original `openQueue().show()`, `InboxResponse.verify()`, SF52 outcome analysis and saved SF36 finalization view. It does not enqueue, approve, sign, execute, recover or finalize a purchase. A capture does not contact a provider or request a new ledger observation.

Create a private receiving directory and choose a new filename. From `stellar/scf-starforge-20261009`, run:

```bash
node sf88-operator-buyer-cli/operations-handoff/cli.mjs export \
  --inbox /ABSOLUTE/ORIGINAL-INBOX \
  --intent ORIGINAL_INTENT \
  --output /ABSOLUTE/PRIVATE-RECEIVING/buyer-operations.json
```

Repeat `--intent` for each original job to include. The response gives the output filename, exact byte count and SHA-256, selection and source-review counts. The original source files and native view are checked again before capture completes, so concurrent changes require another explicit capture. The export destination must be private and must not already contain differing bytes.

The default retained-output verification limit is 256 MiB per file. `--max-verify-bytes` accepts an explicit limit from zero through 1 GiB; the total selected response verification also stops at 1 GiB. Larger files remain visible as `OVER_LIMIT`. Unavailable saved files remain visible as `UNAVAILABLE`. Those states do not claim a currently verified output. Select at most 100 original jobs and keep each handoff at or below 8 MiB.

A handoff contains the exact original Inbox header and selected request/attempt/terminal/recovery/finalization/evidence files, plus the original native view and output-verification result. It does not package the response body or execution configuration. Original records can contain private paths and operator metadata: keep the complete handoff with the private operating case.

For a separate source review:

```bash
node sf88-operator-buyer-cli/operations-handoff/cli.mjs inspect \
  --file /ABSOLUTE/PRIVATE-RECEIVING/buyer-operations.json
```

This returns the interpreted source and a portable HTML review. Its output is a private operations artifact.

## Review and receive in the original browser

Open the existing grant workspace, select the saved plan and its retained Operations case, then choose **Native buyer receiving**. A new Operations case pins the explicitly selected plan revision; receiving does not change that planning scenario.

1. Select the original handoff. The page binds its exact SHA-256, byte count, original filename and current case version. Review all exported jobs, original payment and output states, source identities and timing details.
2. Choose the accountable existing buyer or combined deployment, or provide the actual operator and deployment details. Participant class is an explicit operator decision. A team-operated purchase does not establish an independent installation or paying customer. Link original work packages, tranche, release or work order when their source is available. A handover date and receiving operator are required only when recording an actual handover.
3. Select the original jobs to receive. A matching intent or network/transaction must stay on its existing purchase. A later recovery or saved-file observation extends that same purchase; it does not create another transfer or another completed intent. Existing purchase attribution and deployment remain intact. Conflicting identities are shown before saving.
4. Record the receiving or reconciliation reason and choose **Receive selected original jobs**. This one original Operations command saves the exact JSON, native HTML review, deployment association and selected purchases atomically. The ordinary case journal records the actor, note, selected and unselected jobs, before/after values and source metadata.
5. Reopen **Received original buyer sources**, download the exact original or its native review, and inspect **Deployment / buyers** and the ordinary report. The full handoff remains retained even when some jobs were left unselected. Its source counts and the selected case-metric population stay visible separately.

The form retains draft choices when refreshing, changing views or encountering a version conflict. Before dispatch it stores the stable original request ID and request metadata, without the uploaded file bytes. After an interrupted response, choose **Recover original request**. The client reuses the exact request and case version; the existing transaction returns its committed result before applying a version check. If the browser was reloaded before the source was received, reselect the same file; its SHA-256 and size must match. A known committed result remains known if local draft cleanup fails.

A definite case-version conflict preserves the source and draft for a fresh review. It does not replace another operator's records. Closed cases use the existing **Reopen review** action before receiving another observation.

## Meaning of the observed fields

| Field | Source and interpretation |
| --- | --- |
| Intent, request and reservation | Original native Inbox/request/evidence identities; later observations preserve them. |
| Atomic amount | Exact accepted original terms or original finalized amount, as a decimal integer string. The configured maximum is never substituted as a payment amount. Zero means the source has not established an amount. Network and asset remain attached to every amount. |
| Attempt | Signed evidence, the original payment-sent result, or finality establishes an attempted payment. Unknown signing state remains explicitly unresolved. A started local command alone is not counted as a known signed intent. |
| Settlement | Original SF52 chain evidence or the saved SF36 finalization view; the receiver makes no fresh RPC or ledger request. Seller-reported settlement remains pending without that evidence. |
| Output | `COMPLETE` requires the exporter to verify the exact saved response bytes and hash through the original native response reader. This is verification at capture time. The receiving machine need not have the private response path. |
| Observation time | The actual capture timestamp. The original attempt start remains separate. Terminal, recovery or accounting timestamps are not substituted for chain settlement or response-completion times. |
| Operator / participant class | Explicit reviewed deployment attribution. Later observations retain the class originally recorded for the purchase. |
| Grant or commercial state | Buyer receiving does not record an award, grant payment, cash receipt, customer agreement or issuer acceptance. Those remain their original sourced Operations actions. |

The existing report computes counts and denominators from its original purchase records. Selected observations do not turn unselected jobs into completed purchases. An exact repeated source/association reopens without advancing the case version. An original atomic amount outside the existing Operations field bound is reported for review and is never rounded or truncated.

## CLI receiving

Run these from the original SF47 `workspace` directory. `--workspace` belongs to the maintained `operations` command, before its subcommand:

```bash
python3 cli.py operations --workspace /ABSOLUTE/GRANT-WORKSPACE buyer-preview \
  --case ORIGINAL_OPERATION_CASE \
  --expected-version CURRENT_CASE_VERSION \
  --file /ABSOLUTE/PRIVATE-RECEIVING/buyer-operations.json \
  --output /ABSOLUTE/PRIVATE-RECEIVING/buyer-review.json
```

The review returns `previewSha256`, complete original rows, existing purchases and deployments. Prepare a JSON array containing only the reviewed original selections:

```json
[
  {"jobId":"ORIGINAL_JOB_SHA256","purchaseId":null}
]
```

Use the exact existing purchase ID instead of `null` when the preview identifies a prior intent/transaction. Save the selection and a new deployment's explicit fields in private JSON files, then run:

```bash
python3 cli.py operations --workspace /ABSOLUTE/GRANT-WORKSPACE buyer-receive \
  --case ORIGINAL_OPERATION_CASE \
  --expected-version REVIEWED_CASE_VERSION \
  --actor "Actual recording operator" \
  --request-id ORIGINAL_RECEIVING_REQUEST_ID \
  --note "Actual receiving and deployment association reason" \
  --file /ABSOLUTE/PRIVATE-RECEIVING/buyer-operations.json \
  --expected-preview-sha256 EXACT_PREVIEW_SHA256 \
  --selections /ABSOLUTE/PRIVATE-RECEIVING/selections.json \
  --deployment EXISTING_ORIGINAL_DEPLOYMENT
```

For a new deployment replace `--deployment` with `--deployment-file /ABSOLUTE/PRIVATE-RECEIVING/deployment.json`. Required deployment fields are the ordinary `name`, `operator`, `role`, `participantClass`, `environment` and `state`; `operatorId`, original `costIds`, `tranche`, endpoint/release/case references, handover fields and source note use the same original domain contract. Keep the exact command inputs and request ID after an uncertain response.

## API integration

Use the original authenticated SF47 HTTP server and its same-origin request rules. Node is required alongside the existing Python workspace; `SF47_BUYER_NODE` may select an explicit installed Node executable when it is not on `PATH`. The receiver launches the installed original source reader with a bounded process budget. It never launches a buyer attempt.

`POST /api/operations/{caseId}/buyer-preview` accepts:

```json
{"expectedVersion":1,"filename":"buyer-operations.json","contentBase64":"EXACT_ORIGINAL_BASE64"}
```

It returns `caseId`, `version`, source identity, native reader provenance, complete counts/rows, native HTML, existing deployments/purchases and `previewSha256`. Each row includes `jobId`, `intentId`, original source hashes, native outcome/finalization/output, proposed ordinary purchase fields, `issues`, `canReceive`, `matches`, `suggestedPurchaseId`, `identityConflicts` and `receiving` (`NEW_ORIGINAL`, `OBSERVE_ORIGINAL` or `CONFLICT`). Preview performs no case mutation.

Receive through the existing `POST /api/operations/{caseId}/command` envelope:

```json
{
  "expectedVersion":1,
  "actor":"Actual recording operator",
  "note":"Reviewed original association",
  "requestId":"ORIGINAL_RECEIVING_REQUEST_ID",
  "action":"buyer.receive",
  "data":{
    "filename":"buyer-operations.json",
    "contentBase64":"EXACT_ORIGINAL_BASE64",
    "expectedPreviewSha256":"EXACT_PREVIEW_SHA256",
    "deploymentId":"EXISTING_ORIGINAL_DEPLOYMENT",
    "selections":[{"jobId":"ORIGINAL_JOB_SHA256","purchaseId":null}]
  }
}
```

Use `deploymentId:null` plus `deployment:{...}` for a new reviewed deployment. A successful original command returns the case/version/action, deployment `recordId`, `sourceIds`, source SHA-256, selected `purchaseIds`/`selectedJobIds`, all-source job count, `unselectedJobIds` and `unchanged`. Repeating the same original request ID requires exactly the same input. This source action uses the existing record collections, source table, transaction and journal; there is no second buyer ledger.

## Export, restore and continue

Use **Export complete case** or the original `operations export` CLI at the current reviewed version. The bundle contains the pinned planning revision, original Operations records and event history, exact buyer JSON/HTML attachments, associations and ordinary CSV reports. Import that complete case using its original receiving action, then reopen **Native buyer receiving** and the original purchase records. The `buyerHandoff` source metadata retains original job-to-purchase links and the full capture identity through export/import.

Preserve the native Inbox separately with its existing buyer recovery workflow. Restoring a grant case does not substitute for the native buyer state, replay a payment or make a previously saved response file available. To record a later original recovery, capture that same original Inbox again and explicitly associate the source with the existing case purchase.
