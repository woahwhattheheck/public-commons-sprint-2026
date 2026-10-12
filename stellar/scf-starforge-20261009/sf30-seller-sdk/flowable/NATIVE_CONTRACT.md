# Native Flowable process operations

The native client uses Flowable Open Source 8.0.0, release commit 0779d68e5a3385b74d8acb8bc37901ff54513249. It keeps the original engine in charge of BPMN deployment, process execution, human task actions and migration validation/execution. This module imports Node's crypto only.

## Connection and authentication

Declare {id,label?,baseUrl,usernameEnv,passwordEnv}. normalizeFlowableConnection returns schema stellar-forge.flowable-connection.v1 and a trailing-slash original REST base, normally http://127.0.0.1:PORT/flowable-rest/service/. The ID is a named host handle of 1–128 ASCII letters, digits, dot, underscore or hyphen, beginning with a letter or digit. Environment names identify the existing Basic-auth credentials; values stay in the selected process environment. URLs cannot embed credentials, query or fragment.

createFlowableTransport(connection,{environment,fetch,signal,timeoutMs,maxResponseBytes}) resolves those exact names once. The default response bound is 64 MiB, configurable up to 1 GiB; the default timeout is 120 seconds, configurable up to one hour. Original redirects are retained and are not followed. No write is retried by this transport.

## Exact selected requests

planFlowableRequest(connection,selection) freezes original HTTP method, relative path, query, media type and complete body bytes, together with requestSha256 and the normalized connection hash. The workspace separately hashes the complete saved plan. Request digest fields include connection identity, method, path, query, content type, body length and body SHA-256.

| Selection | Original native request |
| --- | --- |
| {action:"deploy",deploymentName?,deploymentKey?,tenantId?,resource:{filename,contentType?,contentBase64}} | POST repository/deployments, exactly one multipart file. Native BPMN suffixes .bpmn20.xml and .bpmn are case sensitive; .bar and .zip are case insensitive. Optional metadata is passed through the actual query fields. |
| {action:"start",bodyText} | POST runtime/process-instances. Preserve the complete original JSON text, including large typed values. Exactly one processDefinitionId, processDefinitionKey or message is required by the engine. |
| {action:"claim"|"complete"|"delegate"|"resolve",taskId,bodyText} | POST runtime/tasks/{taskId}. bodyText.action must match. A null assignee for claim is the original unclaim action. Successful task actions have an empty 200 response. |
| {action:"validateMigration"|"migrate",processInstanceId,bodyText} | POST runtime/process-instances/{id}/validate-migration or /migrate. Validation returns validationMessages; execution returns an empty 200 response. |
| {action:"migrateDefinition"|"batchMigrateDefinition",processDefinitionId,bodyText} | POST repository/process-definitions/{id}/migrate or /batch-migrate. The original controller returns no batch identifier. |

The deployment contains one original BPMN file or a complete native ZIP/BAR, up to 256 MiB of source bytes. It is not a new archive or BPMN converter. Other bodies retain complete JSON text up to 64 MiB. The migration document uses toProcessDefinitionId or the original key/version/tenant fields and activityMappings. For a stable user task, an explicit mapping is {fromActivityId:"review",toActivityId:"review"}. Native advanced mapping, variable, delegate and script fields remain unchanged for the original engine's validation.

executeFlowableRequest(transport,plan,callbacks) dispatches exactly once. A failure after dispatch retains outcomeUnknown and the actual partial response when available. The original workspace must reconcile the saved operation before considering another request.

## Whole native capture and source bytes

captureFlowablePortfolio(transport,callbacks) walks the complete original deployments, definitions, runtime processes, runtime tasks, historic processes, historic tasks, historic activities and historic variables collections. Each collection contains items, pages, total, complete and exchanges. Pages retain original start/size/total, request digest and response digest. Start advances by the actual returned data length. A changed total, repeated ID, non-advancing page or incomplete native response raises a specific error. A full capture is a sequence of native reads, not an atomic engine snapshot.

Every deployment's complete native resource list is read, then every original dataUrl is fetched within the selected REST base. The resource retains deployment ID, related definition IDs, original filename, media type, bytes, SHA-256 and complete contentBase64. BPMN XML is never regenerated from metadata. Original resource and diagram URLs associate each resource with its actual process definitions; multi-definition archives retain those individual relationships.

Callbacks support {signal,pageSize,retainBodies,onExchange,onDefinition}. onExchange(full) and onDefinition(full) may return immutable JSON references {sha256,bytes,mediaType}. With retainBodies:false, the returned metadata contains bodyRef or definitionRef instead of bulky original bodies. The sink always receives complete exact bytes before their omission. Response fields include original requestSha256, method/path/query/bodySha256, status, complete, bodyBytes/bodySha256, headers, bodyBase64, bodyText and parsed JSON when valid.

## Selected preimage and reconciliation

readFlowableRequestState(transport,plan,{...callbacks,response?}) returns original definitions, deployments, processes, historicProcesses, tasks, historicTasks, activities, historicActivities, historicVariables, resources and exchanges. The optional response is the complete exact original request receipt; its returned deployment or process ID selects the corresponding readback. It must match the frozen request and original response bytes.

Start preimages preserve matching existing business-key IDs. After dispatch, both runtime and historic process records are read, including synchronously completed instances. Task actions read original task history and process state; completion is identified through native endTime and completion history. Migration reads the exact target definition, active activity IDs and preserved native task properties.

reconcileFlowableRequest(plan,before,after,response) returns {state,summary,evidence}. CONFIRMED denotes observed native correspondence. Evidence states whether the native request was actually acknowledged or recovery is based on a current native state. ACCEPTED keeps an original successful receipt whose complete selected readback is still pending. REJECTED retains the complete native rejection. UNKNOWN retains an unresolved operation without repeating its mutation.

A lost start is recoverable only from a unique new process with the reviewed business key, native definition and corresponding retained initial variables of that exact process instance. Exact long/double readback evidence is parsed losslessly; the original JSON body is unchanged. Transient variables or complex initial form values without durable native correspondence remain unresolved. Advanced migration scripts or mapping semantics retain the native receipt/validation and remain ACCEPTED until adequate readback is available; this client does not simulate those engine effects.

The workspace's pre-dispatch identity includes stable native read request/body hashes, so original numeric values beyond JavaScript's safe integer range remain sensitive to drift even when the displayed parsed metadata rounds them.

## Publisher runtime and source

The original distribution is https://github.com/flowable/flowable-engine/releases/download/flowable-8.0.0/flowable-8.0.0.zip, 101332703 bytes, SHA-256 d0f9ad0b7b2170881d66928178cf31c66084f1d6e3ffe6237afb32d8e9f4ad1d. Its executable member is wars/flowable-rest.war. The original app runs with Java 17 or later and includes H2. The maintained native host supplies its private database, admin environment, history settings and selected ports.

Original REST users are POST identity/users with {id,firstName,lastName,email,password}, returning 201, and GET identity/users/{id}, returning 200 or 404. The operator's default admin privilege is created through the original app properties; the handover retains environment names rather than credential values.

The original native-host and native-journey commands retain full engine/source/workspace history. The installed product hook reuses that same native engine and the original completed source delivery. See native-contract-sources.json for the exact original controllers, migration converter and publisher references.
