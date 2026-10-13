# Staff Portal Workbench

Staff Portal Workbench connects an existing complete private staff application to Merchant, managed Applications and Installation. The operator continues to use the original portal, migration, search/analytics and editorial interfaces. The customer agent operates the same original workspace and saved requests; it does not own a replacement content model, tenant client or database.

The public package contains newly authored generic integration code, source-manifest schema and operating guidance. The actual application source, project materials, commercial inputs, native results and complete customer deliveries are supplied and retained privately. A source digest identifies bytes; it does not grant rights or permission to contact a tenant. Use the original approved source and existing account/operation owner.

## 1. What a useful customer delivery contains

Begin with the full selected content population and its source references. Retain mappings, hierarchy, owners, audiences, permissions, component configuration and original files. The migration view handles source inventory, schema/mapping, review and complete batches. The portal view handles content planning, native request compilation, full returned identities and differences. Search/analytics retains the selected native tenant/principal, query, pages and every original response. Editorial work retains the original drafts, assignments, review, publication/form workflow and explicit native identity checks.

An accepted edition includes the complete original source and state/history, source and returned objects, accountable decisions, full readable reports and an independently received editable workspace. A successful HTTP response is one observation. It is not proof that an entire selected population was captured, that a review approved it or that a customer tenant accepted a change.

The application has four original views:

| View | Purpose |
| --- | --- |
| /portal | Complete content plan, hierarchy, audiences, native batch/return and delivery |
| /migration | Full source inventory, mapping, validation, batches and returned differences |
| /insights | Original native search/analytics runs, pages, audiences, review and exports |
| /editorial | Original editorial assignments, drafts, review, form/workflow and history |

## 2. Private complete source and installed preparation

Keep the original source in a private directory outside Merchant source, the mutable workspace and connection/configuration files. Supply a separate private JSON manifest using `stellar-forge.staff-portal-workbench-source.v1`. Its only fields are `schema` and `files`; every file row has the actual relative `path`, full `bytes` and lowercase `sha256`. The shipped source-manifest.schema.json is a schema, not a ready manifest or an example source population.

Generate the manifest from the approved original complete source. Preserve every source member the original delivery implementation names, including its original guides, schemas, application assets and privately authorized supporting inputs. Do not drop private members from the original handover to make it publishable. The original edition remains private, and the reusable wrappers are distributed separately.

Applications verifies the manifest SHA and all selected source files, checks for unexpected files and unsafe paths, then verifies the actual original delivery source population in the selected Python process before it opens the writer. Generated Python cache directories do not become source members. The selected interpreter is CPython3.11 or later; preserve its invocation path, including a selected environment path.

Preparation uses the original complete private source and a selected local interpreter. Use the documented original archive identity where the preparation request requires it. It does not create a migration or contact a tenant.

```sh
starforge run staff-portal-workbench-prepare -- prepare \
  --directory /srv/private/staff-preparation \
  --python /usr/bin/python3 \
  --source /srv/private/approved-staff-source \
  --source-manifest /srv/private/source-manifest.json \
  --source-manifest-sha256 FULL_SELECTED_SHA256
```

Use the returned primary/receiving descriptors verbatim: `applicationDirectory`, `sourceManifestFile`, `sourceManifestSha256` and `python`. The preparation result schema is `stellar-forge.staff-portal-preparation.v1`, state `READY`. Preserve its complete runtime/source/portable/request identities. See PREPARING.md for the actual current export and independent receiving commands. Portable source/runtime archives remain private because they contain the selected original application.

## 3. Review and start the original application

Write one private launch file outside both the selected source and workspace. Replace all example values with actual returned preparation paths and the intended original actor. The actor is part of original request fingerprints; changing its name changes the request authority.

```json
{
  "schema": "stellar-forge.staff-portal-workbench-launch.v1",
  "directory": "/srv/private/staff-customer",
  "applicationDirectory": "/srv/private/staff-preparation/primary/application",
  "sourceManifestFile": "/srv/private/staff-preparation/.preparation/SOURCE.json",
  "sourceManifestSha256": "REPLACE_WITH_COMPLETE_PRIVATE_SOURCE_MANIFEST_SHA256",
  "connectionFile": "/srv/private/staff-control/connection.json",
  "python": "/usr/bin/python3",
  "actor": "Customer operations",
  "allowedOrigins": [],
  "insightsLocalHttp": false,
  "port": 0
}
```

The path spellings above are illustrative; do not synthesize a preparation layout. Use the actual returned descriptors. To adopt an existing original workspace registry, set optional `expectedWorkspaceId` to its exact original workspace ID. The managed host validates that selection rather than opening an accidental fresh workspace.

In Applications, select Staff Portal Workbench, choose the private configuration file, then use the maintained Review → Save → Start controls. The reviewed configuration SHA and source authority remain bound to the launch. A direct foreground invocation uses the same implementation:

```sh
starforge run staff-portal-workbench-managed -- \
  --configuration /srv/private/staff-control/launch.json
```

The startup record is `STAFF_PORTAL_WORKBENCH_READY`. Its loopback origin, launch ID, process, source and connection identities are actual observed values. Use the original private access key locally to unlock the browser. Do not copy its access key, session cookie, CSRF token or native API token into messages, screenshots, agent inputs or reports.

Applications Stop closes the selected original server and joins its original HTTP workers before releasing the original portal writer. Preserve its process/log result. A stopped observer is not a fabricated native completion. Use the original native run history to understand work that was already dispatched.

## 4. Attach the customer agent

Create a private alias configuration beside the launch file. Ordinary file inputs are full SHA-bound sources. A native connection input is a separate private token envelope; it is excluded from ordinary upload/download inputs.

```json
{
  "schema": "stellar-forge.staff-portal-host.v1",
  "workspaces": {
    "customer": {
      "label": "Customer staff portal",
      "directory": "/srv/private/staff-customer",
      "connectionFile": "/srv/private/staff-control/connection.json",
      "inputs": {
        "inventory": {
          "label": "Approved complete content inventory",
          "file": "/srv/private/customer-inputs/inventory.csv",
          "sha256": "REPLACE_WITH_COMPLETE_FILE_SHA256",
          "bytes": 12345,
          "filename": "inventory.csv",
          "mediaType": "text/csv"
        }
      },
      "nativeConnections": {}
    }
  }
}
```

The sample byte count is illustrative and must match the whole selected file. For authorized native search/analytics, a host operator may add a nativeConnections entry `{"origin":"https://tenant.example","tokenFile":"/srv/private/native-token.json"}`. The launch's allowedOrigins must also allow that exact origin. The token file is private JSON `{"schema":"stellar-forge.staff-portal-native-secret.v1","token":"PRIVATE_NATIVE_TOKEN"}`. The customer agent selects only the alias. No token is returned or placed in its durable request journal.

Initialize the normal Merchant host:

```js
import {initializeStaffPortalMerchant} from "./products/staff-portal-workbench/setup.mjs";
const host = await initializeStaffPortalMerchant({
  directory: "/srv/private/staff-merchant",
  connection: "/srv/private/staff-control/agent-workspaces.json",
  name: "Staff portal customer operator"
});
```

The provider ID is `staff-portal-workbench`, family/config `staffPortal`, and host input `staffPortalConnection`. The class `MerchantStaffPortalWorkspaces` accepts the maintained Merchant configuration, implements `call(name,args)`, `summary` and `close()`, and retains full files under the private exports directory. No additional SDK façade is required.

## 5. The25 registered tools

Every name starts with `merchant_staff_portal_`. `workspace` is the host alias; `workspaceId` is an actual original application workspace ID. They are different identifiers.

| Tools | Use |
| --- | --- |
| status, connect, disconnect, info | Discover declared installations, attach to the exact current launch, retain its source handshake and close only this attachment |
| workspaces, select, state | Read the original registry, deliberately select a workspace and retain its complete public state |
| read | Original view/preview, portal context/view/preview and insights connection reads; complete responses remain downloadable |
| create, action | Original workspace creation or exact revision-bound mutation with its stable request ID |
| upload_input, receive, operation | Upload a complete declared file, receive an uploaded workspace ZIP, or read the original stored edit/upload outcome |
| native_connection, native_connect, native_disconnect | Inspect or select the original session's explicitly allowed account/tenant; private tokens remain host inputs |
| native_start, native_capture | Select an original query/run and deliberately perform one actual provider exchange |
| artifact | Retain a full object, report, workspace, batch/member or complete private delivery |
| files, file, file_release, inspect | Discover complete retained identities, read every byte, release handles and inspect bounded JSON pointers/pages |
| requests | Reopen complete exact selected requests and original response/dispatch observations |
| browser | Open one of the original four views without disclosing its private key |

The live client retains the same original session across calls. It never silently logs in again after a launch changes, and it never repeats a native operation to repair a connection. Disconnect and explicitly reconnect to the selected new launch. Workspace selection changes deliberately clear the original native account binding.

## 6. Exact edits, upload and recovery

Read state and use its actual `workspace.id` and `workspace.revision`. An action body contains `requestId`, `expectedRevision`, `action` and the complete `payload`. The original SQLite transaction checks the request fingerprint, workspace and actor, then returns a saved response for an identical repeated request. A later workspace revision does not turn an exact saved replay into a new edit.

For an uncertain action, preserve the original request and call operation with `kind:"mutate"` and that complete request. A `COMPLETED` result includes the actual saved response; `NOT_RECORDED` means no matching response was found at that observation. The original mutation itself remains the authority for safe replay.

An upload uses the original full file SHA/bytes/name/content type, actor and request ID. The adapter first copies and verifies the entire declared source into its immutable private retention area. It then streams those same bytes to the original upload route. The operation lookup with `kind:"upload"` accepts the same request ID and exact file metadata. It must never use an access-key or native-token file as ordinary source input.

The host journal retains the full selected request before mutation and every observed HTTP response after it. `HTTP_OBSERVED` means a response arrived. An HTTP error, connection loss or local retention failure is not a statement that nothing happened. Keep the original response and native request identity; do not mint replacement business requests merely to clear uncertainty.

Workspace create and HTTP receive additionally bind their original origin header. Their saved replay may be read when the session is still at the origin or already at the resulting workspace. A different unrelated selection is rejected by the original manager. The adapter does not rewrite this identity to the current selection.

## 7. Native search and analytics

Connect only through the original allowed origin and a host-declared token input. The original application authenticates the user, retains its native identity proof in the workspace and binds subsequent calls to that workspace. Read native_connection and include its actual `nativeBinding` when starting a query.

Native start accepts the original operationId, title, kind, query, pageSize, audienceId/purpose and nativeBinding. It creates or reopens the matching original run; it does not claim any pages have been captured. Use the original state/view to inspect full run status, selected query, cooldowns and response objects.

Each native_capture selects a retained run and one distinct host request ID. The adapter saves a dispatch marker before making the original one-page exchange. Repeating that same host request returns its saved HTTP observation, or separately retained current-run evidence if the acknowledgement was lost. It never automatically sends another page request under that uncertain attempt. Inspect current status, capture count, pending native request and raw response objects. A later capture is an explicit new operation against that same original run.

Original rate-limit timestamps, partial pages, interrupted exchanges and failed parsing remain visible. Complete means the original application has observed its entire selected population under the selected native contract. Editorial native authorization also remains in the original mutation path; retained request replay must not bypass a changed native identity.

## 8. Full artifacts and independent receiving

Artifact kinds are `object`, `workspace`, `batch`, `batch_file`, `report`, `portal_batch`, `portal_batch_file`, `portal_report` and `delivery`. Reports preserve the original complete CSV/JSON/HTML format choices. Batch members preserve original file names and bytes. The artifact descriptor binds the actual returned full byte count/SHA. The adapter does not assume an export request-ID cache or claim that two dynamically produced ZIPs must have the same bytes.

A workspace ZIP and a complete delivery ZIP are different originals. HTTP receive accepts an uploaded **workspace ZIP**, verifies it with the original complete archive reader, creates a distinct received workspace and immediately selects it in this session. The original source workspace and its history remain unchanged.

A **complete delivery ZIP** contains the complete original selected source, workspace ZIP and original handover. Use the original portal delivery receiver or CLI to inspect, extract its complete source and restore its workspace. Keep this ZIP private when the original source or documents are private. Do not upload the outer delivery to the workspace-only receiver.

After receiving, compare the complete original state, history, request/upload rows and every object identity. A new receiving event advances the received workspace revision. Later customer edits remain local history; replaying the original receive returns its first receipt without erasing them. Export a complete onward delivery from the selected actual current revision, independently receive it and cold reopen it.

Retained file pages are at most196608 bytes. Continue the same read ID until the complete file has been received and verify its final expected SHA. JSON pointer inspection is limited to32MiB per saved JSON, up to50 rows per reply; all larger files remain complete byte-readable. Native outgoing JSON is8MiB, original upload1GiB, complete metadata response256MiB, and the adapter's full operating artifact capacity is1GiB+48MiB.

## 9. Original CLI and source handover

Close the managed listener before using the offline original CLI. The wrapper verifies the same private source authority and acquires the same original writer lock.

```sh
starforge run staff-portal-workbench -- \
  --configuration /srv/private/staff-control/launch.json -- list

starforge run staff-portal-workbench -- \
  --configuration /srv/private/staff-control/launch.json -- \
  package --workspace workspace_REPLACE_WITH_ACTUAL_ID \
  --out /srv/private/deliveries/staff-complete.zip
```

Use an actual original ID such as the returned `workspace-` plus its32hex characters; the placeholder above is not executable. Original commands include list/state/pages/preview, retain/apply/report/package, inspect-delivery/unpack-source/receive-delivery/receive-workspace and native. The wrapper forwards the actual original arguments and exit status; it does not override the original engine.

See RECEIVING.md for the installed course. It adopts the completed original programme and its complete private source/donor/operating archives, inspects all source and output identities, uses the four real views, saves and replays an original edit, downloads complete reports/packages, independently receives onward source/history and cold reopens both customer and agent files. It does not create a second original native migration, contact a customer tenant, or replace an existing sender.

## 10. Installation, repeat business and grant scope

Select the `staff-portal-workbench` Installation profile through the maintained Workshare/Installation workflow. Keep its actual unit price/count/budget, network/asset/recipient and spending controls in the original transaction system. This integration creates no payment claim or automatic native acceptance.

A priced unit is one agreed complete staff content/analytics/editorial delivery edition for a selected scope, source period and accountable acceptance owner. A useful later approved source period, content change or new reporting question may be a new task. Retrying the same edit, receiving the same archive, changing output format or paging a large file is still the same task.

The registered product gives the existing grant a concrete Installation → Applications → customer-agent → full-output → independent-receiving workflow. It leaves the canonical six-package,400-hour,USD38000,150-day funding programme unchanged. Private customer case amounts, schedules and source bodies are not public grant source.

Keep customer communication with its original sender. Once a human contact is positive, each subsequent outbound message requires Bryce's approval of that exact message and its attachments; an earlier approval does not authorize later follow-ups. Internal engineering and authorized cold prospecting continue under the existing owner directions.

## 11. Required actual product inspection

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949


