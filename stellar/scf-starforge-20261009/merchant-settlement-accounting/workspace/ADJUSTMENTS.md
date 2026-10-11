# Merchant accounting adjustments

The **Adjustments** desk keeps each original gross payment beside its dated cancellation decisions, refund requests and verified returned transfers. It uses the existing merchant accounting workspace, original reconciliation captures, SF86 transfer verifier and retained review archives.

Open the original workspace with the maintained command:

```sh
starforge merchant-accounting-workspace --workspace /private/accounting-workspace
```

For a source checkout, run `node workspace/server.mjs` from `merchant-settlement-accounting` with the same arguments. A new workspace still uses the original `--outbox`, `--proof-dir` and `--terms` setup described in the main workspace guide. Reopening uses the retained source paths.

## Work from the original payment

1. Open **Adjustments**, choose a completed reconciliation and select its retained event. Search by event, route or payment option. The original ledger inspector also has **Open adjustments**.
2. Review the original amount, network, payment option and source identity. The summary shows the exact atomic amounts for that payment.
3. Choose **Refund request** or **Cancellation**, enter the amount, effective date and time in UTC, reason and optional merchant reference. Set the existing workspace operator field.
4. Select **Preview adjustment**. The review shows the normalized amount, original event, effective date, reason, operator and saved workspace revision.
5. Select **Save refund request** or **Save cancellation**. The retained action appears in the payment's history with its creation time and operator.

A preview belongs to the exact saved workspace revision and source identity that it reviewed. If another action changes that state, the form preserves its draft and asks for a fresh preview. A saved action has a stable adjustment ID; reopening its detail returns the original request and its later history.

Refund requests use the original independently matched payment and its retained SF86 proof to identify the return direction. The return goes from the original recipient to the original payer, in the original asset and network. To make a newly available payment proof part of this workflow, capture a reconciliation with that original proof and select its retained event.

## Read the amounts correctly

Amounts remain decimal strings in the original asset's atomic units. Enter whole numbers without decimal points or thousands separators. The desk keeps payment options and assets attached to their original events.

| Figure | Meaning |
| --- | --- |
| Original gross | The amount of the retained original payment. |
| Verified returned | The sum of linked refund requests whose returned transfers have reached `VERIFIED`. |
| Remaining amount | Original gross minus verified returned. |
| Open requests | The sum of linked refund requests in `REQUESTED` or `VERIFYING`. |
| Available for a new request | Remaining amount less open requests, with a minimum of zero. |
| Cancellation amount | The sum of dated merchant cancellations retained for that event. |

A cancellation records a merchant decision and its amount. A refund request adds its amount to open requests when calculating what remains available for further requests. The returned total increases when SF86 verifies the matching reverse transfer. Partial and full returned states follow those verified amounts.

The effective date records when the merchant says the adjustment applies. A verified return also retains its network transfer time, verification time, ledger and transaction. Each date remains available with its own meaning in the saved history and exports.

## Verify a returned transfer

Choose a saved refund request under **Verify a returned transfer**. Review its exact amount, asset, network, return sender and return recipient. Enter the already executed return transaction hash and select **Verify returned transfer**.

The workspace uses the original network endpoint by default. The optional RPC endpoint field accepts the original SF86 network endpoints. A host that uses the original HTTPS proxy transport can start the workspace with:

```sh
starforge merchant-accounting-workspace \
  --workspace /private/accounting-workspace \
  --rpc-proxy-env HTTPS_PROXY
```

The job is saved before its network read starts. The browser stays responsive and shows its progress. The original controller owns its request, deadline, persistence and shutdown. A successful official transfer match records `VERIFIED`, its proof and the exact returned amount.

| Saved state | Operator view |
| --- | --- |
| `REQUESTED` | The refund request is retained and ready for an explicit transfer check. |
| `VERIFYING` | A retained verification job is queued or reading the original network result. |
| `VERIFIED` | The matching returned transfer contributes to the returned total. |
| `WITHDRAWN` | The unverified request was withdrawn with its reason; its history remains retained. |
| `RECORDED` | A cancellation and its effective amount are retained. |

The verification table shows completed, failed and interrupted attempts with their transaction, operator and retained result. Choose **Load saved request** on a failed or interrupted attempt to restore its transaction and endpoint, review the request, then explicitly verify again.

A workspace restart retains interrupted attempts and their requests. When the matching native proof file was completely saved before its workspace state commit was interrupted, reopening the workspace or that exact saved job completes the retained verification from the original saved proof. It restores `VERIFIED` and the returned total without issuing another RPC read.

An interrupted attempt with no completed matching proof returns its request to `REQUESTED`. A request in that state can also be withdrawn with a reason. A request currently being verified becomes available for withdrawal after that attempt finishes without a matched return.

Use separate retained refund requests for separate partial returns. Each verified transaction is bound to its exact saved request and cannot be assigned again to another returned amount in the workspace.

## Reopen and hand off the work

Select any saved action to inspect its complete request, dated history and verification result. The original gross payment and its source identity remain visible beside that history. A later reconciliation of the same original event can display its linked retained adjustments.

**Download current JSON / CSV / HTML** produces the selected reconciliation's current adjustment view. It includes the original amounts and dated linked actions. JSON carries the complete retained records and verification attempts; CSV and HTML provide an accountant-readable view.

**Create review archive** uses the original accounting export writer. It freezes `adjustments.json`, `adjustments.csv` and `adjustments.html` alongside the original report, review notes and input manifest. The retained export records their hashes and byte counts. The source-file checkbox controls the original private source capture inclusion. Reopening that archive returns the same saved snapshot.

Original period closes freeze the same adjustment companion with their close. The accountant handoff uses that retained snapshot and its adjusted amount fields. Use the original **Accountant handoff** and **Periods** desks to prepare and reopen those saved packets and closes.

## Command-line workflow

Every command below is forwarded by the existing `merchant-accounting-workspace` command.

Use `--url http://127.0.0.1:8446` while the original browser server owns the workspace. Use `--workspace /private/accounting-workspace` to reopen it directly after the server has stopped. Both modes use the same original controller and revision checks.

### Find an event and inspect its history

```sh
starforge merchant-accounting-workspace adjustments status \
  --url http://127.0.0.1:8446

starforge merchant-accounting-workspace adjustments events \
  --url http://127.0.0.1:8446 --run RUN_ID --offset 0 --limit 50

starforge merchant-accounting-workspace adjustments event \
  --url http://127.0.0.1:8446 --run RUN_ID --event EVENT_ID

starforge merchant-accounting-workspace adjustments detail \
  --url http://127.0.0.1:8446 --id ADJUSTMENT_ID
```

Replace the uppercase IDs with values from the retained workspace. `events` accepts `--search TEXT` and pages of up to 200 rows. `status` returns the revision, counts and most recent 100 adjustments and jobs. `event`, `detail` and `export` provide the selected original payment's complete retained history.

### Prepare and record the reviewed action

Create a request JSON object with these fields:

| Field | Value |
| --- | --- |
| `runId` | The selected completed reconciliation UUID. |
| `eventId` | Its original retained event ID. |
| `kind` | `REFUND` or `CANCELLATION`. |
| `amountAtomic` | The positive whole-number amount as a JSON string. |
| `effectiveAt` | An exact UTC timestamp, for example `2026-10-11T09:30:00.000Z`. |
| `reason` | The customer request or merchant decision. |
| `reference` | A merchant reference, or an empty string. |
| `actor` | The operator retaining the action. |

```sh
starforge merchant-accounting-workspace adjustments preview \
  --url http://127.0.0.1:8446 \
  --input /private/refund-request.json --out /private/refund-preview.json

starforge merchant-accounting-workspace adjustments record \
  --url http://127.0.0.1:8446 --preview /private/refund-preview.json
```

Review the saved preview before recording it. It retains the request ID, creation time, source-bound review hash and workspace revision. Recording reads those exact values. If the saved workspace changes, create a new preview in a new output file and review that result.

The request body uses the original field schema. User-supplied `id` and `createdAt` are optional; the preview assigns them when omitted. Output files are created with mode `0600` and must be new paths.

### Verify, reopen a job or withdraw a request

Read the current revision from `adjustments status` and pass it with the operator's action:

```sh
starforge merchant-accounting-workspace adjustments verify \
  --url http://127.0.0.1:8446 --id ADJUSTMENT_ID \
  --transaction RETURN_TRANSACTION --actor OPERATOR --expect REVISION

starforge merchant-accounting-workspace adjustments job \
  --url http://127.0.0.1:8446 --id JOB_ID

starforge merchant-accounting-workspace adjustments withdraw \
  --url http://127.0.0.1:8446 --id ADJUSTMENT_ID \
  --reason "Customer withdrew the request" --actor OPERATOR --expect REVISION
```

`verify` prints the saved job ID, waits for that exact job and returns its retained result and current adjustment. A failed or interrupted attempt produces a nonzero exit status and keeps its saved details available through `job`.

When the CLI uses the running server, interrupting the local wait leaves that server's retained job available to reopen. Direct `--workspace` operation owns the original workspace lifecycle, waits for the job before closing, and drains an interrupted operation through that owner.

For direct verification, `--rpc-proxy-env HTTPS_PROXY` configures the original transport. For `--url` operation, configure that flag on the existing server. `--rpc-endpoint` selects an original supported endpoint for this verification.

### Export the current retained adjustment view

```sh
starforge merchant-accounting-workspace adjustments export \
  --workspace /private/accounting-workspace --run RUN_ID \
  --format json --out /private/merchant-adjustments.json
```

Use `json`, `csv` or `html`. The command prints the created file's path, exact byte count and SHA-256. Use **Create review archive** in the browser when the handoff should retain the full original review package and its frozen adjustment companion.

## Existing API joins

These routes run inside the original loopback server, current maintenance owner and revision lifecycle. POST requests use its existing JSON request header.

| Operation | Route |
| --- | --- |
| Recent records, jobs and revision | `GET /api/adjustments` |
| Paged original events | `GET /api/adjustments/events?runId&offset&limit&search` |
| Original event and full linked history | `GET /api/adjustments/event?runId&eventId` |
| Preview request | `POST /api/adjustments/preview` |
| Retain reviewed request | `POST /api/adjustments/record` |
| Reopen saved adjustment | `GET /api/adjustments/:id` |
| Queue original return verification | `POST /api/adjustments/:id/verify` |
| Reopen exact retained job | `GET /api/adjustments/jobs/:id` |
| Withdraw an unverified request | `POST /api/adjustments/:id/withdraw` |
| Current adjustment export | `GET /api/adjustments/export?runId&format=json\|csv\|html` |
| Original frozen review archive | `POST /api/runs/:runId/exports` |

The original workspace holds the records and jobs in its current state, retains request and return-proof files under its existing directory, and freezes their accountant-facing snapshots through the original report, period and handoff writers.

