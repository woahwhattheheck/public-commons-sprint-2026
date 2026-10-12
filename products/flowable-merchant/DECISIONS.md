# Native decision operations

The Decisions workspace deploys original DMN resources to Flowable, evaluates
their native definitions and retains the complete operating history. It uses
the same saved reviews, original request recovery, typed client, installed CLI,
merchant MCP connection and customer receiving as process operations.

## Connect the original decision service

Save the actual DMN REST service as its own named engine connection. A standalone
Flowable REST application exposes the process and decision APIs at separate
base URLs. For the supplied original Flowable 8 host, the two declarations are:

~~~json
{
  "schema": "stellar-forge.flowable-product-connections.v1",
  "connections": [
    {
      "id": "process-development",
      "label": "Development processes",
      "baseUrl": "http://127.0.0.1:8080/flowable-rest/service",
      "usernameEnv": "FLOWABLE_USERNAME",
      "passwordEnv": "FLOWABLE_PASSWORD"
    },
    {
      "id": "decision-development",
      "label": "Development decisions",
      "baseUrl": "http://127.0.0.1:8080/flowable-rest/dmn-api",
      "usernameEnv": "FLOWABLE_USERNAME",
      "passwordEnv": "FLOWABLE_PASSWORD"
    }
  ]
}
~~~

Use the actual host, port and endpoint of the selected engine. The connection
keeps environment-variable names; the host supplies their values. The operator
uses the base URL exactly as saved.

On **Engine connections**, save the DMN declaration. Select that engine in the
workspace toolbar, open **Decisions** and choose **Refresh decisions**. Capture
retains complete native deployment, definition and historic execution pages,
the deployed DMN resources and the execution audit data. The page names and
native IDs remain tied to that saved capture revision.

The engine remains live while those collections are read. A capture preserves
the observations and their complete original response bytes across pages.
A subsequent refresh creates another saved portfolio.

## Release a DMN resource

Choose one complete original DMN file. The native deployment accepts
`.dmn`, `.dmn.xml`, `.dmn11` and `.dmn11.xml` resource suffixes.
The original filename supplies the deployment name. Select a tenant only when
the native deployment belongs to that tenant.

In the browser, fill **Prepare decision release**, select the resource and
prepare it. Read the original XML, request body, selected connection and native
preimage in the saved review. **Deploy decisions** dispatches those original
bytes and retains the native deployment response and resulting definitions.

The equivalent SDK selection is:

~~~js
const selection = {
  action: 'deploy',
  resource: {
    filename: 'customer-qualification.dmn.xml',
    contentType: 'application/xml',
    contentBase64: originalDmnBytes.toString('base64')
  }
};

const prepared = await client.prepareDecisionRelease({
  requestId: savedPrepareRequestId,
  connectionId: savedDmnConnectionRecordId,
  label: 'Customer qualification release',
  selection
});

const review = await client.readReview({
  kind: 'decisionRelease',
  id: prepared.id,
  revision: prepared.revision
});

const released = await client.dispatchDecisionRelease({
  requestId: savedDispatchRequestId,
  id: prepared.id,
  expectedRevision: prepared.revision,
  planSha256: prepared.value.planSha256
});
~~~

Retain each request UUID with its unchanged input. `connectionId` is the
workspace's saved connection record ID. The connection alias and Flowable's
native definition/deployment IDs are separate identifiers.

Deploying an updated definition with the same native decision key creates a
new native version. Open its captured definition to inspect the actual
version, deployment, resource and exact source bytes.

## Evaluate the native rules

Select **Source and evaluate**, then **Prepare evaluation for this key** to seed
the native key, tenant and parent deployment from the saved capture. The parent
deployment comes from the matching original deployment record. Add the original typed input variables. The evaluation
body accepts the native fields `decisionKey`, `tenantId`,
`parentDeploymentId`, `inputVariables` and `disableHistory`.

Preserve this body as text. For example:

~~~json
{
  "decisionKey": "customer_qualification",
  "inputVariables": [
    {"name": "country", "type": "string", "value": "US"},
    {"name": "existingCustomer", "type": "boolean", "value": true},
    {"name": "amount", "type": "bigDecimal", "value": "12500.25"},
    {"name": "sourceSequence", "type": "bigInteger", "value": "9223372036854775806"}
  ],
  "disableHistory": false
}
~~~

Use the actual native key and variable names from your deployed resource.
The native `bigDecimal` and `bigInteger` types accept quoted decimal values,
which preserve their intended value without a JavaScript number conversion.
Keep the original JSON text and the original native reply when exact numeric
representation matters.

Select the evaluation mode that matches the native operation:

| Mode | Native operation |
| --- | --- |
| `auto` | `/dmn-rule/execute` |
| `decision` | `/dmn-rule/execute-decision` |
| `decisionService` | `/dmn-rule/execute-decision-service` |

The **single-result** option selects that operation's native
`/single-result` endpoint. Use it when the selected rules are expected to
produce the native single result. Flowable performs the rule evaluation and
enforces its result semantics.

The SDK uses the same original body:

~~~js
const prepared = await client.prepareDecisionEvaluation({
  requestId: savedPrepareRequestId,
  connectionId: savedDmnConnectionRecordId,
  label: 'Customer qualification',
  selection: {
    action: 'evaluate',
    mode: 'decision',
    singleResult: false,
    bodyText: originalNativeJsonText
  }
});

const review = await client.readReview({
  kind: 'decisionEvaluation',
  id: prepared.id,
  revision: prepared.revision
});

const evaluated = await client.dispatchDecisionEvaluation({
  requestId: savedDispatchRequestId,
  id: prepared.id,
  expectedRevision: prepared.revision,
  planSha256: prepared.value.planSha256
});
~~~

The native REST operation resolves a decision key and its scope. Its request
does not provide a direct definition ID or version selector. Preparation
captures the current selected definition and original resource; dispatch
checks that selection again before evaluation. When a deployment changes
the reviewed definition, prepare a new review of the current native source.

## Read results and execution history

A successful evaluation's original HTTP 201 response contains the native
typed `resultVariables` and its native URL. The full response is retained in
the operation review and available through its original source reference.
Normal evaluation and native single-result evaluation preserve their
different result shapes.

The evaluation response does not return an execution audit ID. Historic
execution records are captured separately with their actual native ID,
definition/deployment identity, version and timestamps. Open **Native
execution history → Execution and audit** to read the selected execution's full native
audit resource. Where the engine exposes no direct correlation, a matching
history record remains an observed candidate; the exact evaluation response
continues to identify the actual returned result.

Programmatic reads use:

~~~js
const portfolio = await client.captureDecisionPortfolio({
  requestId: savedCaptureRequestId,
  connectionId: savedDmnConnectionRecordId,
  label: 'Current decision operations'
});

const definitions = await client.readDecisionPortfolio({
  id: portfolio.id,
  revision: portfolio.revision,
  collection: 'definitions',
  offset: 0,
  limit: 50
});

const definition = await client.readDecisionDefinition({
  portfolioId: portfolio.id,
  revision: portfolio.revision,
  definitionId: actualNativeDefinitionId
});

const execution = await client.readDecisionExecution({
  portfolioId: portfolio.id,
  revision: portfolio.revision,
  executionId: actualNativeExecutionId
});
~~~

Read all returned `nextOffset` pages when consuming a collection.
`readDecisionDefinition` returns the definition, its matching captured deployment
and complete retained source resources. `readDecisionExecution` returns the
selected native execution and its complete retained audit resources. Source references are
also available to the existing full-file download methods.

## Installed CLI and agent operations

The installed command operates the same workspace opened by Applications:

~~~sh
starforge flowable-product capture-decisions \
  --dir /srv/private/process-operations \
  --request SAVED_REQUEST_UUID --connection SAVED_CONNECTION_RECORD_ID

starforge flowable-product decision-portfolio \
  --dir /srv/private/process-operations \
  --id SAVED_PORTFOLIO_ID --collection definitions --offset 0 --limit 50

starforge flowable-product decision-definition \
  --dir /srv/private/process-operations \
  --portfolio SAVED_PORTFOLIO_ID --definition NATIVE_DEFINITION_ID

starforge flowable-product decision-execution \
  --dir /srv/private/process-operations \
  --portfolio SAVED_PORTFOLIO_ID --execution NATIVE_EXECUTION_ID
~~~

Replace the uppercase placeholders with the saved or native identifiers.
The original `prepare`, `dispatch`, `review-operation` and `reconcile`
commands accept `decisionRelease` and `decisionEvaluation`. The generic
`call --method ... --input ... --out ...` command retains complete request
and response files for every declared action.

The merchant exposes these eight decision methods beside its process and
complete file operations:

| MCP tool | Shared workspace action |
| --- | --- |
| `merchant_flowable_capture_decisions` | `captureDecisionPortfolio` |
| `merchant_flowable_decision_portfolio` | `readDecisionPortfolio` |
| `merchant_flowable_decision_definition` | `readDecisionDefinition` |
| `merchant_flowable_decision_execution` | `readDecisionExecution` |
| `merchant_flowable_prepare_decision_release` | `prepareDecisionRelease` |
| `merchant_flowable_dispatch_decision_release` | `dispatchDecisionRelease` |
| `merchant_flowable_prepare_decision_evaluation` | `prepareDecisionEvaluation` |
| `merchant_flowable_dispatch_decision_evaluation` | `dispatchDecisionEvaluation` |

The product declares 29 shared actions and 35 merchant tools in total. All
surfaces use the same current connection, immutable saved review, original
dispatch request and retained response.

## Recover and hand over the complete workspace

After an interrupted evaluation, reopen its saved operation and reconcile
the original native response and history. A saved dispatch already identifies
a native mutation; continue that operation using its original UUID and input.
When another evaluation is intended, create a new request deliberately.

Customer export includes every decision portfolio, release and evaluation
revision, deployed XML, original request and response body, execution audit
resource and native journal alongside the process history. Use the existing
complete NDJSON export, file receiving and adoption workflow.

A receiving operator can reopen the complete source and audit history, then
continue with that workspace's saved connections and new native operations.
The original handover file, revisions and source hashes stay available after
cold reopen. See [Receiving](RECEIVING.md) for the complete transfer and
adoption commands, and the [native DMN contract](../../stellar/scf-starforge-20261009/sf30-seller-sdk/flowable/DMN_NATIVE_CONTRACT.md)
for the source-pinned engine routes and response semantics.
