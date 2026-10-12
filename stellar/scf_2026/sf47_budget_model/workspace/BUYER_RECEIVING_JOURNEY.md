# Receive an original buyer result through SDK, browser and agent

This continuation joins a saved SF88 Inbox observation to the original SF47 Operations case, then exports and reopens that complete case. It uses the maintained Node Inbox, Python Inbox, queue CLI, Operations browser, typed grant client and 58-tool merchant grant provider. The reusable source does not include a buyer workspace, account, original case archive or purchase result.

The source is published independently of its execution. A completed result requires the retained run's `result.json` with `allOwnedServicesClosed: true`, the referenced native agent result, and the exact final workspace archive. Source publication and a historical purchase receipt do not establish that this receiving continuation has run.

## Original runtime and source

`buyer-receiving-runtime.json` records the 195 selected source paths and exact Git blob identities for this whole continuation. Materialize those retained blobs at their recorded relative paths and verify every identity before starting. The manifest is an explicit source selection: it preserves the original buyer runtime from `3afca9599b602b67a8b722043061100e2efef294`, the maintained receiving continuation, and the cohort/client application changes at `704df543668351f125f7beb0222789724a657127`. Its `head` is that application source anchor; its exact `files` list is authoritative for the selected runtime. Later unrelated package changes are not silently substituted into that selection.

The selected source includes these receiving files beside the original `cli.py`:

- `buyer-operations-receiving.mjs`: the single SDK, browser, agent and receiving controller.
- `buyer-agent-receiving.mjs`: the original agent phase with the additive cohort/client join, Git blob `603e0c05eeac9db8b3f2db8babbb8d29b9de2fa5`.
- `cohort-operations-receiving.mjs`: the optional original-case cohort phase, Git blob `6e6b008dc603ea8affe376eb28000d35ef5ab923`.

The controller checks that exact agent helper before invoking it. The helper checks the original typed client, grant provider and 58-tool catalogue blobs. The runtime manifest identifies source files; it is not an execution result or a private input package.

Use existing compatible Node, Python, Playwright and Chromium installations. Set executable and module paths explicitly for the selected host. No new service, account, purchase or workspace binding is created around the original buyer Inbox. The receiving Operations workspace is a separate import of the complete original case, preserving its record identities and history.

## Prepare the private inputs

Keep the following originals available to the one receiving operator:

1. The existing SF88 Inbox directory with the selected intent's original metadata and the response files referenced by its native reader.
2. The complete original SF47 case ZIP and its exact byte length and SHA-256.
3. The original case, plan and selected purchase IDs from that ZIP. The receiving import obtains its own case ID while retaining the original purchase and deployment IDs.
4. A private, empty continuation directory outside the Inbox, plus the existing runtime paths.

A public result-only ZIP is insufficient for the Inbox reader. An archive name or Library metadata response does not prove that its members include the necessary Inbox and response closure. Establish the scope of the actual carrier before moving the run to another host. Keep private workspaces within their existing authorized receiving path.

Record the original plan and population counts from the selected case. Do not substitute a newer independent case with a similar title, recreate the purchases, or copy only the selected row. The driver preserves the unselected purchases, deployments, forecasts, portfolios, reviews, completion plans, source metadata and original history prefix.

## Configuration

Save one private JSON configuration. The paths below are placeholders for the already selected host and original inputs; IDs, counts and hashes must come from the actual original case and Inbox.

```json
{
  "schema": "sf47.native-buyer-receiving-config.v1",
  "sourceRoot": "/absolute/original-source",
  "sourceHead": "704df543668351f125f7beb0222789724a657127",
  "workDirectory": "/absolute/private-receiving",
  "inboxDirectory": "/absolute/original-buyer/inbox",
  "intentIds": ["original-intent-id"],
  "actor": "Named receiving operator",
  "caseName": "Original operating case / buyer receiving",
  "receivingNote": "Receive the selected retained buyer observation.",
  "nodeExecutable": "/absolute/node",
  "pythonExecutable": "/absolute/python",
  "browserExecutable": "/absolute/chrome-headless-shell",
  "playwrightModule": "/absolute/playwright-core/index.mjs",
  "preservedPaths": [
    "/absolute/original-buyer/inbox",
    "/absolute/original-buyer/buyer-state",
    "/absolute/original-case.zip"
  ],
  "originalCase": {
    "path": "/absolute/original-case.zip",
    "bytes": 0,
    "sha256": "<actual archive SHA-256>",
    "caseId": "<original operation ID>",
    "version": 0,
    "planId": "<original plan ID>",
    "counts": {
      "purchases": 0,
      "deployments": 0,
      "forecasts": 0,
      "portfolios": 0,
      "sources": 0
    },
    "selections": [
      {
        "intentId": "original-intent-id",
        "purchaseId": "<original purchase ID>"
      }
    ]
  },
  "expected": [
    {
      "intentId": "original-intent-id",
      "purchase": {
        "network": "<original network>",
        "transactionHash": "<original transaction hash>",
        "ledger": 0,
        "amountStroops": "<exact original integer string>",
        "settlementStatus": "SETTLED",
        "outputStatus": "COMPLETE",
        "deliveredBytes": 0,
        "deliveredSha256": "<actual response SHA-256>"
      }
    }
  ],
  "agentReceiving": {
    "operationId": "ORIGINAL-RECEIVING-OPERATION"
  },
  "cohortReceiving": true
}
```

The joined agent phase currently accepts one explicitly selected purchase. Its operation ID is 1–76 characters from letters, numbers, dots, underscores and hyphens; it becomes the stable agent request prefix. Python and Node must be absolute paths. The declared Node must resolve to the executable actually running the controller.

Amounts such as stroops remain decimal strings. Expected network, payment, settlement and response values must reflect the original observed purchase. Case population counts and dates are taken from the selected source, without changing commercial proposal or acceptance stages.

Set `cohortReceiving:true` for the retained SCF v37 application continuation described here. It requires the supplied original team-operated population and selected Routescan proof; it does not replace them with a new example case. Omit the flag when running only the earlier buyer-receiving workflow. The complete source still includes the cohort module and original 58-tool provider.

## Run one continuation

With the existing native admission owner, run the controller once under the original retained operation:

```sh
/absolute/node /absolute/original-source/stellar/scf_2026/sf47_budget_model/workspace/buyer-operations-receiving.mjs /absolute/private-config.json
```

Use the maintained host's memory, disk, process and lifetime accounting for the whole browser and agent workload. The controller is not a scheduler. Keep the same admitted record on interruption; inspect its authoritative state before resuming it. Do not submit an additional run for a lost foreground session.

The controller records the exact configuration hash in `continuation.json`. Subsequent invocations require those same bytes. Its operation requests and agent input are persisted before the corresponding application mutation.

## The complete operator sequence

### Capture and inspect the original observation

Node `Inbox.exportOperations` saves the selected native observation to `original-buyer-operations.json`. A durable capture-attempt record is retained before the exporter starts. If the file already exists after a lost result, the continuation inspects those exact bytes. If an attempted publication is unresolved and the original file is absent, the continuation stops for that original publication to be resolved; it does not make a new timestamped capture under the same attempt.

Python `Inbox.inspect_operations` and the maintained queue CLI inspect those same saved bytes. Their source digest and row decisions must agree. These are read and export operations over the retained result. The controller does not invoke purchase, upstream provider, buyer recovery or finalization actions.

### Receive the complete original case

The original SF47 CLI imports the complete case ZIP using one retained request ID. The controller saves the full case baseline and original history before its first buyer receiving action.

In the Operations browser, the operator source is matched to its existing purchase and buyer deployment. The receiving action retains the exact handoff source and selected association. Desktop and mobile views expose the same saved result, source findings and accountability fields.

### Preserve new observations and historical replay

The continuation exercises three observations from the same original Inbox:

- **A** is the first complete verified source.
- **B** uses an explicit zero-byte verification allowance. Its `OVER_LIMIT` finding reports that bounded observation's verification limit; it does not establish that the original saved result disappeared.
- **C** verifies the same original result again with the normal capture settings.

After receiving B, the browser re-receives historical A through its existing source/job/purchase association. That action must leave the latest purchase unchanged. It must not reuse B's observation time while overwriting B with A's old output status. C then records the current complete verification.

The selected purchase also retains its independently recorded `orderStatus`. The Inbox handoff does not observe the merchant order lifecycle, so a new Inbox observation cannot replace a recorded order state with `NOT_APPLICABLE`. All unselected original records and original source history remain intact.

### Review the retained application cohort

With `cohortReceiving:true`, the same browser opens **Cohort acceptance** in the imported original case. The native tranche-2 seed supplies the retained proposal and source inventory. The operator reviews a seven-calendar-day window ending at the actual observation cutoff, the original buyer/merchant deployment selections, and the existing purchase evidence. Coverage remains **PARTIAL**. Unknown award acceptance, independent customers, facilitator identities, useful-operation scope and completed funded work stay unentered.

The exact Routescan association uses its retained transfer and complete output proof. All eight original purchases and deployments remain present. The resulting review must report that the proposed cohort target is unmet and that an independent-customer completion is unestablished. **Freeze reviewed cohort** retains the complete original inputs, measurement, source history and request in the existing case journal.

The browser downloads that frozen cohort ZIP. **Tranche completion** displays the same selected review and its unmet findings, while its original payment-based clock remains unestablished. The continuation does not prepare or submit a completion form from this unpaid baseline. Desktop and mobile captures show the same saved cohort.

### Continue through the original agent service

Before the agent phase, the controller saves browser storage, leaves the active page and drains its CLI server. The original helper then opens the maintained grant provider on that same receiving workspace. The typed client borrows the identical service instance.

The phase reads the original handoff A through the configured host input, compares typed and MCP previews, receives complete byte and row pages, and submits the selected original purchase/deployment with one retained request. Because A is already associated, the receiving result must report `unchanged: true`. The typed client repeats the exact request to recover its original receipt.

When the cohort phase is selected, the original MCP and typed client also seed and preview its exact inputs, then replay the browser's same frozen request. They recover the first native receipt and exact review without another business mutation. Their complete cohort downloads must match the browser's saved ZIP. The full original observation rows remain available through native array paging.

The helper verifies that the complete case and history remain unchanged, receives the exact source bytes, complete purchase rows and full case ZIP, closes the service, reopens it, and reads the same retained snapshot. It returns only after its owned services are closed. The browser then reopens the same case and checks that its version agrees.

This helper is part of the one continuation. Running it separately against another case, replaying another purchase, or registering another worker would not complete this sequence.

### Export and reopen the complete result

After both interfaces finish, the browser downloads `Native_Buyer_Operations_Complete_Workspace.zip`. With its workspace service closed, the CLI verifies the original cohort seed, preview and deterministic ZIP against the saved browser result. The original CLI imports the complete case archive with a separate retained import request. The browser reopens its original buyer source and checks its exact digest, purchase and deployment identities, unselected records and original history prefix. The same frozen cohort review and measurement digest must survive the import; the new receiving case identity is the native importer's own identity.

The final protected-file check compares the original Inbox, response files and input ZIP to their pre-run identities. The controller closes its browser and original server before it marks the result's service closure.

## Resume and receiving artifacts

Keep the whole private continuation directory after any failure. It holds the configuration hash, original case baseline, browser requests, captures, source handoffs A/B/C, agent input and request, and completed command results. A lost response is recovered from the same saved request and workspace. Do not delete the directory, regenerate the request ID, recapture an existing saved handoff, or replace the original input bytes.

The joined agent phase retains `agent-receiving/phase-input.json`, `original-receiving-request.json` and `NATIVE_BUYER_AGENT_RESULT.json`. Reinvoking the exact complete phase revalidates its retained artifacts. An interrupted phase reuses the original request before proceeding. The controller checks that the managed service has closed before restarting the browser server.

A completed delivery includes:

| Artifact | Purpose |
| --- | --- |
| `result.json` | Actual joined result, case IDs/version, source SHA, preservation results and service closure. |
| `Native_Buyer_Operations_Complete_Workspace.zip` | Complete original SF47 export after SDK, browser and agent receiving. |
| `agent-receiving/NATIVE_BUYER_AGENT_RESULT.json` | Actual 58-tool phase receipt, original request, page counts and artifact identities. |
| `reopened-original-case.json` | Full readback from the imported final archive. |
| Cohort result and artifact entries in `continuation.json` | Exact frozen request/review, browser/client/MCP/CLI ZIP agreement, Completion findings and restored-case measurement. |
| `captures/` | Desktop/mobile operator views from that same receiving data. |
| `continuation.json` and request files | Same-operation continuation and recovery state. |

The result separates local MCP activity from upstream commercial actions: `upstreamProviderCalls`, `purchaseCalls`, `buyerRecoveryCalls` and `finalizationCalls` concern the latter. The agent result records its local provider and typed-client journey. Neither a source publication nor a local receiving result implies an additional payment, an independent merchant installation, a grant award, or client acceptance.
