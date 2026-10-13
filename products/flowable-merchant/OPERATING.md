# Operate a Flowable process workspace

The browser, installed CLI, typed client and configured merchant agent share
one saved workspace. A review freezes the selected engine configuration,
original native request and relevant current state. Dispatch uses that saved
request; recovery reads its original response and native state.

## Configure the engine

Use Node 24, Linux flock and a private product directory. The engine requires
its original REST service and a user authorized for the selected native
operations. Store the username and password in the host environment. The
connection records their environment-variable names.

A private initial connection file has this shape:

~~~json
{
  "schema": "stellar-forge.flowable-product-connections.v1",
  "connections": [
    {
      "id": "process-development",
      "label": "Development process engine",
      "baseUrl": "http://127.0.0.1:8080/flowable-rest/service",
      "usernameEnv": "FLOWABLE_USERNAME",
      "passwordEnv": "FLOWABLE_PASSWORD"
    }
  ]
}
~~~

Replace the endpoint and variable names with the selected engine's actual
configuration. Keep the file and its parent private.

~~~sh
starforge flowable-product init --dir /srv/private/process-operations \
  --connections /srv/private/flowable-connections.json \
  --name "Process operations"
starforge flowable-product open --dir /srv/private/process-operations --port 0
~~~

Initial declarations seed only missing aliases. Edit an existing connection
through its saved record and observed revision. A later Open keeps the
customer's saved target configuration.

There are two identifiers: the human alias inside a connection and its saved
24-character hexadecimal record ID. Capture and prepare operations use the
saved record ID. Native Flowable definition, process and task IDs are separate
strings and retain their original values.

## Capture the portfolio and original source

Choose a saved engine and refresh its portfolio. The capture retains complete
native pages for deployments, definitions, active processes and tasks, historic
processes, historic tasks, historic activities and historic variables.
Collections remain the original engine observations across those pages;
capturing them does not lock the engine into one atomic snapshot.

Read a selected definition's original BPMN or deployment resource and its
source hash. Portfolio pages include their captured record revision so a
later refresh does not silently replace the definition being reviewed.

For scripted operation, save a request file before invoking it:

~~~json
{
  "requestId": "REPLACE_WITH_SAVED_UUID",
  "connectionId": "REPLACE_WITH_SAVED_CONNECTION_RECORD_ID",
  "label": "Development process portfolio"
}
~~~

~~~sh
starforge flowable-product call --dir /srv/private/process-operations \
  --method capturePortfolio --input /srv/private/capture-request.json \
  --out /srv/private/capture-result.json
~~~

Use an actual UUID and returned connection record ID in the private input.
Keep that exact file to reopen the same request after a lost reply.

## Review and deploy a release

Select the complete original BPMN XML or native deployment archive. The
operator retains its filename, content type and exact bytes. Deployment is
Flowable's original multipart request. It does not rewrite the process graph.

A typed release selection uses:

~~~js
const selection = {
  action: 'deploy',
  deploymentName: 'Customer review v2',
  deploymentKey: 'customer-review-v2',
  resource: {
    filename: 'customer-review.bpmn20.xml',
    contentType: 'application/xml',
    contentBase64: originalBpmnBytes.toString('base64')
  }
};
~~~

Call `prepareRelease` with the saved request UUID, connection record ID and
selection. Inspect `readReview({kind:'release',id,revision})`. It contains the
frozen request, native preimage, original source resource and full response
references. Large original bodies remain available as complete downloads.

Dispatch uses another saved UUID and the returned operation's exact
`id`, `revision` and `value.planSha256`:

~~~js
const deployed = await client.dispatchRelease({
  requestId: savedDispatchId,
  id: prepared.id,
  expectedRevision: prepared.revision,
  planSha256: prepared.value.planSha256
});
~~~

Read the native deployment receipt, resulting definitions and retained
resources. A changed engine configuration or preimage requires a new review
before another dispatch.

## Start processes and operate human tasks

Prepare a process with its original native JSON text:

~~~js
const prepared = await client.prepareProcess({
  requestId: savedPrepareId,
  connectionId: savedEngineRecordId,
  label: 'Customer review',
  selection: {
    action: 'start',
    bodyText: JSON.stringify({
      processDefinitionId: actualDefinitionId,
      businessKey: originalBusinessKey,
      variables: originalNativeVariables
    })
  }
});
~~~

Review the selected definition, exact variable payload and current engine
state, then use `dispatchProcess` with the original review revision and plan
hash. Preserve native business identity deliberately across workflow systems.

Task selections contain the actual `taskId`, one of
`claim`, `complete`, `delegate` or `resolve`, and the original JSON
`bodyText`. Its native `action` must match the selected action.
The selected user must already exist and be authorized in the original
engine. Review assignment, variables and task state before
`dispatchTask`. Read the actual active and historic task result afterward.

JSON is retained as supplied. If the original source requires an exact
decimal or integer representation, preserve that original text instead of
converting it through an inexact JavaScript number.

## Validate and dispatch migration

Select the original process instance ID and the complete Flowable migration
document. Its target definition and activity mappings are native Flowable
fields. Use the engine's actual definition/activity IDs from the captured
source and current process.

`prepareMigration` calls the original native validation endpoint and saves
its full response. An invalid migration remains a readable saved review.
Dispatch requires a PREPARED operation and repeats the original native
validation against its current preimage before the mutation.

After `dispatchMigration`, read the saved operation, current definition,
active tasks and original history. The operator preserves the full native
migration document and both before/after source references.

## Understand state and recover the original request

| Saved state | Operator action |
| --- | --- |
| PREPARED | Review the original input and current native preimage before dispatch |
| INVALID | Read the original migration validation and correct the selected native document |
| DISPATCHED / READBACK | Continue the retained operation; the original request identity is already saved |
| CONFIRMED / ACCEPTED / OBSERVED | Inspect the native reconciliation evidence and actual affected records |
| REJECTED | Read the original native response before preparing another request |
| UNKNOWN / INTERRUPTED | Reopen the saved request, response and journal, then refresh its original native readback |
| STALE | Prepare a new review for the current target configuration and native state |

Keep each request UUID with its unchanged input. Reusing it reopens the
original saved operation. A different payload under that UUID conflicts
instead of creating a replacement request.

A lost HTTP response may leave a native operation already dispatched.
Reopen the same operation, inspect its retained phase, then call
`reconcileOperation` with the saved operation kind and ID and a saved
readback request UUID. It reads the original native outcome and current or
historic engine state. The dispatch identity remains the same.

~~~json
{
  "requestId": "REPLACE_WITH_SAVED_READBACK_UUID",
  "kind": "process",
  "id": "REPLACE_WITH_ORIGINAL_PROCESS_OPERATION_ID",
  "expectedRevision": 4
}
~~~

Use the actual current revision. A later deliberate refresh uses a new
readback request UUID; a retry of an interrupted reply retains its original
UUID and arguments.

## Read complete original files

Use `download-source --reference PRIVATE_REFERENCE_JSON --out PRIVATE_FILE`
for a native BPMN resource, request, exchange or journal. The reference binds
the full SHA-256 and byte count. `call --method METHOD --input PRIVATE_ARGS_JSON --out PRIVATE_JSON`
retains the complete original action reply without shortening the result.

The typed client exposes the same actions and file transfers:

~~~js
import { FlowableProductClient } from './products/flowable-merchant/client.mjs';

const client = new FlowableProductClient({
  directory: '/srv/private/process-operations',
  expectedWorkspaceId: originalWorkspaceUuid
});
try {
  const record = await client.getRecord({ kind: 'process', id: originalOperationId });
  const review = await client.readReview({ kind: 'process', id: record.id, revision: record.revision });
  await client.downloadSource({
    reference: review.originals[0].reference,
    path: '/srv/private/original-native-request.json'
  });
} finally {
  await client.close();
}
~~~

Closing the client drains its own HTTP work. The foreground product or
Applications owner still controls the workspace listener and writer.

## Connect the merchant agent

Save the actual workspace UUID and existing product URL file in a private
connection document:

~~~json
{
  "schema": "stellar-forge.flowable-workspace-connection.v1",
  "workspaces": {
    "process-operations": {
      "label": "Customer process operations",
      "workspaceId": "REPLACE_WITH_ACTUAL_WORKSPACE_UUID",
      "consoleUrlFile": "/srv/private/process-operations/browser-url.txt"
    }
  }
}
~~~

`consoleUrlEnv` is the supported alternative when the existing host
supplies the private URL through an environment variable. The declared
workspace UUID remains required.

~~~sh
starforge flowable-agent-init --dir /srv/private/flowable-agent \
  --connection /srv/private/flowable-agent-connection.json \
  --name "Customer process operations"

starforge merchant-mcp serve \
  --config /srv/private/flowable-agent/merchant-mcp.json \
  --port 0 --token-env MCP_ACCESS_TOKEN
~~~

Supply the access token through the original host environment. The
source-owned provider uses the same browser workspace and its saved request
history. The [merchant configuration guide](../../stellar-forge/mcp-merchant-operator/FLOWABLE_WORKSPACES.md)
lists exact tools and retained-file contracts.

## Stop, upgrade and reopen

Stop through the original Applications owner or signal the foreground
command. The product closes native calls and the original workspace before
releasing its product lease. Reopen the same directory to retain its UUID,
source history, reviewed operations and completed handovers.

Receive a new installed runtime into a new directory and review its complete
source through Applications while keeping the customer's original product
and native workspace. Complete the [customer receiving procedure](RECEIVING.md)
when moving history to another host.

## Case operations in the same workspace

Use the [case operating guide](CASES.md) for complete CMMN releases, case lifecycle, plan items, human work, variables and milestones. All four case operation kinds use the existing saved preparation, reviewed dispatch and original-request reconciliation. The explicit CMMN service connection and its current native case/source state remain part of each operation.
