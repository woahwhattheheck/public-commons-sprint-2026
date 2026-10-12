# Flowable 8 native decision contract

This adapter uses the original Flowable 8.0.0 DMN REST implementation. It neither converts decision models nor evaluates expressions locally. All deployed source, typed request bodies, native result bytes and audit JSON remain attributable to the original engine.

## Engine and connection

The pinned implementation is Flowable `8.0.0`, revision `0779d68e5a3385b74d8acb8bc37901ff54513249`. The original distribution `flowable-8.0.0.zip` contains `wars/flowable-rest.war`, with the DMN REST engine included alongside the process engine. Use the existing native Flowable host and its original private database and credential references.

Save the actual DMN REST base explicitly, for example `http://127.0.0.1:8080/flowable-rest/dmn-api/`. The adapter never derives a sibling URL from a process connection. A connection has the same original `id`, `label`, `baseUrl`, `usernameEnv` and `passwordEnv` fields as `native.mjs`; authentication values are read from the selected environment, never stored in the connection or an exchange.

The official Spring Boot property reference documents `flowable.dmn.enabled=true` and `flowable.dmn.history-enabled=true` as defaults. The original native host sets history explicitly for reproducible audit receiving. Its DMN servlet property is `flowable.dmn.servlet.path=/dmn-api`. Evidence: https://www.flowable.com/open-source/docs/bpmn/ch05a-Spring-Boot (read 2026-10-12). This is a first-party documentation observation; the pinned 8.0.0 properties class was not retrieved while the account read quota was exhausted. The REST routes, types and source behavior below are independently pinned to the actual 8.0.0 controller files in `DMN_SOURCE_MAP.json`.

## Native JavaScript API

All exports live in `dmn-native.mjs`, which imports only Node crypto and the original sibling `native.mjs`.

| Export | Contract |
| --- | --- |
| `FLOWABLE_DMN_COLLECTIONS` | Frozen array `['deployments','definitions','historicExecutions']`. |
| `FLOWABLE_DMN_SOURCE_KIND` | `dmn-definition-resource`. |
| `FLOWABLE_DMN_AUDIT_KIND` | `dmn-execution-audit`. |
| `planFlowableDmnRequest(connection, selection)` | Pure exact native request planning; no network or engine substitute. |
| `createFlowableDmnTransport(connection, options)` | Original authentication, fetch, signal, timeout and response byte ownership from `createFlowableTransport`. |
| `executeFlowableDmnRequest(transport, plan, callbacks)` | One original request and complete response/error exchange; never retries a mutation. |
| `captureFlowableDmnPortfolio(transport, callbacks)` | Complete paged native inventory, all exposed source references and every captured audit. |
| `readFlowableDmnRequestState(transport, plan, callbacks)` | Selected definitions/deployments plus complete relevant native history, sources and audit evidence. `callbacks.response` is the hydrated original response used for exact returned deployment-ID readback. |
| `reconcileFlowableDmnRequest(plan, before, after, response)` | Native acknowledgement/current-source evidence, explicit rejection or unresolved outcome. No mutation replay. |

The original version/commit and `normalizeFlowableConnection` are re-exported. Calls accept `environment`, `fetch`, `signal`, `timeoutMs` and `maxResponseBytes` through the maintained transport. The original per-response bound defaults to 64 MiB and permits an explicitly selected bound up to 1 GiB. There is no hidden inventory total limit; pagination is complete or fails with retained evidence.

## Original requests

### Deploy one original decision resource

```json
{
  "action": "deploy",
  "tenantId": "optional-original-tenant",
  "resource": {
    "filename": "grant-eligibility-v1.dmn",
    "contentType": "application/xml",
    "contentBase64": "COMPLETE_ORIGINAL_BYTES"
  }
}
```

The source byte bound is 256 MiB. Upload uses native `POST /dmn-repository/deployments`, with one deterministic multipart file and optional native `tenantId` query. The original deployment name is the full source filename. Native `DmnResourceUtil` checks case-sensitive endings `dmn`, `dmn.xml`, `dmn11` and `.dmn11.xml`. The pinned upload controller does not implement ZIP/BAR handling even though historical API prose mentions an archive; the adapter exposes only the actual implementation.

The plan retains the exact source filename/type/byte count/SHA and original multipart body. Execution reconstructs its selected request and rejects any changed source, body, boundary, query, connection or readback identity before dispatch.

### Evaluate with the original engine

```json
{
  "action": "evaluate",
  "mode": "decision",
  "singleResult": true,
  "bodyText": "{\"decisionKey\":\"d76c_grant_eligibility\",\"inputVariables\":[{\"name\":\"requestedAmount\",\"type\":\"bigDecimal\",\"value\":\"10000.1250\"},{\"name\":\"recordNumber\",\"type\":\"bigInteger\",\"value\":\"922337203685477580612345\"}],\"disableHistory\":false}"
}
```

| Mode | Multi-result route | Single-result route |
| --- | --- | --- |
| `auto` | `POST /dmn-rule/execute` | `POST /dmn-rule/execute/single-result` |
| `decision` | `POST /dmn-rule/execute-decision` | `POST /dmn-rule/execute-decision/single-result` |
| `decisionService` | `POST /dmn-rule/execute-decision-service` | `POST /dmn-rule/execute-decision-service/single-result` |

Defaults are mode `auto` and `singleResult:false`. Preserve complete `bodyText` verbatim; the adapter checks JSON structure without reserializing its numeric or string values. The native request permits only `decisionKey`, `tenantId`, `parentDeploymentId`, `inputVariables` and `disableHistory`. Variables use original `name/type/value/valueUrl` fields; repeated names are rejected before the engine's map would silently replace them.

The controller resolves a decision by native key, tenant and optional parent deployment scope. It has no arbitrary decision-ID or historical-version request field. The workspace may display captured native versions, but evaluation must use the actual native selection semantics. An operator must deploy/select an appropriate original scope to evaluate a particular version.

`bigDecimal` and `bigInteger` are first-class original variable types. Their converters consume decimal strings and return decimal strings (`BigDecimal.toPlainString()` and `BigInteger.toString()`). This preserves values beyond JavaScript's integer precision. Native `long`/other JSON numbers remain exact in retained raw request/response bytes even when a JavaScript metadata projection is lossy.

A successful original evaluation returns HTTP 201 and `resultVariables` plus `url`. Multi-result responses carry nested variable arrays; single-result responses carry one variable array. Neither response contains a historic execution ID. `disableHistory:true` is preserved as an explicit original engine setting.

## Complete source and audit capture

Collections retain original records unmodified in `{items,pages,total,complete:true,atomicSnapshot:false,exchanges}`. Deployment and definition inventories sort by the native `id`; native history supports `startTime/endTime/tenantId` sorting, so capture uses `startTime`. Start/size/total, duplicate IDs and early termination are verified. Concurrent total changes fail as an incomplete capture with all already saved exchanges; the adapter does not claim a cross-request atomic database snapshot.

The complete portfolio shape is:

```text
{schema, connectionId, connectionSha256, startedAt, completedAt,
 collections:{deployments,definitions,historicExecutions},
 resources, exchanges, atomicSnapshot:false,
 sourceCoverage:'ALL_NATIVE_DEFINITION_RESOURCE_REFERENCES',
 auditCoverage:'ALL_CAPTURED_NATIVE_EXECUTIONS'}
```

| Evidence | Native route | Retained identity |
| --- | --- | --- |
| Decision definition | `GET /dmn-repository/decisions` and native detail | Original id/key/version/decisionType/deploymentId/resourceName. |
| Deployment | `GET /dmn-repository/deployments` and native detail | Original id/name/tenantId/parentDeploymentId. |
| Source bytes | `GET /dmn-repository/deployments/{id}/resourcedata/{name}` | `kind:'dmn-definition-resource'`, deploymentId, definitionIds, optional single definitionId, exact filename/type/bytes/SHA. |
| History | `GET /dmn-history/historic-decision-executions` | Every original historic record and native ID, including its own decisionDefinitionId/deploymentId and scope fields. |
| Audit bytes | `GET /dmn-history/historic-decision-executions/{id}/auditdata` | `kind:'dmn-execution-audit'`, executionId, original definition/deployment IDs when provided, exact audit JSON bytes. |

The DMN REST repository has no resource-listing endpoint. Full portfolio source capture therefore follows every exposed native definition resource reference. Selected deployment readback additionally reads the exact known uploaded filename, including a deployment without a discovered definition. The capture does not claim to enumerate arbitrary server-side files that this API does not expose.

Resources use `stellar-forge.flowable-source-resource.v1` and include complete `contentBase64` or the immutable `definitionRef`. Native audit bytes are retained unchanged; no local expression evaluation or reconstructed audit replaces them.

## Exact sinks and operation identity

With `retainBodies:false`, provide both async callbacks:
`onExchange(fullExchange) => {sha256,bytes,mediaType}` and
`onDefinition(fullSource) => {sha256,bytes,mediaType}`.
Each callback persists the complete original JSON before the caller receives stripped metadata. `bodyRef` identifies the full exchange JSON, not merely the response body. `definitionRef` identifies the full source JSON, which includes its original byte content. Without both sinks, the default retains complete bodies in the returned object.

Plans carry schema `stellar-forge.flowable-dmn-native-request.v1`, the original engine version, full connection identity, method/path/query/type/body bytes/body SHA and a `requestSha256` using the original process adapter request-core algorithm. Native exchanges carry that exact SHA, request method/path/query/body identity, status, headers, complete/partial state and original bodyBase64/bodyText/json. Error exchanges are retained before rethrow, including uncertainty flags. Secret authorization values are excluded.

Selected request state uses `stellar-forge.flowable-dmn-native-state.v1` and arrays `definitions`, `deployments`, `historicExecutions`, `resources`, `exchanges`. Historic evaluations never expand the selected source arrays with unrelated historical definitions; their IDs remain `historyDefinitionIds` and the original historic/audit records. The workspace's dispatch preflight must compare selected native definitions/deployments and source resources while excluding concurrent history/audit additions. Keep complete raw selected-source exchange digests when precision-sensitive native metadata participates in preflight.

## Recovery rules

The workspace saves the frozen plan, selected source preimage and request identity before dispatch. Once dispatch may have occurred, it never repeats an evaluation or deployment automatically.

A native HTTP 201 deployment response plus exact source readback is confirmed using the original returned deployment ID. With a lost response, exactly one newly observed native deployment containing the entire selected source can be reported as `CURRENT_NEW_NATIVE_SOURCE_MATCH`, with `nativeAcknowledged:false` and `requestAttribution:'CURRENT_STATE_ONLY'`. This reports the actual current source and does not fabricate an engine receipt. Multiple candidates remain unresolved.

A full original HTTP 201 evaluation response confirms the saved evaluation and retains its typed results. New historic executions are only `CANDIDATES_NOT_REQUEST_IDS`: even a matching key/value/time does not prove request attribution. If the original response is missing, state remains UNKNOWN and `replayAllowed:false`. A complete native rejection preserves its error body. An acknowledged response without its expected complete source/result shape remains ACCEPTED for further readback.

## Native receiving cohort

`fixtures/decisions/decision-catalog.json` names six exact operator-authored DMN files: two editions each for grant review, vendor screening and onboarding routing. It defines eight edition/case evaluations, including decimal and integer strings beyond JavaScript precision, two result shapes and changed native output after a newer deployment. These are demonstration policies, not inferred Counterpoint or customer requirements.

The maintained whole native journey uses the actual Flowable 8 WAR, shared private engine and original source/response/audit APIs. It continues through the existing durable workspace, browser, SDK, CLI, MCP, full export, receiving and cold reopen. Source syntax review is not a claimed native pass; publish actual engine results separately.
