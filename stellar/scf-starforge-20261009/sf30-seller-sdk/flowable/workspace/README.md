# Flowable process operations

This workspace gives an operator a complete view of a Flowable REST engine: original BPMN deployments and definition versions, active processes, human tasks, migration validation and process history. It preserves reviewed native requests and their replies alongside source resources, then exports the whole operating history for customer handover.

The industrial browser, local CLI, installed SDK, Applications integration and merchant MCP use the same model. Each deliberate engine change is prepared and saved before dispatch. Reopening a workspace recovers its saved records and interrupted operations.

## Connect an engine

Use the complete native service URL, normally ending in /flowable-rest/service. Declare credentials as environment names in a private JSON array:

~~~json
[
  {
    "id": "customer-engine",
    "label": "Customer Flowable",
    "baseUrl": "http://127.0.0.1:8080/flowable-rest/service",
    "usernameEnv": "FLOWABLE_USERNAME",
    "passwordEnv": "FLOWABLE_PASSWORD"
  }
]
~~~

The host environment supplies the actual username and password. Saved connection revisions and exported handovers contain those names. Native Basic authentication is resolved by the engine transport when a request is sent.

Open the workspace in a private directory:

~~~sh
starforge flowable-workspace open --dir /srv/private/flowable-workspace --connections /srv/private/flowable-engines.json --port 0 --url-output /srv/private/flowable-url.txt
~~~

The listener returns its actual port, private browser URL and workspaceId. Open that URL to use the browser. Keep its private URL file with the owning host. The Engines view saves additional connections and shows which declared credentials are available.

The original engine must grant the configured identity access to its REST API. Flowable 8.0.0 is the pinned native journey version. NATIVE_CONTRACT.md records its original publisher sources; NATIVE_RECEIVING.md explains the complete Linux engine and installed product run.

## Deployment and active work

Choose an engine and Refresh portfolio. Definitions shows native definition key, version, deployment and resource identities. Select a definition to read its original BPMN and available native diagram. The capture also includes complete current deployments, processes, tasks and historic process, task, activity and variable collections.

Releases accepts one original .bpmn20.xml or .bpmn file, or a complete .zip/.bar deployment archive. A Flowable multipart deployment consumes its first uploaded file; package multiple resources inside that native archive. Optional deployment name, key and tenant travel as native deployment fields.

Prepare the release, read its saved source and request, and dispatch the reviewed record. The workspace captures the returned deployment, native definition versions and original resources. A later deployment with the same process key produces a new version in Flowable.

Processes starts a selected definition using its exact native request body. Preserve the intended variable types and literal values:

~~~json
{
  "processDefinitionKey": "sf_grant_review",
  "businessKey": "customer-grant-2026-001",
  "variables": [
    {"name": "applicant", "type": "string", "value": "Customer organization"},
    {"name": "sourceSequence", "type": "long", "value": 9223372036854775806}
  ]
}
~~~

This is the native bodyText, not an SDK object to reserialize. The workspace keeps the original text bytes. Choose exactly one processDefinitionId, processDefinitionKey or message. Supply tenantId only with a supported key/message lookup.

Human tasks supports claim, unclaim, complete, delegate and resolve. Read the selected task and its assignee, owner, delegation state and definition key before preparing an operation. The original native task bodies include action:

~~~json
{"action":"claim","assignee":"reviewer"}
~~~

~~~json
{"action":"claim","assignee":null}
~~~

~~~json
{"action":"complete","variables":[{"name":"approved","type":"boolean","value":true}]}
~~~

A delegate operation assigns another user while preserving the task owner; resolve returns the delegated work according to Flowable's task state. The workspace reads active tasks and history after the operation.

## Migrate a running process

Deploy the intended new definition version first. Select the running process and exact target definition. The native document maps original activity IDs:

~~~json
{
  "toProcessDefinitionId": "THE-ACTUAL-TARGET-DEFINITION-ID",
  "activityMappings": [
    {"fromActivityId": "review", "toActivityId": "review"}
  ]
}
~~~

Replace the target ID with the actual engine value. Preparation invokes Flowable's native validate-migration endpoint and retains the full response. Review its validationMessages, target definition, process state and original document. Dispatch reruns current validation and applies the saved migration only when the reviewed preimage is current.

The three included workflow families each have two source versions. Version one runs intake and review; version two adds finalization. The full native journey deploys all six resources, operates all three families, migrates two actual running processes and completes the third on its original version.

## Operate from the CLI or SDK

While the browser owns a workspace, use its existing HTTP URL:

~~~sh
starforge flowable-workspace call --url-file /srv/private/flowable-url.txt --method view
starforge flowable-workspace call --url-file /srv/private/flowable-url.txt --method capturePortfolio --input /srv/private/capture.json --output /srv/private/capture-result.json
~~~

Use --workspace-id with the original returned UUID to bind the connection. Use --url-env instead of --url-file if the host keeps the private URL in an environment variable.

Every write input contains a stable requestId. Generate one with flowable-workspace request-id and retain it with the exact input. Preparation actions are prepareRelease, prepareProcess, prepareTask and prepareMigration. Their inputs include connectionId, selection, optional label and note. connectionId is the saved 24-character connection record ID returned by view; the native declaration's id is its alias.

A dispatch input includes requestId, id, expectedRevision and planSha256 from the prepared record. readReview uses kind, id and optional revision. reconcileOperation reads the current and historic outcome of a saved operation.

A local call with --dir owns that directory until it completes. Close its other local owner before using this mode. The installed client and merchant agent can attach to the existing HTTP owner.

The JavaScript entry point is openFlowableWorkspace({directory, connections, environment, fetch, signal}). It returns the same declared actions plus complete file methods and close(). Use the exported FLOWABLE_WORKSPACE_ACTIONS schemas or installed client types for exact input fields.

## Recovery and complete receiving

A native mutation is journaled before transport. Saved original exchanges let reconciliation identify a deployment, process or task result after an interrupted reply. The same requestId and identical input reopen the saved operation. Changes in the prepared target state return a stale review that can be prepared again from current state.

Handover exports all saved connection and operation revisions, original source resources, native request and response bytes, journals and receiving lineage. Download the complete saved delivery:

~~~sh
starforge flowable-workspace download --url-file /srv/private/flowable-url.txt --id DELIVERY_RECORD_ID --output /srv/private/flowable-handover.ndjson
~~~

Inspect it on the receiving workspace:

~~~sh
starforge flowable-workspace inspect --url-file /srv/private/receiver-url.txt --file /srv/private/flowable-handover.ndjson --request-id ORIGINAL-REQUEST-UUID
~~~

Read the returned receiving record, then call adoptDelivery with a new requestId, its id, expectedRevision and manifestSha256. The original stream, all revisions, source blobs and native journals are checked before adoption. Reopening the receiving directory resumes an interrupted adoption and exposes the complete original operating history.

The browser stores an unfinished request's full input before transport and reconnects with that original request. Raw source downloads and streamed NDJSON handovers keep complete file bytes. The workspace serializes local writes, uses a kernel ownership lease and drains active operations during close.
