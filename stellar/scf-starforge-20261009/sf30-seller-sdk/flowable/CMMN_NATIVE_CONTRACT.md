# Flowable 8 CMMN native contract

This module connects the existing Flowable workspace to the original Flowable 8 adaptive-case REST engine. The engine owns CMMN deployment, case criteria, plan-item transitions, human tasks and history. The workspace owns saved selections, preimages, dispatch journals, immutable source/exchange files and portable receiving.

The source authority is Flowable Open Source 8.0.0, commit 0779d68e5a3385b74d8acb8bc37901ff54513249. CMMN_SOURCE_MAP.json records the exact controller, request, response, service, state and packaging source identities. This contract describes cmmn-native.mjs; the original shared native.mjs remains the transport and credential owner.

## Connection and ownership

Save the original CMMN REST base explicitly as a separate named connection. For the maintained combined REST deployment, a typical configured base is http://127.0.0.1:8080/flowable-rest/cmmn-api. The adapter does not derive this URL from a BPMN or DMN connection.

~~~json
{
  "id": "case-engine",
  "label": "Original CMMN engine",
  "baseUrl": "http://127.0.0.1:8080/flowable-rest/cmmn-api",
  "usernameEnv": "FLOWABLE_NATIVE_USERNAME",
  "passwordEnv": "FLOWABLE_NATIVE_PASSWORD"
}
~~~

normalizeFlowableConnection uses the existing connection schema and normalizes a trailing slash. A connection ID is 1–128 characters matching an initial alphanumeric character followed by alphanumerics, dot, underscore or hyphen. Credential fields name environment variables; they contain no credential values. A base URL must be HTTP(S), with no embedded credentials, query or fragment. The normalized connection SHA binds each plan and original response.

createFlowableCmmnTransport(connection, options) reuses createFlowableTransport. Options include environment, fetch, signal, timeoutMs and maxResponseBytes. The original defaults are a 120-second request timeout and a 64 MiB response bound; configured limits cannot exceed one hour and 1 GiB. Rejected, interrupted and oversized responses retain the original available exchange evidence. Native URLs supplied by resource responses must remain within the declared REST origin and base.

The native helpers do not start another engine, maintain a second credential store or own a workspace writer. The caller retains the existing operation and closes its original host and workspace owners.

## Public module interface

| Export | Purpose |
| --- | --- |
| FLOWABLE_CMMN_NATIVE_SCHEMA | stellar-forge.flowable-cmmn-native-request.v1 |
| FLOWABLE_CMMN_COLLECTIONS | Frozen collection array in the exact order below |
| FLOWABLE_CMMN_ACTION_GROUPS | Frozen operation-kind to action-array mapping below |
| FLOWABLE_CMMN_SOURCE_KIND | cmmn-definition-resource |
| FLOWABLE_CMMN_VARIABLE_KIND | cmmn-variable-data |
| normalizeFlowableConnection | Original shared connection normalizer |
| planFlowableCmmnRequest(connection, selection) | Produce the complete immutable native request plan |
| createFlowableCmmnTransport(connection, options) | Original transport with complete CMMN plan validation |
| executeFlowableCmmnRequest(transport, plan, callbacks) | Dispatch this selected request once and retain the original exchange |
| captureFlowableCmmnPortfolio(transport, callbacks) | Capture all eleven collections and all advertised source/binary resources |
| readFlowableCmmnRequestState(transport, plan, callbacks) | Read the exact selected native owner, related state, source and history |
| reconcileFlowableCmmnRequest(plan, before, after, response) | Compare retained evidence without resending the request |

FLOWABLE_NATIVE_VERSION and FLOWABLE_NATIVE_COMMIT are re-exported from the original shared native module.

~~~js
FLOWABLE_CMMN_ACTION_GROUPS = {
  caseRelease: ['deploy'],
  caseInstance: ['startCase', 'updateCase', 'evaluateCaseCriteria', 'terminateCase'],
  casePlanItem: ['startPlanItem', 'triggerPlanItem', 'enablePlanItem', 'disablePlanItem'],
  caseTask: ['claim', 'unclaim', 'complete', 'delegate', 'resolve']
};
~~~

## Complete inventory

The following names and order are the integration contract. Every collection preserves the native response objects. Each collection result contains items, pages, total, complete and atomicSnapshot, plus retained exchanges. Variable collections also retain lossless variableEvidence used for numeric comparisons.

| Collection | Original relative REST path | Native sort |
| --- | --- | --- |
| deployments | /cmmn-repository/deployments | id |
| definitions | /cmmn-repository/case-definitions | id |
| cases | /cmmn-runtime/case-instances | id |
| planItems | /cmmn-runtime/plan-item-instances | createTime |
| tasks | /cmmn-runtime/tasks | id |
| variables | /cmmn-runtime/variable-instances | variableName |
| historicCases | /cmmn-history/historic-case-instances | caseInstanceId |
| historicPlanItems | /cmmn-history/historic-planitem-instances | createTime |
| historicTasks | /cmmn-history/historic-task-instances | taskInstanceId |
| historicVariables | /cmmn-history/historic-variable-instances | variableName |
| milestones | /cmmn-history/historic-milestone-instances | timestamp |

The native DataResponse is paged with start, size, sort and ascending order. pageSize defaults to 100 and accepts 1–10,000. There is no hidden portfolio-item limit. The adapter checks each start, returned size and total, reads through the reported total, and rejects duplicate or missing IDs, a changing total, an early empty page or a page extending beyond the total.

This is not a transactional engine snapshot. The portfolio explicitly returns atomicSnapshot:false. It includes startedAt and completedAt so a caller can identify the observation window. A concurrent update that does not affect pagination can still occur; selected-operation preflight and original raw response hashes remain necessary.

The portfolio schema is stellar-forge.flowable-cmmn-native-portfolio.v1. It contains connectionId, connectionSha256, collections, resources, exchanges, sourceCoverage:ALL_NATIVE_DEPLOYMENT_RESOURCES, variableCoverage:ALL_CAPTURED_NATIVE_VALUE_URLS and taskScope:ORIGINAL_SHARED_NATIVE_ENDPOINT_ROWS.

## Exact selections and request bytes

A plan records schema, engineVersion, connectionId, connectionSha256, action, mutation, method, path, query, contentType, bodyBase64, bodyBytes, bodySha256, readback and requestSha256. Deployment plans also record original source identity. The request SHA binds the connection and complete request core. Dispatch reconstructs the selected plan from its saved bytes and rejects a changed plan, body, source, multipart boundary or connection.

bodyText is the original UTF-8 JSON text. The adapter validates its native fields and preserves its bytes instead of serializing a parsed object back into JSON. This keeps original whitespace and numeric tokens, including long values above JavaScript's safe-integer range. The JSON body limit is 64 MiB; deployment source bytes are limited to 256 MiB. Binary source is supplied as canonical Base64.

### Case release

~~~js
{
  action: 'deploy',
  deploymentName: 'reviewed-case-release',
  deploymentKey: 'case-release',
  tenantId: '',
  resource: {
    filename: 'grant-due-diligence-v1.cmmn',
    contentType: 'application/xml',
    contentBase64: originalFileBase64
  }
}
~~~

The request is POST /cmmn-repository/deployments with one multipart file. deploymentName, deploymentKey and tenantId are optional native query parameters. The pinned controller reads name and key from the original request query string. An absent or empty name falls back to the original filename before its first dot. CMMN filenames end in .cmmn or .cmmn.xml with native case sensitivity; archive suffixes .bar and .zip are case-insensitive.

The full original file is retained. The deterministic multipart body contains those same bytes; the original engine owns archive extraction and CMMN parsing. A successful creation returns HTTP 201 with the native deployment ID. The adapter downloads every resource listed by that deployment and associates definitions by both the native resource URL and filename. See [DeploymentCollectionResource][deployment].

### Case start and lifecycle

| Selection action | Required selection fields | Original method and body |
| --- | --- | --- |
| startCase | bodyText | POST /cmmn-runtime/case-instances with original CaseInstanceCreateRequest |
| updateCase | caseInstanceId, bodyText | PUT /cmmn-runtime/case-instances/{id}; action absent, null or empty |
| evaluateCaseCriteria | caseInstanceId, bodyText | Same PUT with action equal to evaluateCriteria |
| terminateCase | caseInstanceId | DELETE /cmmn-runtime/case-instances/{id}, zero request-body bytes |

A start body selects exactly one caseDefinitionId or caseDefinitionKey. Native fields include name, businessKey, variables, transientVariables, startFormVariables, outcome, tenantId, overrideDefinitionTenantId and returnVariables. A nonempty tenantId accompanies a definition key, not a definition ID. The adapter preserves original variable names, types, values, scopes and value URLs.

~~~json
{"caseDefinitionKey":"grantDueDiligence","businessKey":"original-operation-grant-1","variables":[{"name":"amountAtomic","type":"long","value":9223372036854775806}],"returnVariables":true}
~~~

For updateCase, the original controller updates only nonempty name and businessKey values; empty strings do not clear them. Criteria evaluation is a separate native branch. The adapter requires bodyText equal in meaning to {"action":"evaluateCriteria"} with no name/businessKey fields, because those fields would not be applied by that branch.

terminateCase uses the original terminating DELETE and retains the engine's history. The module does not expose a fabricated completeCase action or the separate destructive native history-deletion route. See [CaseInstanceCollectionResource][case-create] and [CaseInstanceResource][case-action].

### Plan-item actions

Every selection contains planItemInstanceId and bodyText. Optional caseInstanceId is an additional exact owner constraint and is not inserted into the native request body.

| Selection action | Required native body action | Pinned engine behavior |
| --- | --- | --- |
| startPlanItem | start | startPlanItemInstance |
| triggerPlanItem | trigger | triggerPlanItemInstance |
| enablePlanItem | enable | startPlanItemInstance |
| disablePlanItem | disable | disablePlanItemInstance |

The endpoint is PUT /cmmn-runtime/plan-item-instances/{id}. The native reply can contain a current plan item or be HTTP 204 after it has ended. The pinned ENABLE branch calls startPlanItemInstance. The adapter and operator preserve that behavior and must not present ENABLE as a different engine transition. Criteria evaluation belongs to the case endpoint; it is not accepted as a plan-item action. See [PlanItemInstanceResource][plan-item].

### Human-task actions

Every task selection contains taskId and bodyText, with optional caseInstanceId as an exact owner constraint. The native endpoint is POST /cmmn-runtime/tasks/{id}; its successful action response is HTTP 200 and may have an empty body.

| Selection action | Native body example |
| --- | --- |
| claim | {"action":"claim","assignee":"reviewer"} |
| unclaim | {"action":"claim","assignee":null} |
| complete | {"action":"complete","variables":[{"name":"approved","type":"boolean","value":true}]} |
| delegate | {"action":"delegate","assignee":"reviewer"} |
| resolve | {"action":"resolve"} |

The DTO also declares formDefinitionId, outcome, variables and transientVariables. The adapter preserves submitted bytes and the original engine's action-specific handling. It does not invent an unclaim native action: unclaim is explicitly the native claim action with a null assignee. See [TaskActionRequest][task-request] and [TaskResource][task-action].

The endpoint can expose shared task rows. Capture keeps every original row, but a case-task operation must resolve an actual CMMN owner. The pinned runtime TaskResponse constructor assigns caseInstanceId and caseDefinitionId only inside ScopeTypes.CMMN.equals(task.getScopeType()). Generic scopeId, scopeDefinitionId, subScopeId and scopeType remain separately populated. Historic task responses have the same CMMN guard. A non-CMMN scope must not become a case task merely because it has a scope ID.

The adapter accepts an explicit native caseInstanceId or a cmmn scopeType with scopeId, rejects an explicit different scope type, and checks any supplied caseInstanceId against the actual task or plan item. See [TaskResponse][task-response] and [CmmnRestResponseFactory][factory].

## Original source and binary-variable resources

Repository source resources have schema stellar-forge.flowable-source-resource.v1 and kind cmmn-definition-resource. Their metadata includes deploymentId, definitionIds, optional definitionId, filename, contentType, bytes, sha256, the untouched native resource row, and exchange identity. Every advertised native deployment resource is downloaded through its original data URL. A multi-definition archive retains all members and all associated definitions.

Variable resources use the same resource schema and kind cmmn-variable-data. Metadata includes variableInstanceId, history, variableName, variableType, filename, contentType, bytes and sha256, plus original caseInstanceId, taskId and planItemInstanceId when present. Runtime and historic variables keep their native relationship fields. Their nested variable object supplies name, type, value and valueUrl.

The adapter follows every captured nonempty native valueUrl and retains the full response bytes as contentBase64. It does not deserialize Java-serialized variables. A binary file download retains its original content type and hash. Consumers can associate these files with readCaseInstance through the native caseInstanceId and with the variable through variableInstanceId. See [VariableInstanceBaseResource][variables] and [HistoricVariableInstanceBaseResource][historic-variables].

## Immutable sinks and complete exchanges

Read and dispatch helpers accept callbacks with signal, pageSize, retainBodies, onExchange and onDefinition. Each sink is asynchronous. It receives the complete original object before the adapter can replace its body with an immutable reference.

~~~js
const callbacks = {
  retainBodies: false,
  onExchange: fullExchange => store.putJSON(fullExchange),
  onDefinition: fullResource => store.putJSON(fullResource)
};
~~~

Each returned reference has sha256, bytes and mediaType and identifies the complete immutable JSON bytes written by the original store. A source object's definitionRef replaces contentBase64 only after persistence. An exchange's bodyRef identifies the full retained exchange JSON. Without both sinks, capture defaults to retaining bodies; a caller explicitly requesting stripped bodies must provide valid persistence references.

A full exchange includes original request metadata, status, ok, completion state, headers, bodyBytes, bodySha256 and original body text/Base64, with parsed JSON as a convenience. The exact bytes remain the authority. Retained requestSha256, method, path, query, body byte count and body hash let the existing journal recover a response that was persisted before a later journal write failed.

Partial transport failures preserve the original available exchange through onExchange before the error is propagated. They are not converted into successful native receipts.

## Selected-state readback

readFlowableCmmnRequestState accepts callbacks.response containing the fully hydrated original exchange. The adapter verifies its connection, request hash, method, path, query, body identity and full response bytes before using provider-returned deployment or case IDs.

The result uses schema stellar-forge.flowable-cmmn-native-state.v1. It contains the eleven collection arrays, resources, exchanges, variableEvidence, selected caseInstanceIds, action, connection identity and observedAt. Reads select exact native IDs and capture the owning case's definition, deployment, plan items, tasks, variables, history and milestones. Missing selected resources are retained as original 404 evidence. A different ID returned by an exact-ID read is rejected.

Variable evidence is parsed losslessly from the original response body. Comparisons can distinguish numeric tokens that ordinary JSON.parse would round to the same JavaScript number. Original source and exchange digests remain available to the workspace's pre-dispatch drift comparison.

## Reconciliation and uncertain writes

The caller saves a complete plan and preimage before dispatch. It must record dispatch intent once. After a lost or uncertain reply, it reads current native state and invokes reconciliation against that same saved request. The module never repeats a mutation.

Every result has schema stellar-forge.flowable-cmmn-native-reconciliation.v1, state, summary and evidence. Evidence always includes replayAllowed:false and the original request identity.

| State | Meaning |
| --- | --- |
| CONFIRMED | Retained original receipt plus corresponding native state, or the narrowly identified current-state recovery described below |
| ACCEPTED | A complete successful original response exists but corresponding final native readback is not yet established |
| REJECTED | A complete original 4xx rejection exists; its original body is retained |
| UNKNOWN | There is insufficient evidence to establish the selected request's outcome |

Current-state recovery explicitly reports nativeAcknowledged:false and requestAttribution:CURRENT_STATE_ONLY. It does not manufacture a provider response. Receipt-based attribution uses ORIGINAL_RESPONSE and preserves the original status/body identity.

The operation-specific evidence is deliberately narrow:

- Deployment with an original successful response uses its returned ID and complete source readback. A lost-response XML deployment can recover only a unique new deployment containing the exact reviewed filename, bytes and hash. A ZIP/BAR deployment without a receipt is not guessed from unrelated extracted members.
- Case start uses the returned native ID when available. Without a receipt, recovery requires one new matching case with the reviewed nonempty business key, definition selection and losslessly corresponding initial variables. Transient or form input cannot be treated as durable evidence of those original values.
- A case update compares the exact selected nonempty fields on the same case. A no-op update requires its original acknowledgement. Termination requires the prior live case to disappear from runtime and its exact historic case to show terminated state and endTime.
- Criteria evaluation is confirmed through its original acknowledgement. Generic subsequent history changes cannot identify an otherwise unknown evaluation.
- Plan-item start, ENABLE and disable use the same original case, selected plan-item state and retained transition/history evidence. An unknown generic trigger is not inferred from arbitrary downstream activity.
- Claim, unclaim, delegate and resolve use the exact selected task and its native assignment/delegation state. Lost-response completion requires the exact selected historic task and corresponding durable variable evidence.

A later observation of desired current state can be useful while still lacking request attribution. The evidence preserves that distinction for the browser, API, export and cold receiving. Application code must not turn UNKNOWN or ACCEPTED into an automatic resend.

## Packaging, history and the one native programme

The existing selected Flowable product carries this module and the source map alongside the original BPMN/DMN modules. The executable combined REST WAR belongs to the upstream flowable-app-rest packaging, which depends on the original REST starter; modules/flowable-rest has different packaging and must not be substituted merely because its directory name looks suitable. See [flowable-app-rest POM][app-rest] and [flowable-rest POM][rest].

The host explicitly configures the CMMN connection against the same original combined engine. History availability is an engine configuration property; captures retain what the engine actually returns and do not synthesize absent historic rows. The maintained native programme records its explicit history setting and verifies real historic case, plan-item, task, variable and milestone results.

The complete product journey extends the existing FLOWABLE-PROCESS-OPERATIONS-D76C-20261012 operation with the versioned case fixtures. It exercises the actual engine, operator, installed SDK/CLI/MCP, original source downloads, complete export, cold receiving and same-operation reopen. The original owner must reconcile any accepted host or running process before starting another JVM.

Source review and Node syntax validation establish interface and parse compatibility. They do not establish a successful engine journey. The retained execution report must separately identify the actual native host, source revision, original responses, resource hashes, close results and completed receiving. No successful engine run is implied by this contract.

## Pinned source references

[deployment]: https://github.com/flowable/flowable-engine/blob/0779d68e5a3385b74d8acb8bc37901ff54513249/modules/flowable-cmmn-rest/src/main/java/org/flowable/cmmn/rest/service/api/repository/DeploymentCollectionResource.java
[case-create]: https://github.com/flowable/flowable-engine/blob/0779d68e5a3385b74d8acb8bc37901ff54513249/modules/flowable-cmmn-rest/src/main/java/org/flowable/cmmn/rest/service/api/runtime/caze/CaseInstanceCollectionResource.java
[case-action]: https://github.com/flowable/flowable-engine/blob/0779d68e5a3385b74d8acb8bc37901ff54513249/modules/flowable-cmmn-rest/src/main/java/org/flowable/cmmn/rest/service/api/runtime/caze/CaseInstanceResource.java
[plan-item]: https://github.com/flowable/flowable-engine/blob/0779d68e5a3385b74d8acb8bc37901ff54513249/modules/flowable-cmmn-rest/src/main/java/org/flowable/cmmn/rest/service/api/runtime/planitem/PlanItemInstanceResource.java
[task-request]: https://github.com/flowable/flowable-engine/blob/0779d68e5a3385b74d8acb8bc37901ff54513249/modules/flowable-cmmn-rest/src/main/java/org/flowable/cmmn/rest/service/api/runtime/task/TaskActionRequest.java
[task-action]: https://github.com/flowable/flowable-engine/blob/0779d68e5a3385b74d8acb8bc37901ff54513249/modules/flowable-cmmn-rest/src/main/java/org/flowable/cmmn/rest/service/api/runtime/task/TaskResource.java
[task-response]: https://github.com/flowable/flowable-engine/blob/0779d68e5a3385b74d8acb8bc37901ff54513249/modules/flowable-cmmn-rest/src/main/java/org/flowable/cmmn/rest/service/api/runtime/task/TaskResponse.java
[factory]: https://github.com/flowable/flowable-engine/blob/0779d68e5a3385b74d8acb8bc37901ff54513249/modules/flowable-cmmn-rest/src/main/java/org/flowable/cmmn/rest/service/api/CmmnRestResponseFactory.java
[variables]: https://github.com/flowable/flowable-engine/blob/0779d68e5a3385b74d8acb8bc37901ff54513249/modules/flowable-cmmn-rest/src/main/java/org/flowable/cmmn/rest/service/api/runtime/variable/VariableInstanceBaseResource.java
[historic-variables]: https://github.com/flowable/flowable-engine/blob/0779d68e5a3385b74d8acb8bc37901ff54513249/modules/flowable-cmmn-rest/src/main/java/org/flowable/cmmn/rest/service/api/history/variable/HistoricVariableInstanceBaseResource.java
[app-rest]: https://github.com/flowable/flowable-engine/blob/0779d68e5a3385b74d8acb8bc37901ff54513249/modules/flowable-app-rest/pom.xml
[rest]: https://github.com/flowable/flowable-engine/blob/0779d68e5a3385b74d8acb8bc37901ff54513249/modules/flowable-rest/pom.xml
