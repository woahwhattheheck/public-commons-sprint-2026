# Service adjustment and buyer/accountant handover

A service report can now travel through an original payment adjustment, buyer bookkeeping, an issued period and an accountant handoff in one saved merchant case. The operator reviews the service incidents and monetary basis, executes the saved native action, receives the complete accounting capture in the buyer workspace, codes the purchase and credit, resolves the period, and delivers its original files.

The browser, HTTP API, MCP tools and command-line receiver use the same case operation in `case-service-adjustments.mjs`. Native actions use the admitted `MerchantAccounting` and `MerchantBuyerExpenses` owners. Their existing workspace, revision, recovery and close behavior remains authoritative.

## Open the workspace

Use the repository's supported Node runtime and existing private case, accounting and buyer directories. The buyer owner uses the original SF36 Python workspace.

For a standalone Support server, pass the original host configuration files:

```bash
node stellar/scf-starforge-20261009/sf74-merchant-support-console/server.mjs \
  --cases-dir /absolute/private/merchant-cases \
  --incident-sources /absolute/private/incident-sources.json \
  --accounting-config /absolute/private/accounting.json \
  --buyer-expense-connection /absolute/private/buyer-expenses.json \
  --port 8784
```

Open the displayed local address and choose **10 Adjustments**, or open `/adjustments?case=CASE_UUID`. The page starts with the saved case and its retained reports. Original accounting and buyer workspaces open when the operator selects **Open accounting**, **Open buyer workspace** or **Open accountant workspace**.

`accounting.json` uses the existing Accounting configuration, for example:

```json
{
  "workspaces": {
    "merchant": {
      "label": "Merchant accounting",
      "directory": "/absolute/private/merchant-accounting",
      "outboxDir": "/absolute/private/original-outbox",
      "proofDir": "/absolute/private/original-proofs",
      "termsFile": "/absolute/private/original-terms.json"
    },
    "accountant": {
      "label": "Buyer accountant",
      "sourceMode": "buyer",
      "directory": "/absolute/private/buyer-accountant"
    }
  }
}
```

`buyer-expenses.json` uses the existing buyer connection:

```json
{
  "schema": "stellar-forge.buyer-expense-connection.v1",
  "workspaces": {
    "buyer": {
      "directory": "/absolute/private/buyer-workspace",
      "python": "python3"
    }
  }
}
```

Keep each existing native directory with its current owner. An embedded server can receive `adjustmentDesk` through `createConsoleServer`; the caller supplies and closes the same original owners. The standalone `start` function creates the configured owners, drains the case operations and closes both owners. MCP Support receives the Accounting and Buyer Expenses instances through the existing provider dependency lifecycle.

Host paths and configuration belong in the private host configuration. Browser and MCP operations select declared aliases. Managed startup binds the selected connection file identities along with the original Support selection.

## 1. Review the service adjustment

1. Open the saved case and select its retained service report.
2. Open the original accounting workspace, choose a completed reconciliation, and choose the original payment. The page can continue through additional reconciliations and payments.
3. Select the incidents covered by this decision.
4. Enter the adjustment amount in the original asset's atomic units, the effective UTC time, reason and business reference.
5. Enter the documented monetary basis: amount, reference and description.
6. Choose **Review proposal**, review the complete preparation, then **Save reviewed proposal**.

The proposal retains the original report, selected incident identities, documented basis, Accounting alias, native payment preview and named operator. Service time calculations support the decision; the monetary amount comes from the explicitly reviewed original payment and basis.

A preparation is available for review before it is saved. It carries the case revision and the original commissioning revision observed during preparation. If another operation changes that case before saving, reopen its current state and review the updated preparation. The complete preparation can be downloaded from the review panel.

## 2. Record, verify and capture

Choose the saved proposal and prepare the original adjustment. Save that prepared native action, select it in **Saved native action**, and execute it. A native intent is immutable; its saved request drives the original controller.

For a refund, enter the already executed returned transaction. The original network endpoint is used when the RPC field is empty. An explicitly selected original endpoint can be supplied when operating the corresponding native network or retained native receiving environment. Save the verification intent and execute it.

A verification can first return a queued or running observation. **Refresh original verification** observes that same saved intent and native job with a new execution request. Retrying an interrupted HTTP/MCP execution uses the original request ID and returns that request's original observation.

After the original verification completes, prepare and save **buyer capture**, then execute it. The capture contains the complete original accounting JSON, CSV and HTML, plus the original buyer compiler's received purchase and verified credits. Its original export basename and bytes remain bound throughout buyer preparation.

The native history shows the original adjustment and verification status, transaction and retained outcome. The selected proposal exposes its full customer delivery:

| File | Content |
| --- | --- |
| Complete handover JSON | Proposal, original native intents/outcomes, saved buyer intents/outcomes, case identity and file bodies |
| Customer summary | Readable original service report context, reviewed basis, incident timing and native adjustment status |
| Service report | Original retained report with its exact service computation |
| Original case | The selected saved case record |
| Complete workspace | The complete original serialized workspace |
| Accounting JSON, CSV and report | Original files from each selected saved accounting capture |
| Buyer source | Exact original accounting source accepted by the native buyer compiler |

Every download identifies its original filename, byte count and SHA-256. The browser receives the complete bytes before checking the advertised digest and offering the file.

## 3. Receive and code the buyer adjustment

Open the original Buyer workspace and select the saved adjustment capture.

**Receive adjustment** records its name, provenance and declared operational/development context. Save and execute that buyer intent. **Read original buyer state** then reads the received packets, linked purchase, verified credits, cost centers, labels and periods.

Review the received packet with a named operator and reason. When accepting it, select the original purchase or explicitly register the original verified purchase carried by the received packet.

Prepare cost centers and asset labels as needed. Labels are read as a complete original set before editing; saving checks that this original label basis still matches. Existing cost centers and periods are likewise compared with their loaded original records before preparing an update.

For purchase or credit coding:

1. Select the original received packet and its linked purchase or verified credit.
2. Read the current original coding basis.
3. Set the recognition date and memo.
4. Enter allocations using original cost-center IDs, exact atomic amounts, and any reviewed project and account codes.
5. Review, save and execute the prepared action.

The native buyer checks the allocation total and current source basis. The Service adapter binds the intent to the exact saved capture and original buyer workspace.

## 4. Review, close and reopen a period

Define or select the original reporting period. Its report exposes the current unresolved issues.

For **Resolve period issue**, select an actual current issue and one of that issue's `allowed_kinds`. The UI reads these choices from the native report. It retains the issue's original item, code and basis with the operator's reason.

Save the period review using the reviewer's name, role and notes. Issue the close against that original ready review. The resulting original review and close references remain available in the saved buyer outcome and are filled into the next operation when performed in the browser.

**Reopen period** records the operator and reason through the original buyer transaction. Previously issued editions remain in the native history. A later review and close represent their own original edition.

## 5. Deliver to the accountant and receive the return

Prepare and execute **Prepare accountant delivery** using the issued close. The original buyer supplies all four files:

- `issued-buyer-accountant-source.json`
- `buyer-expense-accountant-edition.zip`
- `buyer-bookkeeping-complete-period.zip`
- `buyer-expense-complete-project.zip`

Select that saved delivery, open the intended original Accountant workspace, and prepare **Create accountant handoff**. The existing Accountant controller previews the exact issued buyer source and creates the saved handoff. The case retains its original workspace/source binding, handoff ID and complete returned files.

When the accountant returns a bookkeeping file:

1. Choose the original issued close and complete returned JSON file.
2. Choose **Review original accountant return**.
3. Review any accepted handoffs that this return replaces. Select each displayed original return and record the replacement reason.
4. Review, save and execute **Receive accountant return**.

The saved intent contains the original file bytes, file digest, native preview digest and explicitly selected superseded return IDs. The native buyer rechecks that exact preview against the current issued history before acceptance. The result is retained in both the original buyer request journal and the case's original commissioning materials.

## Recovery during ordinary work

The page retains complete prepared and pending requests in IndexedDB, scoped to the local origin and original case. A transactional compare-and-write prevents another tab from replacing a different unresolved request. A completed submission clears only its own saved preparation.

If a response is interrupted, reopen the same case and choose **Retry the same request**. The request ID and complete body remain unchanged. Native accounting and buyer outcomes are retained before their result is appended to the saved case, so an accepted native operation can finish the case append without repeating the native effect.

An unrelated case edit can proceed while a native operation is running. Completion rereads the current case, appends its original outcome through the original commissioning operation, and preserves the other work. Repeated case conflicts are returned with their original state for continuation.

A rejected preparation can be cleared and reviewed again. An uncertain execution remains available for exact recovery. For a later verification observation, select the existing verification intent and use **Refresh original verification**.

Closing Support drains admitted Service operations before the original Accounting and Buyer owners close. The Service adapter never creates a substitute native workspace or request journal.

## MCP operation

The Support provider exposes these complete operations:

| Purpose | Tool |
| --- | --- |
| Read reports, proposals, intents or outcomes | `merchant_service_adjustment_read` |
| Accounting aliases | `merchant_service_adjustment_sources` |
| Open/status/page original accounting | `merchant_service_adjustment_accounting` |
| Prepare proposal | `merchant_service_adjustment_preview` |
| Prepare native record/verify/capture | `merchant_service_adjustment_prepare` |
| Save complete proposal or native intent | `merchant_service_adjustment_retain` |
| Execute/observe original native intent | `merchant_service_adjustment_execute` |
| Receive original customer/native file | `merchant_service_adjustment_file` |
| Read saved buyer records | `merchant_service_buyer_read` |
| Buyer aliases and source choices | `merchant_service_buyer_sources` |
| Open/status/close original buyer owner | `merchant_service_buyer_workspace` |
| Inspect original buyer/coding/period | `merchant_service_buyer_inspect` |
| Prepare buyer/accountant operation | `merchant_service_buyer_prepare` |
| Save complete buyer intent | `merchant_service_buyer_retain` |
| Execute original buyer/accountant intent | `merchant_service_buyer_execute` |
| Preview original accountant return | `merchant_service_buyer_accountant_preview` |
| Receive complete saved buyer/accountant file | `merchant_service_buyer_file` |
| Continue/release retained file snapshots | `merchant_service_adjustment_file_reads`, `merchant_service_adjustment_file_release` |

A preparation returns its full `proposal` or `intent`, `case.revision` and commissioning `revision`. Retain that exact material with:

```json
{
  "id": "ORIGINAL_CASE_UUID",
  "expectedRevision": "RETURNED_CASE_SHA256",
  "expectedImplementationRevision": 0,
  "requestId": "RETAINED_REQUEST_UUID",
  "material": {}
}
```

Replace the example revision and material with the returned values. Execute the saved intent with `id`, `intentId` and a retained `requestId`.

Summary reads omit large original file bodies. Select a `recordId` for the complete original record. File calls use the case revision, original selection and a retained file read ID; continue its offsets until all bytes have been received, then release the connection's temporary snapshot.

## HTTP and CLI

The local HTTP routes mirror the case API:

- `GET /api/adjustments/sources`
- `POST /api/adjustments/accounting/{open,close,status,runs,events,event}`
- `POST /api/adjustments/buyer/{open,close,status}`
- `GET /api/cases/:id/adjustments`
- `GET /api/cases/:id/adjustments/buyer`
- `POST /api/cases/:id/adjustments/{preview,intent,material,execute,download}`
- `POST /api/cases/:id/adjustments/{buyer-inspect,buyer-intent,buyer-material,buyer-execute,buyer-download,buyer-accountant-preview}`

For a case route, the path supplies `id`; the body carries the remaining exact method arguments. Read routes support their declared revision, section, record and page selection. Browser requests use the original same-origin local server.

The CLI receives a private JSON file containing `{"method":"METHOD","args":{...}}` and talks to that already running Support owner:

```bash
node stellar/scf-starforge-20261009/sf74-merchant-support-console/service-adjustments-cli.mjs \
  --url http://127.0.0.1:8784/ \
  --request-file /absolute/private/request.json \
  --out /absolute/private/retained-operation
```

Supported methods include `sources`, `buyerSources`, `accounting`, `buyerWorkspace`, `read`, `preview`, `prepareIntent`, `retain`, `execute`, `download`, `buyerRead`, `inspectBuyer`, `prepareBuyerIntent`, `retainBuyer`, `executeBuyer`, `downloadBuyer` and `previewBuyerAccountantReturn`.

For one complete customer/accountant delivery, use:

```json
{
  "method": "delivery",
  "args": {
    "id": "ORIGINAL_CASE_UUID",
    "proposalId": "SAVED_PROPOSAL_UUID"
  }
}
```

An optional `revision` chooses an existing saved case revision. Otherwise the CLI selects the current revision once and retains that immutable delivery selection. It receives the full handover, customer summary, report, original case/workspace, every selected native capture and its buyer/accountant files into `--out`.

The output contains the exact original request and `service-adjustment-delivery.json`, with each complete file's original name, byte count, digest and request. Re-running the same delivery directory completes or reopens the same selected files even after the case acquires later work.

For ordinary mutations, `--out` retains the original CLI request before sending it and stores the complete result. Reuse that request file and directory after an interrupted response.

## Native receiving

`service-adjustment-journey.mjs` exports `receiveServiceAdjustments`. The receiving entry supplies:

- the original source and receiving case stores;
- the admitted original Accounting owner and configured alias;
- the saved Service case/report;
- the original run/event, reviewed amount/basis and returned-transfer selection;
- the persistent browser context and both original local Support URLs;
- the original complete-case transfer callback;
- the buyer/accountant receiving callback; and
- the selected product source commit and retained receiving directory.

The original native producer supplies its actual payment proofs, returned-transfer bytes and RPC results. The receiving operation saves its own stable request IDs before actions, then continues the same original directory after interruption.

The complete journey operates the native record through the browser, retains an accepted response before interrupting its delivery, and recovers the exact original request. It completes the original returned-transfer verification and buyer capture, invokes the full buyer/accountant operation, preserves an unfinished Service form, transfers the final complete case, and receives every actual customer/native/accountant download in both source and receiving browsers. It retains desktop/mobile images and a resumable `service-adjustment-receiving.json`, then writes `service-adjustment-result.json` on completion.

The complete case is frozen after buyer/accountant results have reached its original commissioning journal. The receiving workspace therefore carries the full operation and all original delivery files.

## Source ownership

| Module | Responsibility |
| --- | --- |
| `service-adjustments.mjs` | Typed original Service proposal, native intent/outcome and commissioning retention |
| `service-adjustments-native.mjs` | Original Accounting controller preparation/execution and complete original file capture |
| `service-buyer-handover.mjs` | Original buyer/accountant intent, request recovery, period delivery and returned-file acceptance |
| `case-service-adjustments.mjs` | Saved-case API, current case append, complete delivery and lifecycle drain |
| `service-connections.mjs` | Existing private host configuration and original owner lifetime |
| `adjustments.html`, `adjustments.mjs`, `adjustments.css` | Neutral industrial browser operation and retained request recovery |
| `service-adjustments-cli.mjs` | Same-owner command-line operation and complete file receiving |
| Operator Support catalog/provider | Existing MCP tool declarations and original dependency ownership |
| `service-adjustment-journey.mjs` | Full original native/browser/buyer/accountant receiving operation |
