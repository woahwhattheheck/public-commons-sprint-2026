# GraphQL merchant workspace

This is the local browser workflow for the original SF105 SubQuery merchant.
It consumes the maintained [onboarding compiler](../onboarding/README.md) and
starts the original SF30 seller. The same original GraphQL schema, approved
queries and merchant plan feed review, export and runtime.

## Start

Use Linux with Node 22 or later and `flock` from util-linux, and install the original runtime and GraphQL dependencies
as described in the [onboarding guide](../onboarding/README.md). From the source
checkout:

```sh
node stellar/scf-starforge-20261009/sf105-subquery-graphql-merchant/workspace/server.mjs \
  --workspace /private/graphql-merchants --port 0
```

The launcher creates a private workspace if it does not exist and prints its
complete local browser URL. Open that URL in the same machine's browser. The
workspace binds `127.0.0.1`; `--port 0` chooses an available port. The URL's
private capability moves into browser session storage and is removed from the
address bar. Every private API uses that capability and the exact local origin.
Closing the browser leaves the workspace process running; Ctrl-C drains its
managed merchant, closes its release consoles and their managed merchants, and
closes the workspace. The next launch prints a new URL.

Provide backend credential environment values to the launcher process when the
original approved-queries file declares an `authorizationEnv`. The browser
edits only the environment variable name. It has no credential-value field.

## Complete an operator project

1. **Connect to the actual query service schema.** Enter its backend origin,
   exact path and optional authorization environment name, then choose **Capture
   served schema**. This calls the existing onboarding capture once, retaining
   its exact source envelope in the schema editor. For an explicitly selected
   same-host backend, check the local-development option. You can also load
   served SDL, raw introspection JSON or an existing source envelope. Inspect
   roots, argument types, defaults and searchable named types. The original
   GraphQL reference implementation validates them. Entity-only indexer SDL
   requires the actual query-service schema, as explained in the onboarding guide.
2. **Load or author approved queries.** Add an operation and choose **Edit fields
   from schema**. Select an actual object-valued query root and its nested result
   fields, add result aliases, and enter fixed arguments using GraphQL literal
   syntax. Field and argument descriptions, enum values, input-object fields
   and source defaults come from the loaded schema. **Bind an argument to a buyer
   variable** creates its compatible native declaration. Set its explicit bounds,
   required/default behavior and JSON example; Int, String, ID and Boolean use
   the original variable contract. Keep enums, lists and input-object structure
   as fixed query literals. **Apply query selection** invokes the existing full
   schema and native-variable validator and updates the canonical query JSON.
   Existing route paths, payment choices and overrides remain intact; operation
   renames and bounded examples are applied to those same routes. The raw
   guided editor retains the original
   `stellar-forge.subquery-merchant.v1` shape: fixed query, response root, named
   native handler/admission, buyer variable types and bounds, defaults, node
   cap, backend origin/path, timeout and capacity. The full original JSON is
   also editable. Use **Apply JSON to editors** after changing raw JSON.
3. **Preview the selected source operation.** Enter its intended variables and
   choose **Save and preview selected query**. The workspace applies pending
   field selections, saves the exact draft, then makes one request through the
   existing merchant handler using the server's configured backend credentials.
   Inspect its actual HTTP status, returned rows and complete JSON. **Download
   exact returned JSON** retains the original handler output, including decimal
   values represented as strings. The record includes the served-schema/source
   identity, fixed query, bound variables, response bytes and hashes. It is a
   private provider read, subject to the backend's actual access and usage terms;
   the merchant's customer payment route is configured separately below.
4. **Load or author the merchant plan.** Use the original
   `stellar-forge.subquery-merchant-plan.v1` format. Create one public POST route
   per approved operation, enter its service name and description, and provide
   public example variables and descriptions. Shared ordered payment choices
   have explicit scheme, network, asset, recipient, atomic amount and timeout.
   Existing per-route payment overrides remain in the plan; edit those complete
   declarations in its JSON view. Changing an operation name updates its route
   reference; removing an operation removes its corresponding route.
5. **Save and review.** An unfinished raw draft can be saved before its schema or
   terms are valid. Review calls the original `compileSchemaSource`,
   `inspectSchema` and `compileSubQueryMerchantPlan`; it displays exact compiled
   routes, payment alternatives and native source review. Draft changes clear
   that review. Save the reviewed contents before export.
6. **Export the current project.** The maintained `prepareSubQuerySeller`
   creates a new private package containing the original source, approved
   queries, merchant plan, exact seller-service and query files, readable review,
   original generated buyer JavaScript/TypeScript client and request examples.
   The workspace displays the actual returned file paths and launch command.
7. **Start the original merchant.** Select an export matching the current draft.
   Leave the facilitator blank to start its original challenge-only mode, or
   supply the deployment's configured HTTPS facilitator for its native mode.
   A same-host HTTP backend needs the explicit local-development checkbox.
   Status links point to the original offers and readiness endpoints. **Stop
   managed merchant** uses the original runtime's drain/close operation.

Saving and reopening a project perform no source requests. Capture and preview
each require their explicit browser action. The original buyer client performs
customer purchases with its existing authorization and recovery behavior. A
successful source preview shows the original handler's indexed-data result; a
merchant HTTP 402 shows its declared offer. Stellar settlement uses the configured
original runtime and buyer workflow.

### Reopen authoring and recover source results

The field editor reconstructs its selection from the original saved query;
there is no second query format to keep in sync. Queries with fragments,
directives or other unsupported field-editor structure remain editable in
their original JSON/text view. Opening the field editor explains when it starts
a replacement selection, and the old query changes only when that selection is
explicitly applied. Save, review and schema comparison apply pending field edits
first. Export and runtime preparation require saved canonical inputs.

The **Retained source requests and results** section lists completed previews
and started requests in this same private workspace. **Open returned result**
reads existing result bytes; it never queries the provider. Historical results
keep their original input digest and source revision after later draft edits.
Refresh the retained list after an interrupted browser connection or process.
If a complete result exists but its project reference was not saved, **Attach
completed result** attaches that exact record without another provider request.
An interrupted request without a completed result stays marked as started; a
new backend request requires a new explicit preview action.

Each preview request is assigned a create-only UUID before the original handler
runs. Complete results are atomically published and then attached through the
existing revision store. The `previews/` directory belongs in the same private
workspace backup as `projects/`, exports and deployments. It contains selected
query variables and returned provider data, so it follows the workspace's
existing private file permissions. Credential values and request authorization
headers are not part of these retained records. Source previews do not change
the existing draft input or export digest format, and existing projects reopen
with an empty preview history until a preview is explicitly requested.

## Revise a merchant as its schema and products change

The **Schema and merchant revisions** panel uses the original
[`onboarding/revisions.mjs`](../onboarding/revisions.mjs) comparison and preparation
API. It accepts the actual new served schema, including query or merchant-term
changes in the same draft. It does not modify the provider's schema.

1. Open the saved project and choose a previous merchant export. Exports from
   earlier draft contents remain valid baselines, including an earlier revised
   merchant. The workspace verifies its saved record and exact package files;
   the original bundle reader verifies the schema, queries, plan and generated
   service binding.
2. Edit or load the new schema and proposed query/plan files. **Compare current
   draft** works before saving. The original report identifies each existing
   query's validity and selected schema contract under the new schema, changes
   to approved queries and variables, and added or removed operations. It also
   shows the exact previous/candidate route, request schema, public example,
   ordered payment choices and endpoint. Global breaking and dangerous schema
   changes remain visible even when the selected products still compile.
3. Correct any candidate error and compare again. An invalid candidate can
   still be saved as unfinished work. Its report remains inspectable; complete
   route/payment comparison and revised preparation need a valid original
   compiler result. Changes to the draft or selected baseline clear the prior
   comparison. Saving the exact compared contents preserves it.
4. **Prepare revised package** after saving. The server binds this operation to
   the current project revision, selected retained export and exact comparison.
   It calls the original `prepareSubQueryRevision`, retaining its unchanged
   `merchant/`, exact `previous/` package, frozen `candidate/` inputs, and
   `revision/review.json`, `review.html`, `manifest.json` and `RUN.md`. The
   revision report is checked against the report reviewed in the browser before
   the new export is attached to the project. Previous packages stay intact.
5. Use the new export's launch command, **Copy buyer client path**, and **Buyer
   and operator files** for the original generated client, service, queries and
   review. The updated route IDs, inputs and payment terms feed the same native
   buyer and seller implementations. After runtime configuration changes, use
   the original live seller's client export for its current runtime snapshot.
6. Select the revised export and start the same original seller. If a merchant
   is already running, stop it first; revision preparation does not replace a
   running process. Reopen the project after a workspace restart to start the
   same retained export. **Open saved change report** reads and verifies the
   stored original report, including its baseline, even after further edits.
   For a subsequent revision, select the latest revised export as its baseline.

The revised package includes both original launchable merchant versions and
their buyer files. Use its `revision/RUN.md` to run the prior version when the
provider still serves the necessary schema. In the workspace, opening the prior
project revision and saving it as a new current revision makes a matching older
export selectable again. This preserves intervening history and exports.

## Saved work and recovery

Drafts live below `projects/PROJECT/` with immutable numbered versions and an
atomically updated current pointer. Complete synced bytes are published without
replacing an existing revision before that pointer moves. Save compares the expected revision, so an
older tab cannot silently replace a newer draft. History opens a retained
version; saving it appends a new revision and preserves the subsequent history.
The browser asks before discarding unsaved edits while switching projects.

Packages live below `packages/PROJECT-rREVISION-ID/`. Each export retains exact
input bytes and the original compiler output. Changing a draft leaves earlier
exports available but disables their use as the current merchant. A matching
export remains usable after restarting the workspace. Before managed startup,
the workspace checks the retained export record and the original exported file
bytes; changes require a fresh export. An unavailable export does not prevent
opening or editing its source draft.

Revised exports live under `packages/PROJECT-rREVISION-ID/revised/`. Their
retained workspace record also binds every original revision-wrapper file,
including the previous merchant and change report. Those bytes are verified
before a saved report is opened, an export is used as a baseline, or its
merchant is started. Each successive revision copies the prior merchant package,
not all earlier wrappers, so historical lineage does not recursively duplicate
the complete workspace.

## Deploy a retained merchant and operate its releases

The **Deployment and operations** panel consumes the original
[`deployment/compiler.mjs`](../deployment/compiler.mjs), the existing
[SF82 release store and console](../../sf82-seller-pilot/RELEASES.md), and the
[SF99 Linux host generator](../../sf99-merchant-deploy/README.md). The browser
uses the same original service, query, admission and payment contracts through
these destinations.

1. **Prepare deployment package.** Choose an original or revised export retained
   by this project. Earlier exports remain available for an explicit deployment
   choice. Save any draft edits first; the server uses the selected export's
   exact package, not the editable draft. Enable the local-backend option only
   when that package's actual GraphQL service uses loopback. The original
   compiler verifies and copies its merchant, binds the named original handlers,
   and prepares its OpenAPI, selections, service bindings, service and release
   review. The workspace retains all returned paths and the complete package.
2. **Stage release.** Enter an explicit release ID, label and seller port. A
   facilitator selects the original native runtime; leaving it blank keeps
   challenge-only mode. The local-facilitator checkbox permits the original
   explicitly configured loopback HTTP option. Staging calls the original
   `stageSubQueryDeployment` and stores its inspected immutable release identity.
   Each project has one private store under `release-stores/PROJECT/`, so later
   merchant versions use the same selection and rollback history. Staging does
   not select or start the release. A package has one retained staged release;
   prepare another deployment when selecting different runtime settings.
3. **Open release console.** The workspace starts the original
   `startReleaseConsole` on a private available loopback port. Its original UI
   compares the selected and candidate releases, selects through the current
   generation guard, and runs, drains, restarts or rolls back its managed seller.
   Use the exact staged release ID shown in the workspace. The console reads
   actual store selection and running-instance state. Its private URL is created
   for this workspace session and is never written into project history. Closing
   a browser tab leaves the process running. Closing the workspace drains only
   the merchants owned by its original consoles and direct runtime.
4. **Prepare host package.** Enter the target host's actual merchant ID, existing
   unprivileged account, private state directory, distinct seller and operations
   ports, and challenge/native mode. A native host requires its selected HTTPS
   facilitator. If the GraphQL service names a credential, supply the private
   environment file path; the original compiler requires it. The workspace
   never requests or copies the file's credential values. Additional original
   settings include service group, runtime executables, event delivery,
   capacity, drain time and history retention. The original compiler binds the
   selected deployment's service and handler files and generates its SF99
   installation directory.
5. **Read installation runbook.** Each retained host packet displays its actual
   merchant, public origin, service target and source installation, original
   generated files and `RUNBOOK.md`. The browser verifies the exact packet and
   reports the original host preflight separately. A private environment file
   may be provisioned after generation: the retained runbook stays accessible
   while its readiness message identifies the missing setup. Follow that runbook
   on the selected host for account permissions, environment setup, Caddy and
   systemd installation, preflight, lifecycle and recovery. Generation creates
   these files; installing services remains an explicit operator action. Keep
   the recorded source installation and private deployment directory available.
6. **Reopen and continue.** Reopen the project after a workspace restart and
   select its saved deployment. **Refresh deployment** reads the original
   packet, current release selection/runtime and host-file availability. Open
   the original console again to operate the same release store. A host packet
   whose bound source changed remains visible with its actual readiness error;
   prepare the appropriate new deployment/host packet for the changed source.

Release staging and host preparation are separate original destinations. The
host packet launches the exact retained merchant directly; it does not claim
to deploy the SF82 store's active selection. The original deployment review
records SF61's representation annotations, while preserving the approved
queries, route identity, input assertions, public example, complete ordered
payment options and handler/admission binding. Use the original generated buyer
client with the selected live seller's challenge, as described in that review.

Deployment packages live under `deployments/PROJECT-ID/packet/`. Successive
operation records are complete immutable files alongside the packet. Saving a
draft, restoring an earlier draft, or preparing a later export preserves the
project's current deployment references and all prior project versions. Package
preparation, staging and host generation each append a project revision.

If a process exits after writing a complete operation record but before moving
the project pointer, **Refresh deployment** exposes **Recover finished
operation**. Recovery verifies and attaches the existing record without
repeating its stage or host generation. If the original SF82 stage finished
before that record was written, retrying the same release ID and exact options
can adopt it only after the original inspector verifies its immutable release
and the workspace matches the precise input hashes, handler and runtime. A
different release under that ID is refused. The original console can also
inspect the retained store directly. Failed host preparation gets a new
destination on a corrected attempt, preserving the original partial inputs.

The workspace requires private regular directories (`0700`) and writes private
files (`0600`) on Unix. Input limits match the canonical exporter: schema and
queries each up to 1 MiB; plan up to 256 KiB. The workspace owns one local writer
and one managed seller. Linux holds the exclusive writer lock on the workspace
process's open descriptor; a second writer is refused. Process exit releases the
lock automatically, including an interrupted process, so reopening needs no
stale-record removal. The persistent `writer.lock` file must remain in place.
Interrupted exports leave their private partial files for inspection, matching
the original create-only exporter behavior.

## Integration API

`startWorkspace({workspace, port:0, noSignals:true})` from `server.mjs` returns
`{url, origin, token, directory, close}`. The private API supports schema
inspection, current-draft review, project save/load/history, export, evolution and managed
merchant start/stop/status, retained deployment preparation, staging, host packets
and original release-console access. The web page and API call the same maintained
compiler and original native runtime. No separate GraphQL parser, payment
implementation, scheduler or project database is introduced.

The same authenticated local API exposes:

| Endpoint | Input / result |
| --- | --- |
| `POST /api/evolution/compare` | Current project `id`, `expectedRevision`, retained `baselineExportId`, and editable `input`; returns original `review`, exact `comparisonDigest`, candidate `inputDigest`, baseline identity and valid candidate merchant review. |
| `POST /api/evolution/prepare` | Current project `id`, `expectedRevision`, `baselineExportId` and previously returned `comparisonDigest`; prepares the saved candidate and returns the updated project and complete original export. |
| `GET /api/evolution/report?id=PROJECT&exportId=EXPORT` | Verifies the retained package and returns its original saved review and baseline identity. |
| `POST /api/deployment/prepare` | Current project `id`, `expectedRevision`, retained `exportId`, optional boolean `allowLoopbackUpstream`; returns the updated project and retained deployment. |
| `GET /api/deployment?id=PROJECT&deploymentId=DEPLOYMENT` | Verifies the current retained packet and returns original inspection, release state, per-host availability and any finished operation awaiting attachment. |
| `POST /api/deployment/stage` | Current project `id`, `expectedRevision`, retained `deploymentId`, and original `options` (`id`, optional `label`, `port`, `facilitator`, `allowLocalFacilitator`); returns the updated project and inspected release binding. |
| `POST /api/deployment/console` | Current project `id`, `expectedRevision`, retained `deploymentId`; opens or reuses this project's original release console and returns its session-local `operatorUrl`. |
| `POST /api/deployment/host` | Current project `id`, `expectedRevision`, retained `deploymentId`, and original `host` settings; returns the updated project and retained generated host packet. Service and handler paths come from the deployment. |
| `GET /api/deployment/host?id=PROJECT&deploymentId=DEPLOYMENT&hostId=HOST` | Verifies the retained packet and returns its exact installation runbook, service identity and original host preflight readiness. |
| `POST /api/deployment/recover` | Current project `id`, `expectedRevision`, retained `deploymentId`; verifies and attaches an already completed next operation record. |

Export identifiers resolve only within the named project. These endpoints accept
no caller-provided package directory. A comparison that no longer matches the
current draft or baseline returns a conflict and requires a fresh comparison.
Deployment and host identifiers also resolve only within the named project.
`POST /api/save` accepts only `id`, `input` and `expectedRevision`; attachment
references are created by the original preparation actions inside the workspace.
