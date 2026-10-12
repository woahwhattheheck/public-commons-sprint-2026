# Buyer receiving for agents

This client operates the existing Buyer runbook application. It shares the browser's Local buyer setup, received SDKs and handoffs, saved acquisition drafts, native buyer attempts, accounting, customer files and recovery records. Each call selects a configured original workspace alias. The application remains responsible for its merchant transport, operator keys, browser review, native ledger and completed purchase.

## Start with the running original application

Use the Buyer application in Applications, or start the original workspace with browser approval:

~~~sh
forge buyer-runbook workspace --state /private/customer/workspace --port 0 --approval-mode browser
~~~

Retain its complete compact JSON startup line in an owner-private file. The agent connects through that exact original launch record and checks the selected source, native directory, instance, PID and actual /api/launch listener before and after every HTTP action. On an Applications restart, update this one launch file atomically with the new announcement for the same reviewed selection. The client reopens the new instance without moving the customer workspace or creating another acquisition.

The selected source digest must remain the reviewed digest. When deliberately upgrading the application, review the new source/selection and update the connection configuration. A current request or file export retains the source selection under which it was accepted.

Create a separate private directory for agent receiving, outside the native workspace. Keep these directories and the connection/input files owner-private. One configuration can contain 1–32 host aliases:

~~~json
{
  "schema": "stellar-forge.buyer-runbook.agent-connections.v1",
  "workspaces": {
    "customer": {
      "label": "Original customer receiving",
      "directory": "/private/customer/workspace",
      "launchFile": "/private/customer/current-launch.json",
      "expectedSelectionSha256": "<original announcement selectionSha256>",
      "storageDirectory": "/private/customer/agent-receiving",
      "files": {
        "setup": {
          "path": "/private/customer/operator-settings.json",
          "kind": "settings",
          "sha256": "<complete original settings file SHA256>"
        },
        "sdk_manifest": {
          "path": "/private/customer/sdk/client-export.json",
          "kind": "sdk-manifest",
          "sha256": "<complete original client-export.json SHA256>"
        },
        "customer_handoff": {
          "path": "/private/customer/merchant.handoff.json",
          "kind": "paid-handoff",
          "sha256": "<complete original handoff SHA256>"
        }
      },
      "operators": {
        "original": "/private/customer/original-operator"
      }
    }
  }
}
~~~

Add a sdk-file handle for each of the five remaining files listed in the original client-export.json. The client receives complete declared files from these aliases; input paths and file digests come from the host configuration. Other supported kinds are request-handoff, ticket and backup-profile. Settings contain the native operator's environment variable selectors and original configuration fields. Secret values stay in the original host environment.

Default receiving capacity is 256 MiB per file, 1 GiB per complete export and 128 exports. The host may explicitly select maximumFileBytes up to 8 GiB, maximumExportBytes up to 32 GiB and maximumExports up to 10,000. Each export supports 1–64 original files and the common 65,000-byte completion manifest. Original HTTP upload limits also apply.

## Typed client and CLI

~~~js
import {BuyerRunbookAgent} from './buyer-runbook/agent-client.mjs';

const buyer = await BuyerRunbookAgent.fromFile('/private/customer/agent-connections.json');
try {
  const state = await buyer.call('status', {workspace: 'customer'});
  const drafts = await buyer.call('list', {
    workspace: 'customer', collection: 'drafts', offset: 0, limit: 50
  });
  console.log(state.native, drafts.native);
} finally {
  await buyer.close();
}
~~~

agent-client.d.mts declares every action's complete arguments, the native run/approval and retained-file replies, configuration and downloader. The CLI consumes the same contract:

~~~sh
node buyer-runbook/agent-cli.mjs tools
node buyer-runbook/agent-cli.mjs --config /private/customer/agent-connections.json workspaces
node buyer-runbook/agent-cli.mjs --config /private/customer/agent-connections.json call status --input /private/customer/status.json
~~~

A request may also arrive as complete UTF-8 JSON on standard input with --input -. Output is JSON. The tools command lists the exact schema and native operation descriptions. Native errors retain their code, requestId and outcomeUnknown state.

## One customer workflow

| Stage | Original agent action | Native identity to retain |
| --- | --- | --- |
| Connection | open, status | Original launch selection and instance |
| Local buyer setup | operator, operator_review, operator_save | State digest, settings-file digest and reviewed proof |
| Merchant SDK | receive_client, client_file, client | Client ID, original manifest and five exact payload digests |
| Customer request | client_request, receive_request | Original operation ID, intent ID and received request ID |
| Request preparation | review_request, prepare_request | Actual accepted option, budget and saved review SHA256 |
| Paid file preparation | receive_paid_file, review_paid_file, prepare_paid_file | Original merchant order, exact handoff, native review and operator |
| Acquisition | save_draft, draft, initialize | Draft ID, native revision, complete manifest and reviewed digest |
| Native purchase | execute, run, approval | Same run, operation, intent and active execution |
| Receiving | resource_preview, retrieve_file, capture | Original result and complete customer bytes |
| Accounting | bind_accounting, finalize | Same native operator and original recorded attempt |
| Recovery | operation, resume, reconcile, recover, unlock | Original agent request and native attempt owner |
| Complete backup | backup_review, backup_start, backup_cancel | Original recovery profile, review and native recovery record |
| Delivery | manifest, file, file_release, download | Complete export manifest, file SHA256 and resumed byte offset |

Every mutating action requires requestId, a caller-retained UUIDv4. It is separate from the merchant operationId, native intentId, draft ID and execution ID. Generate it once for the intended save/start/prepare and retain the exact request with it.

Local buyer setup starts by reading operator. Review the selected settings file with its exact expectedSettingsSha256 and the returned expectedStateSha256. Save using that same request and the returned expectedReviewSha256. A saved setup revision may be selected through sourceRevision. The original setup engine controls validation, availability and revision replay.

Receive client-export.json, then all five manifest-named files. The original SDK receiver verifies every declared file. client_request delegates the original compose operation with its path/query/body/form selections and optional host-declared ticket. The complete native request remains an unpaid request until its existing acquisition is explicitly started.

For a request handoff, choose the actual acceptIndex and totalAtomic/dailyAtomic. For a paid file, repeat its actual expectedRevision, declared claimEnv, saved customer filename and budgets. prepare_request and prepare_paid_file resume the native retained preparation on a repeated reviewed input, preserving the generated keys and operator directory.

save_draft carries the complete native stellar-forge.buyer-runbook.v1 manifest. Configuration paths resolve only to the selected original configurations directory. initialize repeats the exact saved revision and review digest. execute selects the resulting original run ID and optional operation only. A newly allocated agent request does not replace the runbook's no-replay rules.

### Live approval and cancellation

approval reads the host's current run/execution/operation/intent binding and original broker snapshot. Open the URL returned by open in the browser to review the actual live terms and record the decision in the existing panel. The host and original SF62/SF36 path still reserve and execute the selected purchase.

The agent exposes the current review and its result. It has no tool for injecting an approval decision. cancel requires the exact current run ID and executionId and uses the original native cancellation; the host retires the same pending browser review. File receiving has a separate queue so a long download does not hold the mutation queue.

## Interrupted replies and native recovery

The agent writes the exact resolved request body and its requestId before sending the native mutation. Once it has a complete response, it retains that original response. Calling the same action with the same ID and identical arguments returns the saved result.

If a response is interrupted, use operation with the same requestId. resume replays a completed saved response or repeats an original idempotent native preparation with its exact retained body. Non-idempotent acquisition starts and saves are reconciled against their current native state. The agent does not turn an uncertain start into a new purchase.

reconcile performs only original state reads. It verifies a matching draft revision, review revision, active execution, native attempt, cancellation or recovery result. Its result is explicitly NATIVE_POSTIMAGE: the current retained product state satisfies the selected action. It does not reconstruct a missing HTTP response or attribute another operator's identical state change to this request. A newly created draft may require the exact saved native ID from the draft inventory.

recover invokes the original runbook result recovery. unlock carries the exact retained ownerPid and delegates the original liveness guard. A native run whose attempt is retained continues through its existing recovery and accounting rather than receiving a new intent.

The agent store retains uncertain requests even when the native server committed before the connection broke. The browser remains an available view of the same original state. Reopening the client uses those same request IDs and exports.

## Receive and resume complete files

capture selects original HTTP files and stores one complete immutable export. A file can be an SDK file, saved operator settings, request body or handoff, merchant paid-file handoff, saved customer resource, paid-file resource, JSON/HTML report or accounting CSV. Each selection uses native item and operation IDs. Supply expectedSha256 when a source digest is already known.

~~~json
{
  "workspace": "customer",
  "exportId": "customer-receiving",
  "files": [
    {"kind": "resource", "id": "<original run ID>", "operation": "<original operation ID>", "expectedSha256": "<saved customer SHA256>"},
    {"kind": "report", "id": "<original run ID>", "format": "json"},
    {"kind": "accounting", "id": "<original run ID>"}
  ]
}
~~~

The receiver streams complete bytes, matches Content-Length and any original SHA256, fsyncs the private file and retains its exact source/instance. A completed export keeps its original files if the browser later changes. A repeated capture with the same exportId and exact selection resumes retained files.

The original shared RetainedFileReads owns each verified descriptor. file replies carry the same manifest digest, file digest, byte offset, readId and nextOffset. Release an interrupted read explicitly with file_release, or reopen its original SHA256 and offset after expiry.

~~~sh
node buyer-runbook/agent-cli.mjs --config /private/customer/agent-connections.json download \
  --workspace customer --export customer-receiving --directory /private/customer/delivered \
  --expected-manifest <complete export manifest SHA256>
~~~

download reuses the maintained createRetainedDownload engine. It persists complete original manifests, verifies every file, retains one download checkpoint and resumes the same local directory. Repeating a finished download verifies the existing bytes and reports the original completed delivery.

For an existing MCP endpoint, downloadBuyerRunbookExport accepts url, workspace, exportId and directory plus the host's tokenEnv selector. Its connection wrapper selects the same configured workspace and passes the original retained-file replies to that common downloader.

## Backup, close and reopen

A host-declared backup-profile supplies the original recovery engine's stateRoot and selected output/bundle/passEnv. backup_review returns its exact native review. A SNAPSHOT request carries expectedReviewSha256 and quiesced:true. VERIFY selects the same retained bundle through the original verifier. The original runbook recovery CLI remains the restore entry; reopen the restored workspace through its real launch and reviewed connection selection.

Agent close stops new agent admissions, aborts/drains its own accepted HTTP requests, and closes the original retained file readers. It leaves the borrowed Buyer application with its Applications lifecycle owner. Explicit native cancel remains available before client close. A failed resource close remains reachable through a retry of close on the same agent instance.

The MCP contribution has provider-owned concurrency and shutdown so cancellation and source receiving use these original per-workspace owners. New application processes are created and stopped by the original Applications workflow.


## Register the maintained MCP provider

The existing buyer-runbook distribution contribution declares merchantProviders['buyer-runbook-workspaces'] and preserves its Applications provider. The descriptor imports metadata only; the original runtime/configuration reader/setup load when selected.

Use the installed provider setup entry:

~~~sh
starforge merchant-providers init buyer-runbook-workspaces --options /private/customer/merchant-setup.json
~~~

~~~json
{
  "directory": "/private/customer/merchant-agent",
  "connection": "/private/customer/agent-connections.json",
  "name": "Buyer receiving"
}
~~~

This creates or reopens the original merchant release store and merchant-mcp.json. The merchant host field is buyerRunbookWorkspaceConnection; the normalized runtime family is buyerRunbookWorkspaces. Start that retained configuration through the existing merchant MCP serve command and its original bearer-token environment selector.

The original package exports ./buyer/agent, ./buyer/agent/setup and ./buyer/agent/provider. The distribution command is buyer-agent. The maintained provider registry supplies tool discovery, configuration validation, request limits, instructions, original runtime ownership and close retry.

## Receive this component on the original Buyer operation

agent-receiving.mjs is the agent continuation of D7CA-SCF-BUYER-RECEIVING-APPLICATION-20261012. It calls the existing receiveBuyerManagedApplication driver with a trusted source callback. The callback routes that driver's actual Local buyer setup, six SDK inputs, merchant handoff, draft, initialization, original purchase and result reads through the real MerchantOperator and authenticated MCP listener. The driver retains its existing original browser decision, SF88 child, signature/ledger checks and two Applications Start/Stop passes.

~~~sh
node buyer-runbook/agent-receiving.mjs /private/original-buyer-receiving.json
~~~

The input is the same selected native runtime, original SDK/handoff/customer carrier and receiving directory used by receive_buyer_managed_application.mjs. Select a current installed edition containing the Buyer agent and maintained provider migration before the original operation starts. Its exact native sourceCommit and manifest stay in that original config and journal.

The receiving callback keeps request IDs in agent/agent-reception.json and invokes the original agent's durable request journal. It captures ten complete SDK/handoff/customer/report/accounting files, downloads them through the real MCP retained-file protocol, replays the saved setup response, closes the merchant owner, and reopens on the original second application instance. The same manifest and download checkpoint must survive that reopening; the original purchase/result digest remains unchanged.

The primary native journal remains buyer-managed-reception.json. Agent receiving is recorded under agent/ and complete delivery under agent/complete-delivery. Repeating a completed receiving invocation reads the original retained completion and verifies its complete delivered files.
