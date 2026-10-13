# Replication Workbench operating guide

Replication Workbench gives a data owner and receiver a complete source-to-consumer workflow: retain original configuration and data, review an exact plan, run the original Sling engine, compare every selected typed row, select a consumer with rollback and independently receive the whole editable project. The browser, CLI and Merchant agent use the same original application and workspace history.

This guide describes the complete installed integration. An actual customer result requires the same original native/browser receiving course to finish. Source publication alone is not an operated customer deployment.

## 1. What is installed and who owns it

The package contains the complete 70-file maintained source under workbench/, selected by original-source.json from Commons commit 6d969651d2f48f1ca620f94ed88c33c65f07577e, prefix revenue/slingdata_replication_workshare_20261012/. Its origin is d074376ca95c0a5cc6c7abb1f28409201c1082ee. The selected edition repairs original server/workspace observer closure and exact consumer-phase recovery, updates its full source manifest, and carries the current rendered-product instruction in the active operator guide. original-source.json retains all five preimage/postimage identities. All other original leaves, native engine, fixtures and licensing remain unchanged. The adapters beside workbench/ add managed Applications, a private Merchant provider, Installation and full source distribution.

| Command | Purpose |
| --- | --- |
| replication-workbench | Forward the unchanged original CLI main |
| replication-workbench-prepare | Prepare/reopen the exact original Sling runtime and its declared receiving selection; see PREPARING.md |
| replication-workbench-managed | Run the original application under one Applications owner |
| replication-workbench-receive | Continue the original full native/browser/project course and its installed Applications/Merchant receiving extension |

Use Linux amd64, Node 24, Python 3 with its standard SQLite module and the existing flock command. The application uses Node built-ins; it does not require an npm dependency installation. Select the actual absolute Python interpreter for native inspection and consumer queries.

The native source is original Sling 1.6.5, commit 7641892e24a7023c8012069596698970c7b3e041. Its complete Linux amd64 archive is 121,317,497 bytes and SHA256 e4e386c7d4429b33a213c146594be0bf6efa38f4732035dd67e307616fcb9c66. Retain its original license under workbench/upstream/sling and the separately retained Stellar lease/source closure under workbench/vendor/stellar-expert.

The original commercial Sling workshare remains its own case and sender. This TJLabs product does not imply vendor endorsement or a newly agreed fee. The supplied native reference uses authored configuration around original Sling CSV fixtures; it is not customer data.

## 2. Source and runtime selection

Use the complete installed product package and its full manifest. Keep business workspaces and private configuration outside the editable source tree. Original source collection includes supported source/data extensions and excludes its own generated node_modules, .git, .runtime and dist directories. Do not place private receipts, credentials or new unmanifested source files in workbench/.

The original installer can receive an already retained complete release or acquire its exact pinned release. The unchanged native entry point is:

~~~sh
/absolute/python3 /absolute/product/workbench/native/install.py \
  --directory /absolute/private/sling-runtime \
  --archive /absolute/retained/sling_linux_amd64.tar.gz

/absolute/python3 /absolute/product/workbench/native/install.py \
  --directory /absolute/private/sling-runtime --reopen
~~~

The complete ready receipt is /absolute/private/sling-runtime/runtime-ready.json. Reopening rechecks the selected archive, executable and version; a receipt copied from another location is not proof that those paths exist or match on this host. Use the additive preparation command for the complete installed preparation and independent runtime receiving:

~~~sh
replication-workbench-prepare prepare --directory /absolute/private/replication-preparation --python /absolute/python3 --archive /absolute/retained/sling_linux_amd64.tar.gz
replication-workbench-prepare inspect --directory /absolute/private/replication-preparation
replication-workbench-prepare export --directory /absolute/private/replication-preparation --output /absolute/delivery/replication-runtime.package
replication-workbench-prepare receive --directory /absolute/private/replication-received --archive /absolute/delivery/replication-runtime.package --python /absolute/receiving/python3
~~~

Continue the same interrupted prepare/receive with its identical selection and --resume. The result schema is stellar-forge.replication-workbench-preparation.v1 with state READY, primary/receiving bindings, source, portable and request. Each non-null binding retains applicationDirectory, runtimeDirectory, runtimeReadyFile, exact ready descriptor and the full original runtime record. Use the actual returned application and runtimeReadyFile in launch configuration; do not synthesize a location or move an old ready file. The installed receiver consumes the saved result with --preparation-result. PREPARING.md gives its complete source/archive/lifetime and interruption rules.

The original application can inspect closed historical packages without a configured native engine. The managed customer launch deliberately binds a verified runtime; native continuation is always an explicit original action. A different runtime/source selection is an explicit reviewed installation change.

### Installed execution scope

The semantic compiler handles its supported Airbyte configuration families and produces original Sling replication documents. The installed native snapshot worker executes the SQLite source/parallel-target reference and exports full typed rows. Other source/target connector pairs require their own complete commissioned execution/export/snapshot adapter. A plan that describes a connector does not demonstrate that connector was operated.

The original reference has 1,000 baseline rows and 14 changed rows: 12 updates plus 2 inserts, with an expected final 1,002. Treat these as source expectations until actual native receipts establish the result.

## 3. Private actor and Applications configuration

Create a mode-0600 installation-owned auth file outside workbench/ and outside portable project archives. Generate real independent random tokens; the following describes the schema and is not a deployable secret:

~~~json
{
  "schema": "tjlabs.sling-auth.v1",
  "actors": [
    {"id":"replication-operator","name":"Customer replication operator","roles":["operator"],"token":"REPLACE_WITH_PRIVATE_RANDOM_TOKEN_AT_LEAST_24_CHARACTERS"},
    {"id":"replication-viewer","name":"Independent receiving reviewer","roles":["viewer"],"token":"REPLACE_WITH_ANOTHER_PRIVATE_RANDOM_TOKEN_AT_LEAST_24_CHARACTERS"}
  ]
}
~~~

Original roles are operator and viewer. Both can read the whole installation; only operator can mutate. There is no tenant or per-project grant model in this application. Use a separate original workspace/auth installation where the required business boundary is a separate audience.

Select a complete private managed launch:

~~~json
{
  "schema":"stellar-forge.replication-workbench-launch.v1",
  "applicationDirectory":"/absolute/installed/source/products/replication-workbench/workbench",
  "directory":"/absolute/private/customer-replication",
  "authFile":"/absolute/private/replication-auth.json",
  "actorId":"replication-operator",
  "runtimeReadyFile":"/absolute/private/sling-runtime/runtime-ready.json",
  "connectionFile":"/absolute/private/replication-connection.json",
  "python":"/absolute/python3",
  "consumerRoot":null
}
~~~

applicationDirectory must contain exactly the selected maintained 70 files. directory is the original customer workspace. The generated connectionFile belongs outside that workspace. The runtime-ready and absolute Python are the actual receiving host’s selections. consumerRoot is null for a retained workspace copy or an explicitly authorized customer-owned directory for reviewed downstream edits; it is not an arbitrary path supplied through an agent request.

Use the existing Applications provider replication-workbench to review/save this complete configuration, then Start. The provider pins the source manifest and configuration. The same original listener owns the workspace lease. Open its actual browser address, log in with the private actor token and retain the returned installation/project identity. Do not start a direct CLI writer alongside that workspace’s managed listener.

### Stop and native jobs are separate operations

Applications Stop closes the HTTP observer and its owned handles. **Accepted detached Sling jobs keep their inherited kernel lifetime.** Stop does not cancel those jobs. Use the original job.cancel action to request cancellation and observe its actual native state. Reopening Applications reconciles the same jobs and their original attempts.

An original close failure retains the same handles for closure; do not start a replacement owner to hide uncertainty. A received job is closed/suspended at its receiving boundary and needs explicit supported continuation. Kernel ownership, original native operation and recorded attempts remain authoritative.

## 4. Original project and complete source intake

Create a project with its actual title and notes. The native title limit is 300 characters and notes limit 20,000. Keep the original request ID. Source and project IDs use letters, digits, dots, underscores, colons and hyphens, with a 160-character maximum.

The original project GET returns an envelope containing view, result, replayed and currentRevision. Use view for the selected original project. A historical request result retains its committed revision/result while currentRevision, consumer status and runtime availability can be current. Do not compare the whole envelope byte-for-byte to infer that an original replay changed its committed result.

Upload the complete original file before source.retain. Maximum whole upload is 2 GiB; original chunks are at most 8 MiB. Each range has Content-Range and its SHA256. Exact committed-range replay verifies the original bytes. Finish verifies the full length/SHA and fixes the object identity. The completed upload does not itself add a project source; source.retain does.

For each source retain its original filename/media type, full SHA/length, title, role, URL/acquisition reference and notes. Structured configuration used for plan compilation is at most 32 MiB. Retain source authority and complete population separately from private connection credentials.

Useful source roles identify the actual input: original Airbyte configuration, complete CSV or SQLite snapshot, original downstream text-file map and reference/binding material. The source role is a retained descriptive field, not permission to substitute an unreviewed file.

Use source_connections to list actual supported connection choices from a retained source. The maintained reader recognizes protocol configured catalogues, configuration/public API shapes and supported Terraform show/state/resource shapes. A source with multiple connections needs an explicit selected connection. It does not become several commissioned tasks merely because it contains several resources.

## 5. Compile, review and run the original plan

plan.compile receives sourceId, title and options. Its options are the maintained migration compiler’s original contract, including explicit sourceConnection, targetConnection, dialects, streamBindings, businessColumns and reviewed native overrides where used. workbench/reference/baseline-bindings.json and evolved-bindings.json are complete authored examples. Select real customer mappings before execution.

Review namespaces, selected fields, complete primary keys, configured/default/source-defined cursor, source/destination modes, types and explicit source/previous/parallel relations. Unsupported transformations or history semantics stay visible in plan.issues and adaptation requirements. plan.review approves only the exact ready plan; retain a meaningful reason in notes.

The supplied native sequence is:

1. Retain the complete baseline CSV or source snapshot.
2. For CSV, source.load prepares a native import with mode full-refresh, table and original primary/update keys.
3. job.start begins that original prepared job. Read its current project until its original native state and complete files are retained.
4. run.prepare selects the approved planId, sourceJobId or sourceSnapshotId, phase baseline, and optional targetSnapshotId.
5. job.start begins the original replication; retain all attempt/step/command outputs.
6. comparison.create selects the complete original replication job and full typed observations.
7. Retain the real update input and run an incremental source.load against previousJobId, with explicit primaryKey and updateKey.
8. Compile/review any evolved configuration, then run.prepare with the current source and actual previous target job, phase incremental.
9. Compare the whole current output before consumer selection.

The complete original reference includes the actual update-key behavior and reviewed json_data addition. Do not simplify its configuration to row counts or regenerate a similar fixture.

### Native recovery

The original job state records prepared, queued, running, cancelling, complete, failed, interrupted, cancelled or awaiting_reconciliation as applicable. Retain the actual selected job/attempt/step, not a guessed new ID.

| Action | Original intent |
| --- | --- |
| job.start | Start the selected prepared/queued original job |
| job.cancel | Request cancellation of that actual pending/live job |
| job.resume | Continue the same ended failed/interrupted/reconciliation/cancelled job with a reason |
| job.resolve | Select the actual unresolved target-write stepId and attemptId, decision retry/adopt/abandon and reason |

A native write may have happened before its result was retained. The original worker preserves uncertainty and requires explicit reconciliation. Do not replay an unresolved target write as if it were an ordinary read.

Current project and consumer reads call original reconciliation. They can observe or continue already accepted queued work under the original runtime contract. They do not create a newly authorized job, but they are not a substitute for reading the accepted operation’s ownership state.

## 6. Complete comparison, consumer selection and rollback

comparison.create retains both the complete observations and complete comparison against the selected original plan. Inspect all streams and full rows through their retained files. Check schema, keys, null/type meaning, exact values and duplicate multiplicities. A successful native process and equal row count alone do not establish accepted output.

The original report must be readyForCutover for the current approved plan before cutover.apply. Retain its comparisonId and an explicit reason. The resulting selection pins the exact target SQLite snapshot, job, plan, comparison and stream/table bindings; the prior source/consumer selection remains available.

consumer reads the actual selected immutable snapshot through the original Python adapter. Its result includes selection, snapshot, streamId, columns, rowCount, rows, offset, limit and nextOffset. Use the native JSON stream identity, for example the literal string ["main","test1"], rather than a display label. Page all rows with limit at most 1,000 and follow nextOffset. If the selection changes during a multi-page review, restart that review against a deliberately selected stable binding; do not mix pages from different editions.

cutover.rollback takes the current cutoverId and reason. It restores that selection’s recorded previous binding. Read the complete resulting consumer again. A final re-selection is another explicit action with a new real reviewed request; keep both transitions in history. Historical project views do not themselves change the current consumer.

## 7. Reviewed downstream file changes

Retain the complete original text-file map as a source. downstream.plan binds planId, sourceId, optional comparisonId, title, reason and exact edits. Each edit names an original safe relative path, find, replace, expected occurrence count and reason. Use workbench/reference/consumer-edits.json only as the authored reference.

Review the full original plan and inventory. downstream.apply needs a ready plan for the current migration and an explicit reason. It applies to the declared private consumerRoot or the original workspace copy. Full original and resulting files, operation IDs, drift and errors are retained.

downstream.restore preserves the same original file plan and reason. downstream.resume continues the actual ended/suspended operation with its original ID and an explicit reason. A received operation never silently takes ownership of a source-host external consumer directory.

Retain both the downstream plan output and each original operation file through their exact native routes. A generic output kind downstream means the plan in the original HTTP API; the Merchant artifact kind downstream_plan selects it. Merchant kind downstream with a safe relative path selects an actual retained operation file.

## 8. Complete action map

All actions use the existing project, stable requestId, exact expectedRevision and complete payload. The original application validates the actual source/job/plan references and permissions.

| Original action | Main payload selection |
| --- | --- |
| project.update | title, notes |
| source.retain | uploadId, title, role, optional url/notes |
| source.load | sourceId, mode, table, primaryKey/updateKey, optional previousJobId |
| plan.compile | sourceId, title, complete options |
| plan.review | planId, decision approved/changes_required, notes |
| runtime.select | Empty payload; binds the configured original runtime |
| run.prepare | planId, phase, sourceJobId/sourceSnapshotId, optional previousJobId/targetSnapshotId |
| job.start / job.cancel | jobId; cancellation reason when supplied |
| job.resume | jobId, reason |
| job.resolve | jobId, stepId, attemptId, decision, reason |
| comparison.create | Complete original jobId |
| downstream.plan | sourceId, planId, comparisonId when selected, title, edits, reason |
| downstream.apply / downstream.restore | changePlanId, reason |
| downstream.resume | operationId, reason |
| review.record | subjectId, decision, notes |
| cutover.apply | comparisonId, reason |
| cutover.rollback | Current cutoverId, reason |
| handoff.prepare | Original title/notes and selected complete revision through its native contract |
| handoff.receive | Completed uploadId; existing exact receiving project/request/revision |

Use workbench/OPERATOR.md and actual workspace source for the complete native payload contract. The Merchant action tool forwards this original payload; it does not translate it into another execution model.

## 9. Private Merchant host and 22 tools

Declare aliases in a private file. Multiple aliases may attach different explicit actors to the same original listener; they do not open additional workspace writers.

~~~json
{
  "schema":"stellar-forge.replication-workbench-host.v1",
  "workspaces":{
    "customer":{
      "label":"Customer replication operator",
      "directory":"/absolute/private/customer-replication",
      "connectionFile":"/absolute/private/replication-connection.json",
      "actorId":"replication-operator",
      "inputs":{
        "configuration":{
          "label":"Approved original Airbyte configuration",
          "file":"/absolute/private/intake/airbyte.json",
          "sha256":"REPLACE_WITH_ACTUAL_64_LOWERCASE_HEX_DIGEST",
          "bytes":12345,
          "filename":"airbyte.json",
          "mediaType":"application/json"
        }
      }
    },
    "reviewer":{
      "label":"Independent receiving reviewer",
      "directory":"/absolute/private/customer-replication",
      "connectionFile":"/absolute/private/replication-connection.json",
      "actorId":"replication-viewer"
    }
  }
}
~~~

The example byte count/digest must be replaced with the exact selected file. A host input is a predeclared original path, full SHA/length, filename and media type. The agent selects its alias and expected SHA; it cannot choose an arbitrary source path.

Initialize the original Merchant host with the installed setup export:

~~~js
import {initializeReplicationWorkbenchMerchant} from './products/replication-workbench/setup.mjs';
const host = await initializeReplicationWorkbenchMerchant({
  directory:'/absolute/private/replication-merchant',
  connection:'/absolute/private/replication-host.json',
  name:'Customer Replication operator'
});
console.log(host.configuration);
~~~

This creates the original release store, customer export directory and merchant-mcp.json with replicationWorkbenchConnection. It validates the existing provider registry. It does not start the native application. Open that configuration with the maintained Merchant stdio/HTTP host and connect the declared alias after Applications is running.

Every following tool has prefix merchant_replication_:

| Suffix | Selection/result |
| --- | --- |
| status | Declared aliases and exact input descriptors; optional workspace |
| connect | workspace and optional expectedLaunchId; authenticate original listener |
| disconnect | workspace and required launchId; close only attachment/read handles |
| browser | Original listener URL; no bearer token |
| info | Complete original actor/runtime/limits response |
| projects | Complete project list |
| project | projectId and optional original revision |
| create | requestId, title and optional notes |
| action | projectId, requestId, expectedRevision, action, full payload |
| requests | Original private request selections/outcomes, offset/limit at most 100 |
| upload_begin | uploadId, filename/mediaType, complete bytes/SHA |
| upload_status | Actual committed original offset |
| upload_chunk | uploadId/start/total/SHA and canonical Base64, at most 196,608 decoded bytes |
| upload_finish | Complete original object verification |
| upload_input | Declared sourceInput, expectedSourceSha256 and original uploadId |
| source_connections | projectId/sourceId, optional historical revision |
| consumer | projectId, original streamId, offset/limit at most 1,000 |
| artifact | Exact original selection, expectedSha256/expectedBytes and optional filename/mediaType |
| files | Retained full descriptor page, limit at most 100 |
| file | SHA-bound complete byte pages, maximum 196,608 bytes and original readId |
| file_release | Close an unfinished retained reader, keep complete saved file |
| inspect | Complete retained JSON pointer/entry page, at most 50 entries |

### Exact original request recovery

Before dispatch, create/action retain the complete input with original installation, actor and requestId. If the response is lost, inspect requests and read its originalRequest file through file/inspect. Re-send the same tool with the same project, request ID, expected revision and payload. Do not replace expectedRevision with the current head for that existing request.

There is no original request-receipt HTTP endpoint in Sling. The original application’s replay is authoritative. A POST can commit before native launch, downstream work, consumer materialization or response delivery fails. Such an error is not proof of non-commit. The host preserves the original request and reports confirmed original success separately from a local response-retention failure.

Later replay may expose current runtime/consumer metadata while the committed view/result remains historical. Preserve those identities separately. New customer intent uses a deliberately new request; network retry does not.

### Complete files and current authority

Every full JSON response is retained with byte count/SHA and a file ID. Inline views are bounded readable projections; arrays and long values return JSON pointers into that same full saved response. Follow inspect offsets or file byte pages for every member. JSON inspection is bounded at the original 32 MiB structured-response limit; larger retained artifacts remain available in full through byte-range reads, without loading a multi-gigabyte file into one JSON parse. A pointer is not a sampled substitute for the original file.

Artifact kinds are source, plan, replication, comparison, observations, handoff, downstream_plan, downstream and native. For native/downstream, supply the original job/operation id and its exact declared safe relative path. Select expected full SHA/length from the native project/descriptor, not a guessed filename. Complete v2 NDJSON, original gzip-v1, JSON, SQLite and native binary files stream into retained custody.

Current original actor/instance/role and workspace read permission are checked before every retained-file disclosure. Operator mutation/request material still requires operator. Stopping the listener leaves the saved bytes intact, but reconnect the same original application before reading them. Token rotation or authority changes do not turn a cached file into an alternate access path.

## 10. Named complete handoffs and independent receiving

New packages use tjlabs.sling-portable.v2, .ndjson and application/x-ndjson. A named download is a complete standalone file, including frozen project/history/request selections, original source, native attempt files/snapshots, results, consumer state and editable application/engine reference source.

Earlier v2 named archives are reproduced byte-exact from retained frozen headers/request selections and the complete content-addressed pool. This avoids embedding every old full archive recursively. Original gzip-v1 .ndjson.gz remains readable and its named original archive bytes remain unchanged. Trust the actual original descriptor/media type/name and complete SHA, not an extension-based conversion.

Close and reconcile original native jobs before handoff.prepare. The request selects a project prefix; the new outer handoff descriptor is naturally recorded after the package’s selected revision. Keep the descriptor alongside the full package. Do not demand that the package contain its own later outer row.

Upload a complete package and use the original handoff.receive with stable request and selected receiving project/revision. Fresh, forward, same and older receives preserve original history rules and locally retained custody. The receiving host uses its own auth/runtime; source-host jobs remain closed/suspended until explicit supported continuation.

Keep three separately identified complete deliveries: the Merchant installed product, original Sling runtime archive/ready selection, and named customer project handoffs. A runtime archive is not the customer project, and the project’s editable sources alone do not establish the receiving host’s installed executable.

## 11. Full original operating course and cold reopen

Follow RECEIVING.md and preserve the existing original operation SLING-COMPLETE-RECEIVING-0C7A-20261013 and its current accepting native owner. Original compute request is in Muse thread1791859090.091039. A source-only integration does not authorize a second native first dispatch.

The selected maintained original entry accepts:

~~~sh
/absolute/node /absolute/product/workbench/receiving/receive.mjs \
  --source /absolute/product/workbench \
  --directory /absolute/private/original-sling-operation \
  --runtime-ready /absolute/private/sling-runtime/runtime-ready.json \
  --source-manifest /absolute/product/workbench/SOURCE_MANIFEST.json \
  --python /absolute/python3 \
  --playwright /absolute/existing/playwright/index.js \
  --chromium /absolute/existing/chromium
~~~

For the same interrupted operation preserve those exact selections and add --resume. The internal original SOURCE_MANIFEST.json has 69 rows excluding itself; the original receiver excludes that exact supplied file from inventory. An external manifest instead needs all 70 original source rows. The additive original-source.json contains those 70 rows. Select one manifest once and preserve its bytes/path through the original operation.

The original course performs baseline/change replication, complete typed comparisons, original cancellation/recovery, actual consumer switch/rollback, downstream edits/restoration, all seven browser panes at desktop/mobile widths, viewer authority, full downloads, named H1/H2/H3 packages, fresh/forward/same/older receiving and cold CLI reopen. It retains its own exact request, source, runtime, ports and operation journal.

The installed extension adopts those completed original workspaces. It exercises managed Applications, both actor aliases, exact action replay, declared input transfer, complete artifacts/file pages, current authorization, observer Stop/reopen and complete independent installed product/source receiving. It must not rerun business replication merely to fill an agent demonstration.

The original CUSTOMER_RESULT.json records actual native populations, comparison, consumer selections, browser results, named packages and complete artifacts only after required closure and verification. Preserve each original result and append the integration’s actual outcomes. The completed source packet, a prepared runtime or a source parse is not that result.

For a closed workspace, the unchanged CLI can inspect it without a competing HTTP writer:

~~~sh
replication-workbench show --directory /absolute/private/customer-replication --project ORIGINAL_PROJECT_ID --revision SELECTED_REVISION
replication-workbench download --directory /absolute/private/customer-replication --project ORIGINAL_PROJECT_ID --kind handoff --id ORIGINAL_HANDOFF_ID --output /absolute/delivery/original-handoff.ndjson
replication-workbench consumer --directory /absolute/private/customer-replication --project ORIGINAL_PROJECT_ID --stream '["main","test1"]' --offset 0 --limit 1000
~~~

Stop the observer before opening this local writer; accepted native lifetimes remain their original owners. Keep the actual selected command paths, output identities and original operation record.

## 12. Installation, commercial scope and recurring value

The Installation profile replication-workbench uses the existing current Workshare-derived seed, source authority/population, customer/merchant, price/budget and receiving owner. Its complete steps cover source/runtime, reviewed plan, baseline/change native work, full comparison, consumer rollback, optional downstream work, agent use, independent receiving and actual outcome save. The profile never creates fictional payment, assignment or operated observations.

The current grant remains 400 hours, USD 38,000 and 150 days with its six packages, three tranches and four payment steps. Reusable completed source is distinct from remaining customer connector adaptation, environment setup, operator integration, acceptance/receiving and support. Each actual adaptation belongs once to its funded package or separate Workshare.

A useful recurring purchase represents one real accepted source period or requested complete customer edition with an accountable receiver. Count native settlements and completed customer tasks separately. Chunks, retries, repeated pages, formats and downloads remain within that task.

The original company offer’s USD 9,600, 15 business days, one agreed connector pair/connection, up to five tables, specified complete comparison volume and one consumer transition remain that separate proposal. Registration does not accept or change those terms. Select real customer demand, complete data access and exact adaptation scope before commissioning.

## 13. Source and acceptance authority

original-source.json lists every selected byte/SHA/Git identity, the actual successor commit and the complete original preimage provenance. workbench/OPERATOR.md, README.md, migration/OPERATING.md and actual core/native/archive source describe the unchanged implementation. This guide and additive files explain only its installed Merchant/Applications/Installation composition.

Keep private auth/configuration/source-access details outside public outputs. Retain complete editable product and original licenses. Deliver actual evidence of the full native/browser/receiving course with the exact outgoing version before declaring customer readiness.

## Maintained rendered-product instruction


The following current Merchant instruction applies to the original receiving owner and every worker contributing to the outgoing application or attachment:

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Before calling any customer/prospect-facing application, website, dashboard, demo, report, presentation or export ready, open/run/render the exact outgoing version, look at the rendered screen or its actual screenshots, and operate the important user controls. Inspect the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Code review, DOM counts, HTTP 200, unit checks and another worker's approval do not replace seeing the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk; do not run broad suites or build a verification product.

Include this complete instruction in delegated assignments and the active owner-controlled policy, boot, build and receiving guidance those workers actually read. Preserve all other owner controls and original operation identities. Leave historical records and third-party/vendor policies intact. Do not force restarts, create watchers or revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Apply the same inspection to every outgoing attachment. New videos require natural generative text-to-speech and an actual watch/listen pass.
