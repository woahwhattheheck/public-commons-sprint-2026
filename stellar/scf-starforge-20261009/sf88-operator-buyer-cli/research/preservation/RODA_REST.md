# RODA research-transfer ingest client

The RODA client carries a prepared research transfer through the selected repository's original staging and ingest interfaces. It preserves the uploaded resource UUID, the complete create-job request, the server-assigned job ID, every received model report, and the resulting AIP records. The same prepared workspace is the continuation and handoff unit.

The producer and client share one root `workspace.lock`. A producer snapshot waits for the client to finish publishing its current journal. Moving or receiving a completed snapshot preserves the original operation identity; run one active writer for that operation.

## Prepare the repository profile

A repository operator supplies its application URL, account, staging location, collection scope and reviewed ingest workflow. The submission agreement in `agreement.json` is part of the prepared handoff, together with the complete source preservation verification and both package hashes. RODA's own pre-ingest guidance treats this agreement as the place to settle transfer and metadata requirements.

The outer transfer is one BagIt ZIP and is received as one AIP. The original preservation package remains inside it with the original path, byte-hash and record mapping. The producer resolves the original Commons-IP parser's packaging constraints. The REST client sends the exact prepared `transfer.zip` bytes and uses the configured BagIt ingest workflow.

Create a configuration outside the prepared workspace:

~~~json
{
  "schema": "stellar-forge.roda-client.v1",
  "baseUrl": "https://repository.example.org/roda",
  "repositoryUsername": "research-ingest",
  "auth": {
    "type": "bearer",
    "tokenEnv": "RODA_ACCESS_TOKEN"
  },
  "stagingParentUuid": "THE_EXISTING_STAGING_FOLDER_UUID",
  "timeoutSeconds": 120,
  "maxResponseBytes": 16777216,
  "reportPageSize": 100,
  "maxPages": 1000
}
~~~

`baseUrl` ends at the RODA application context, before `/api/v2`, and must equal the prepared agreement's repository URL. Omit `stagingParentUuid` to select the repository transfer root. A supplied parent is read back and must be a folder. The client verifies the authenticated user's exact name through `GET /api/v2/members/users/authenticated`.

For HTTP Basic, use `"auth":{"type":"basic","passwordEnv":"RODA_PASSWORD"}`; `repositoryUsername` is the Basic username. Supply the selected environment variable through the existing secret manager or operator session. Its value never enters the plan, command arguments, request journal or handoff. A private CA file can be selected with `caFile`; its exact bytes are hashed into the configuration. HTTPS uses normal certificate verification. An HTTP deployment requires the explicit `allowHttp:true` setting in its own configuration.

Credential configuration remains outside the receiving workspace. The plan retains its normalized nonsecret fields and environment-variable references so later operators can choose the same account and endpoint while supplying credentials in their own session.

## Use the repository's reviewed job template

The template has exactly these fields:

~~~json
{
  "name": "Reviewed research collection",
  "plugin": "org.roda.core.plugins.base.ingest.v2.ConfigurableIngestPlugin",
  "pluginParameters": {
    "parameter.sip_to_aip_class": "org.roda.core.plugins.base.ingest.BagitToAIPPlugin",
    "parameter.parent_id": "THE_AGREED_PARENT_AIP_ID",
    "parameter.force_parent_id": "true",
    "parameter.do_virus_check": "true",
    "parameter.do_descriptive_metadata_validation": "true",
    "parameter.create.premis.skeleton": "true",
    "parameter.do_file_format_identification": "true",
    "parameter.do_verapdf_check": "false",
    "parameter.do_digital_signature_validation": "false",
    "parameter.do_producer_authorization_check": "true",
    "parameter.do_apply_disposal_rules": "true",
    "parameter.do_auto_accept": "false",
    "parameter.email_notification": "",
    "parameter.notification_when_failed": "false"
  },
  "priority": "MEDIUM",
  "parallelism": "NORMAL"
}
~~~

This is a configuration example for operator review. The repository's installed plugins and agreed policy determine the actual parameters. Preserve the exact template exported or selected for that repository. The client accepts the current concrete `ConfigurableIngestPlugin` (RODA's default ingest workflow) or `MinimalIngestPlugin` v2 entrypoint with the BagIt-to-AIP parser. The Java `DefaultIngestPlugin` is an abstract base and cannot be selected. Every requested plugin parameter remains a string. Leave `parameter.total_steps` and `parameter.reporting_class` out of the submitted template: the original plugin derives them. If the operator selects `parameter.create_submission`, use exactly `"true"` or `"false"`.

When the agreement selects a parent AIP, `parameter.parent_id` must match it and `parameter.force_parent_id` must be `"true"`. A root-level agreement must not silently select another parent through the template. Review virus checking, metadata validation, disposal rules and automatic acceptance with the repository operator; these are existing ingest choices.

The client fills only the original transferred-resource selection and its own deterministic job name:

~~~json
{
  "sourceObjects": {
    "@type": "SelectedItemsListRequest",
    "ids": ["THE_VERIFIED_TRANSFER_UUID"]
  },
  "sourceObjectsClass": "org.roda.core.data.v2.ip.TransferredResource"
}
~~~

It appends `[sf88:<operation SHA-256>]` to the reviewed template name. This marker helps find an original server-assigned job after a lost HTTP response. It is a local correlation identity, not a server-enforced idempotency key.

## Execute the complete flow

Commands can be invoked directly or through the producer's `roda.py remote` forwarding entry.

~~~bash
python3 -B roda_client.py plan \
  --workspace /absolute/prepared-transfer \
  --config /absolute/operator/roda-config.json \
  --job-template /absolute/operator/roda-job-template.json

python3 -B roda_client.py run \
  --workspace /absolute/prepared-transfer \
  --config /absolute/operator/roda-config.json \
  --poll-seconds 300
~~~

`plan` verifies the prepared handoff and transfer/agreement hashes, validates the account and template configuration locally, then publishes one immutable `remote/plan.json`. It performs no repository request.

`run` opens or prepares that same plan, verifies the actual authenticated account, uploads the exact SIP when no original upload exists, verifies the staged download, submits the reviewed job once, and reconciles its current state. An existing plan can also be supplied with the original `--job-template`; changed parameters produce an explicit identity conflict.

The stages are separately callable when an operator wants to inspect each receiving boundary:

~~~bash
python3 -B roda_client.py upload --workspace /absolute/prepared-transfer --config /absolute/operator/roda-config.json
python3 -B roda_client.py submit --workspace /absolute/prepared-transfer --config /absolute/operator/roda-config.json
python3 -B roda_client.py reconcile --workspace /absolute/prepared-transfer --config /absolute/operator/roda-config.json --poll-seconds 300
python3 -B roda_client.py status --workspace /absolute/prepared-transfer
~~~

`status` validates retained local identity and opens the latest saved observation. It needs no credential configuration and makes no network request. `reconcile` reads the repository and saves complete observations; its POST calls to the index `find` endpoints are search reads. The client leaves scheduled jobs and repository approval/appraisal states visible for their original operator.

The poll deadline applies to waiting for the job state. The final reports and AIP receiving step uses the configured individual HTTP deadlines. A bounded wait returning a running job keeps its real ID and current state, ready for the next `reconcile`.

## What is saved

~~~text
prepared-transfer/
  handoff.json
  agreement.json
  transfer.zip
  original.zip
  ... producer source/package mappings ...
  workspace.lock
  remote/
    plan.json
    upload/
      request.json
      dispatch.json
      response-head.json
      response.body
      response.json
      accepted.json
    job/
      create-request.json
      request.json
      request.body
      dispatch.json
      response-head.json
      response.body
      response.json
      accepted.json
    exchanges/
      000001-read/
        request.json
        request.body
        dispatch.json
        response-head.json
        response.body
        response.json
      ...
    observations/
      <observation SHA-256>.json
    latest.json
~~~

Each mutating stage's request and dispatch record is complete and fsynced before its HTTP request is sent. The immutable request contains its method, exact URL, body identity, selected account and credential-variable reference. Completed job, index and report response bodies preserve their original bytes with SHA-256 and length. The authenticated-user response retains only the exact account identity fields needed for access verification; its original provider-body hash/length and explicitly marked identity projection avoid retaining password-reset or account tokens that a deployment might include. Transport errors remain adjacent to the original stage.

A staged ZIP download is streamed through SHA-256 and length validation. Once it matches the prepared transfer exactly, its response record references the already-retained `transfer.zip` instead of storing another large identical copy. Error bodies and JSON model/index/report responses remain in the journal.

Response headers retain content and request correlation metadata, status, timestamps and `Retry-After`. Authentication headers, cookies and credential values are not copied into the journal. API model bodies can contain repository account or object metadata, so use the original prepared workspace's access scope when sharing its receiving package.

Complete observations retain the job model and reported counters, model reports including nested steps and raw plugin details, actual AIP models, the selected upload UUID, all result AIP IDs and the observed status. HTML-looking plugin details remain plain data; an application must escape them when rendering.

## Reopen and reconcile interrupted requests

RODA creates a new job UUID for every create request. Repeating an uncertain `POST /jobs` can create another ingest. The client therefore keeps the first dispatch marker and looks up the original operation before sending anything again.

For upload recovery, it searches the original deterministic filename and staging parent, requires one matching resource, then downloads and checks the complete original ZIP. A reported resource size alone is insufficient. A partially copied file is retained as a mismatch and never becomes an ingest source.

For job recovery, it searches the immutable job marker plus the exact repository username, then reads `GET /api/v2/jobs/{id}`. The full model must match the original name, concrete plugin, every requested parameter, priority, parallelism and actor. The original `DefaultIngestPlugin` mutates the Job's map during service validation, adding `parameter.total_steps`, `parameter.create_submission` and `parameter.reporting_class`. The client validates that exact source-defined addition set, the effective step-count range, the lowercase submission boolean and the selected reporting class. Saved observations retain hashes of both requested and effective maps plus the derived values. Worker-local `parameter.job_id`, lock and parent defaults are applied to copied maps in the original orchestration code and are not silently accepted as extra submitted Job settings.

The original job initially selects the single verified upload UUID. RODA's autoaccept workflow can move its SIP into the configured processed area, assign a UUID based on its new path, and rewrite `Job.sourceObjects` and reports. For a changed source UUID, the client keeps the same exact job binding, reads the current resource, requires the original unique ZIP filename and size, and verifies the complete download against the prepared SHA-256. It saves one immutable `remote/job/source-moves/<identity>.json` with both UUIDs, both relative paths, the raw resource and the original download result. The original upload record and submitted request remain intact. An index summary alone does not establish either job or moved-source identity.

If the repository operator has the original UUID from its own logs, select it explicitly during the same reconciliation:

~~~bash
python3 -B roda_client.py reconcile \
  --workspace /absolute/prepared-transfer \
  --config /absolute/operator/roda-config.json \
  --transfer-uuid ORIGINAL_TRANSFER_UUID \
  --job-id ORIGINAL_JOB_ID
~~~

Both selections undergo the same exact receiving checks. A different ID cannot overwrite an existing accepted selection. `--transfer-uuid` always identifies the original upload; repository-generated moves are followed through the same job and the verified movement journal.

A lost write whose resource or job is not yet visible remains `UPLOAD_UNRESOLVED` or `JOB_CREATION_UNRESOLVED`. This preserves the actual dispatched request while the repository index/operation settles. The original request and filename/name are available to repository staff. The client cannot infer absence from one empty index search, replace an arbitrary resource, or convert an uncertain create request into another job. If an upload is partial, use the repository's original staging administration to resolve that exact file; keep its captured response and source bytes as the operation record.

Run only one active copy of an operation. The root filesystem lock serializes callers and producer snapshots on the original workspace; the remote RODA service does not enforce that lock across independently copied workspaces.

## Read the result at the object boundary

The client distinguishes the job's workflow state from its ingest result:

| Client status | Meaning |
|---|---|
| `PREPARED` | Original local handoff/configuration/template are frozen. |
| `UPLOADED_VERIFIED` | The original staged UUID and full ZIP bytes have been checked. |
| `JOB_ACCEPTED` | The server-assigned job is bound to the exact original request. |
| `INGEST_RUNNING` | The original job is still processing or stopping. |
| `JOB_PENDING_APPROVAL` | RODA has placed the job in its own approval state. |
| `JOB_SCHEDULED` | The repository scheduled the original job. |
| `JOB_FAILED_DURING_CREATION`, `JOB_FAILED_TO_COMPLETE`, `JOB_STOPPED`, `JOB_REJECTED` | The original terminal job state is retained with reports and any linked AIP. |
| `INGEST_RESULT_INCOMPLETE` | The completed job lacks the full expected one-source/one-AIP result at this observation. |
| `INGEST_REVIEW_REQUIRED` | A nested report or reported counter records failure, partial success or skipped work. |
| `AIP_UNDER_APPRAISAL` | The created AIP requires repository appraisal or manual intervention. |
| `INGESTED_ACTIVE` | The job reports one successful source, complete reports link one resulting AIP in the exact agreed parent scope, and the AIP is currently active. |
| `JOB_CHANGED_DURING_RECONCILIATION` | The job changed while reports were being received; repeat the same read to get a coherent later observation. |

RODA's internal `inFinalState` also classifies pending approval and scheduled jobs. The client uses the explicit workflow states, counters and AIP readback instead. A `COMPLETED` job can contain a failed object. A failed BagIt step can also have created an AIP before a later event failed. All actual linked AIP IDs are preserved so the operator can inspect or repair those objects through the repository's existing workflow.

Reports are paged using the documented `start` and `limit` parameters until the terminal short page. Each indexed report ID is reopened through the model report endpoint, retaining nested steps omitted from the index. Result links require the original job ID, a verified transferred-resource source UUID/class and the actual AIP outcome class. The move implementation updates the top report and only its first child, so valid nested reports may still reference the original UUID. The client accepts the original UUID and separately byte-verified movement UUIDs while preserving every report's actual identifier. Source-list changes during the report window use the existing changed-observation result; a temporarily unavailable moved source returns `JOB_SOURCE_MOVE_UNRESOLVED` with its exact job/original/current IDs for the same reconciliation. Saved movement verification remains usable if later staging-retention policy removes that source file. Default sentinel IDs are not treated as real objects. A linked AIP that is temporarily not retrievable remains in `resultAipIds` and `unresolvedAips`; the next reconciliation reopens that same result. A completed job must also report zero objects waiting or still being processed before the client reports an active ingest. Current AIP state is read through the original model endpoint `GET /api/v2/aips/{id}`, rather than inferred from a nested report's last state.

## Failure handling

HTTP 401, 403, 409, 429, missing resources, redirects and transport failures remain distinct. The error includes the retained response path and actual `Retry-After` when supplied. A request that fails before connection/dispatch can be reopened; a dispatched mutation first goes through original-ID reconciliation. Changed source, account, template, staging parent or collection bindings are explicit conflicts.

HTTP requests use bounded response sizes and deadlines. The upload's multipart envelope has an exact Content-Length; the ZIP is streamed from the original verified file. The client does not follow redirects carrying the selected credential. A cancelled command closes its HTTP connection and keeps the already-published stage identity.

`PREPARED_WORKSPACE_INVALID` preserves the original producer's validation reason in a structured client error. A changed original bag, outer SIP, agreement or derived receiving view is rejected before any repository call.

Exit codes are 0 for a received status (including running/approval/review states), 2 for an explicit client/provider error, and 130 for an interrupted command. Automation should inspect the returned `status`, particularly `INGESTED_ACTIVE`, rather than treating exit 0 as completed ingest.

## Source contract and compatibility

Implementation is based on the exact first-party [RODA commit 668f61b2d7d3154cb6cc3220ff83cbbd7e206822](https://github.com/keeps/roda/tree/668f61b2d7d3154cb6cc3220ff83cbbd7e206822), dated 7 October 2026. This identifies the reviewed source contract; the operator selects the actual deployment.

Relevant first-party sources:

- [Submission/pre-ingest procedure](https://www.roda-community.org/documentation/Pre_Ingest.html).
- [Checked-in OpenAPI](https://github.com/keeps/roda/blob/668f61b2d7d3154cb6cc3220ff83cbbd7e206822/openapi.json), blob `18e8dcb9754499ad5d4166e53be3595d696572f8`.
- [Transferred-resource controller](https://github.com/keeps/roda/blob/668f61b2d7d3154cb6cc3220ff83cbbd7e206822/roda-ui/roda-wui/src/main/java/org/roda/wui/api/v2/controller/TransferredResourceController.java), blob `2b4f0485cfdab2f910cf3c54e11a7dd24dfa4288`.
- [Original staging filesystem receiver](https://github.com/keeps/roda/blob/668f61b2d7d3154cb6cc3220ff83cbbd7e206822/roda-core/roda-core/src/main/java/org/roda/core/common/monitor/TransferredResourcesScanner.java), blob `3f9ea30f39cf173791128e21fe3ec08c947a6ff5`.
- [Jobs REST interface](https://github.com/keeps/roda/blob/668f61b2d7d3154cb6cc3220ff83cbbd7e206822/roda-ui/roda-wui/src/main/java/org/roda/wui/client/services/JobsRestService.java).
- [Jobs controller](https://github.com/keeps/roda/blob/668f61b2d7d3154cb6cc3220ff83cbbd7e206822/roda-ui/roda-wui/src/main/java/org/roda/wui/api/v2/controller/JobsController.java), blob `f031400532d31ea323464e2b2da37ad0f425e646`.
- [Job service](https://github.com/keeps/roda/blob/668f61b2d7d3154cb6cc3220ff83cbbd7e206822/roda-ui/roda-wui/src/main/java/org/roda/wui/api/v2/services/JobService.java), blob `8e2e7eebed449f4c71d22936e242272d8169f501`.
- [Actual create-job request model](https://github.com/keeps/roda/blob/668f61b2d7d3154cb6cc3220ff83cbbd7e206822/roda-common/roda-common-data/src/main/java/org/roda/core/data/v2/jobs/CreateJobRequest.java), blob `1fb65e7d9792bce33a00f042f0383f71ff851de3`.
- [Original Job-map alias](https://github.com/keeps/roda/blob/668f61b2d7d3154cb6cc3220ff83cbbd7e206822/roda-core/roda-core/src/main/java/org/roda/core/plugins/AbstractPlugin.java), blob `81df7bae774e8a2ad0aab25922320aad0b046121`.
- [Derived ingest parameters](https://github.com/keeps/roda/blob/668f61b2d7d3154cb6cc3220ff83cbbd7e206822/roda-core/roda-core/src/main/java/org/roda/core/plugins/base/ingest/v2/DefaultIngestPlugin.java), blob `16003cfcb7e7ac419425d6bfe276e28e0e32c347`.
- [Original SIP movement and report/source rewriting](https://github.com/keeps/roda/blob/668f61b2d7d3154cb6cc3220ff83cbbd7e206822/roda-core/roda-core/src/main/java/org/roda/core/plugins/PluginHelper.java), blob `45d6dd028c0e62770affbd8b753a618952a97379`.
- [BagIt-to-AIP implementation](https://github.com/keeps/roda/blob/668f61b2d7d3154cb6cc3220ff83cbbd7e206822/roda-core/roda-core/src/main/java/org/roda/core/plugins/base/ingest/BagitToAIPPlugin.java), blob `b7811fea4d48ceb3e7c3e97cc822c112291465fd`.

The checked-in OpenAPI differs from the current Java implementation in the upload/create schemas and full model-read paths. Upload is a multipart `resource` part even though the generated schema shows an `application/json` request. Create-job accepts the explicit `CreateJobRequest`, and `GET /api/v2/jobs/{id}` plus `GET /api/v2/aips/{id}` retrieve their full models even though those model-read paths are missing from the checked-in JSON. The client follows the original Java endpoint/request definitions in these cases.

The native protocol receiving exercise uses this exact contract and a recorded local HTTP runtime to check upload bytes, a lost upload response, a lost job-create response, same-ID discovery, server-derived Job parameters, unchanged requested settings, full reports/AIP outcomes, verified processed-SIP movement with mixed report UUIDs, actual complete snapshot export/receive/reopen and changed-source rejection. Its receipt names the actual source, host, simulated transport faults and counters. Repository acceptance uses the selected deployed RODA account and the same prepared package, then retains the actual server responses and result AIP.
