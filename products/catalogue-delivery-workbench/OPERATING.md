# Catalogue Delivery Workbench

Catalogue Delivery Workbench installs a complete operating path for full CSV delivery to an existing CKAN FileStore resource, customer implementation and native approval workflow. It exposes the selected original delivery, implementation and approval screens and all 34 original MCP operations through the same Store and ApprovalStore. The installed Merchant catalogue adds lifecycle, host-declared inputs, complete response/file retention and independent receiving.

The public product contains newly authored generic integration source. The authorized original application, full source authority, customer records, commercial information, original native results and service credentials are supplied privately. No private case source or source pin is embedded in this package. Preparation and managed startup verify the actual complete source selection before loading it.

## 1. What is installed and what remains authoritative

| Part | Owner and contract |
| --- | --- |
| Original delivery | Original CSV parser, Store objects, reviewed plan, package lease, upload/readback, request uncertainty, feeds and exports. |
| Original approval | Actual provider principals, source/revision checks, request/decision operation key, full native observations and review history. |
| Original implementation | Complete source editions, identifier comparison, resource bindings, accountable staff/deployment profile and customer package. |
| Installed lifecycle | Applications Review/Save/Start/Stop around the selected original HTTP application. |
| Customer agent | 49 registered tools: 34 original operations and 15 attachment, retention and implementation operations. |
| Private preparation | Complete external source authority, two independent source copies and actual local Python/import observations. |
| Receiving | Existing original native result and packages, original archive readers, useful local operation, full artifacts and cold reopening. |

The original application talks to the existing CKAN resource and approval backend. A managed listener, source copy, local row comparison or recorded browser screen does not establish remote delivery or native approval. Preserve the original provider operation and receiver rather than starting another destination to obtain a new result.

There are four installed commands: `catalogue-delivery-workbench`, `catalogue-delivery-workbench-prepare`, `catalogue-delivery-workbench-managed` and `catalogue-delivery-workbench-receive`. In an installed product use `starforge COMMAND`; in a source checkout use the corresponding complete Node module below.

## 2. Prepare the complete private source

Use [PREPARING.md](PREPARING.md) for the complete intake and portable workflow. The private authority is JSON schema `stellar-forge.catalogue-delivery-workbench-source.v1`, with `files:[{path,bytes,sha256}]`. Supply the exact SHA-256 of the authority separately. Every source leaf, safe distinct relative path and total byte count is verified. The current complete original application includes delivery, implementation, approval, all native MCP definitions, static assets and backend/bridge operating files. Do not use a filtered implementation export as the full application: its original source filter omits several backend suffixes.

```sh
node products/catalogue-delivery-workbench/prepare.mjs prepare \
  --directory /srv/private/catalogue-preparation \
  --python /usr/bin/python3.12 \
  --source /srv/private/original-catalogue \
  --source-manifest /srv/private/intake/catalogue-source.json \
  --source-manifest-sha256 ACTUAL_AUTHORITY_SHA256
```

The actual selected runtime must be CPython 3.11 or later. Use the exact returned interpreter invocation, including a selected virtual-environment path. The preparation result has schema `stellar-forge.catalogue-delivery-preparation.v1`, state `READY`, `request`, `source`, actual `runtime`, full `packageImports` and independent `primary`/`receiving` bindings. Each binding contains `applicationDirectory`, `sourceManifestFile`, `sourceManifestSha256` and `python`. The result is at `directory/.preparation/PREPARED.json`; authority is at `directory/.preparation/SOURCE.json`. Use returned paths directly.

Preparation does not open a Store, worker, native backend or browser. It imports the exact package in an isolated namespace and retains the complete command, stdout, stderr, module hashes and closed outcome. Preserve that evidence separately from an actual customer run.

```sh
node products/catalogue-delivery-workbench/prepare.mjs export \
  --directory /srv/private/catalogue-preparation --python /usr/bin/python3.12 \
  --output /srv/private/transfers/Catalogue_Private_Source.zip

node products/catalogue-delivery-workbench/prepare.mjs receive \
  --directory /srv/private/catalogue-independent-source --python /usr/bin/python3.12 \
  --archive /srv/private/transfers/Catalogue_Private_Source.zip \
  --archive-sha256 ACTUAL_COMPLETE_ARCHIVE_SHA256
```

This private source-transfer ZIP has its own exact member inventory, authority and runtime/import observations. The receiving host verifies every member and observes its own interpreter. Original operating implementation and approval packages remain separate and use their original readers.

## 3. Review and start the original application

Keep application source, business workspace, host controls, source authority and credentials separate. Create private control parents before selecting them. An existing ordinary owned workspace may be adopted; the managed launcher makes only the selected workspace private. It does not broadly change parent permissions.

Example private launch JSON (replace all paths and hashes with actual selections):

```json
{
  "schema": "stellar-forge.catalogue-delivery-workbench-launch.v1",
  "directory": "/srv/private/catalogue-workspace",
  "applicationDirectory": "/srv/private/catalogue-preparation/primary/application",
  "sourceManifestFile": "/srv/private/catalogue-preparation/.preparation/SOURCE.json",
  "sourceManifestSha256": "ACTUAL_AUTHORITY_SHA256",
  "connectionFile": "/srv/private/catalogue-control/connection.json",
  "python": "/usr/bin/python3.12",
  "actor": "catalogue-operator",
  "worker": false,
  "port": 0,
  "leaseRoot": "/srv/private/catalogue-request-journal",
  "environment": {
    "CATALOGUE_DELIVERY_TOKEN": {
      "file": "/srv/private/catalogue-secrets/delivery-token",
      "bytes": 123,
      "sha256": "ACTUAL_PRIVATE_TOKEN_FILE_SHA256"
    },
    "CATALOGUE_REVIEWER_TOKEN": {
      "file": "/srv/private/catalogue-secrets/reviewer-token",
      "bytes": 123,
      "sha256": "ACTUAL_PRIVATE_TOKEN_FILE_SHA256"
    }
  }
}
```

Token examples are descriptors, never token values. Their files contain the original raw single-line UTF-8 credential. The launcher verifies full bytes/SHA, strips surrounding whitespace once and rejects blank or embedded control/newline values. Runtime/system environment names cannot be repurposed as service credential names. Only explicitly selected credentials enter the original Store environment. Public connection/info returns environment names; token bytes, capability files and private configuration paths remain private.

`leaseRoot` is optional. When adopting an original operation that selected a shared package request journal, keep its exact existing root. It is not a service credential or a new native operation. Separate independent workspaces use their actual selected journal. Each original target keeps its own base URL, permitted download origins and explicit local-HTTP setting; the launch has no global allowed-origins override.

In Applications choose **Catalogue Delivery Workbench**, select the private configuration and Review. Inspect the resolved full source authority, Python invocation, original workspace and credential-file descriptors; Save that exact selection and Start it. Changed configuration/source requires a new deliberate review. The generated connection binds the actual launch UUID, directory inode, source authority, interpreter, actor, worker state and request journal.

For direct foreground operation:

```sh
node products/catalogue-delivery-workbench/managed.mjs \
  --configuration /srv/private/catalogue-control/launch.json
```

Open the original `/`, `/implementation` and `/approval` screens. Browser view names are `catalogue`, `implementation`, `approval`. The original local workbench token protects its HTTP requests. The adapter does not invent remote user roles: native CKAN and approval principals remain authoritative.

Starting with `worker:false` is useful for adopting completed history and reviewing a package without automatic feed advancement. Enabling the original worker is an explicit operational choice: existing enabled feeds and jobs can advance. Applications Stop drains the actual listener, handlers, accepted original work and worker before releasing its writer. Stop is not proof that a previously dispatched remote service request had no effect; inspect the retained original job/operation.

## 4. Declare a customer-agent attachment

Host configuration schema is `stellar-forge.catalogue-delivery-host.v1`. Aliases select complete original workspaces and generated connections. Inputs are immutable files; producer paths are deliberate mutable feed sources. Targets and credentials are host declarations, so remote agent arguments cannot substitute arbitrary file paths, service tokens or destination endpoints.

```json
{
  "schema": "stellar-forge.catalogue-delivery-host.v1",
  "workspaces": {
    "primary": {
      "label": "Current catalogue delivery",
      "directory": "/srv/private/catalogue-workspace",
      "connectionFile": "/srv/private/catalogue-control/connection.json",
      "inputs": {
        "edition": {
          "label": "Complete approved CSV edition",
          "file": "/srv/private/intake/catalogue.csv",
          "sha256": "ACTUAL_COMPLETE_CSV_SHA256",
          "bytes": 12345,
          "filename": "catalogue.csv",
          "mediaType": "text/csv"
        },
        "implementation": {
          "file": "/srv/private/intake/implementation.json",
          "sha256": "ACTUAL_COMPLETE_PROFILE_SHA256",
          "bytes": 1234,
          "filename": "implementation.json",
          "mediaType": "application/json"
        }
      },
      "producers": {
        "scheduled": {
          "csvPath": "/srv/private/producer/catalogue.csv",
          "candidatePath": "/srv/private/producer/candidate.json",
          "datasetPath": "/srv/private/producer/dataset.json"
        }
      },
      "credentials": {
        "delivery": {"environment": "CATALOGUE_DELIVERY_TOKEN"},
        "reviewer": {"environment": "CATALOGUE_REVIEWER_TOKEN"}
      },
      "targets": {
        "catalogue": {
          "credential": "delivery",
          "config": {
            "base_url": "https://catalogue.example",
            "package_id": "existing-package",
            "resource_id": "existing-resource",
            "name": "Existing FileStore resource"
          }
        }
      },
      "destinations": {
        "independent": {"directory": "/srv/private/received/catalogue-edition"}
      }
    }
  }
}
```

The example uses placeholders and is not an executable source selection. Optional maps may be empty. Credential aliases resolve only to environment names explicitly declared by the currently authenticated managed host. Ordinary inputs and producer paths cannot select host configuration, connections, private capabilities or declared credential files across any configured alias.

Initialize the actual maintained Merchant host:

```js
import {initializeCatalogueDeliveryMerchant}
  from './products/catalogue-delivery-workbench/setup.mjs';

const installed = await initializeCatalogueDeliveryMerchant({
  directory: '/srv/private/catalogue-agent',
  connection: '/srv/private/catalogue-control/agent-workspaces.json',
  name: 'Catalogue delivery operator'
});
console.log(installed.configuration);
```

The `connection` option selects the alias configuration, not the generated listener connection. The setup writes a private maintained Merchant configuration with `catalogueDeliveryConnection`, release store and customer exports. It validates the real provider through `readMerchantConfig`; it does not start the application. Run the normal `merchant-mcp` or `merchant-mcp-stdio` command against that configuration using the maintained host CLI. The provider family is `catalogueDelivery`.

Programmatic callers may instantiate `MerchantCatalogueDeliveryWorkspaces(config)` using the normalized maintained Merchant config. It exposes `call(name,args)`, the `summary` getter and `close()`. The client/export surface is self-contained; no parallel native MCP engine is introduced.

## 5. Registered tools and complete results

Every tool uses a declared `workspace` alias except an unscoped `connections` listing. Mutating original operations add a host `requestId` selecting their exact complete installed intent. Original approval `request_id` remains separate and retains its original meaning. Original field names such as `record_id`, `expected_revision` and `operation_id` remain unchanged.

| Tool | Actual operation |
| --- | --- |
| `merchant_catalogue_status` | Read the original delivery counts, jobs, worker and accepted process activity. |
| `merchant_catalogue_records` | Page complete original collection membership; retain and follow its native cursor. |
| `merchant_catalogue_inspect` | Retain the complete original source, target, plan, job or feed and its native links. |
| `merchant_catalogue_import_source` | Retain exact host-declared full CSV and optional original candidate/dataset inputs, then call the original parser. |
| `merchant_catalogue_read_rows` | Read complete CSV cells through the original reader; follow next_offset and use the full artifact for any oversized row. |
| `merchant_catalogue_add_target` | Inspect the host-declared existing CKAN package/resource using its declared environment token reference. |
| `merchant_catalogue_create_plan` | Read actual destination bytes/metadata and retain the original reviewed baseline and explicit text fields. |
| `merchant_catalogue_queue_delivery` | Approve the selected original plan; its ID is the durable native job ID. |
| `merchant_catalogue_advance_delivery` | Advance the original durable delivery and retain its accepted activity separately from its actual result. |
| `merchant_catalogue_reconcile_delivery` | Read actual destination bytes and metadata for the original job without sending a provider write. |
| `merchant_catalogue_retry_delivery` | Explicit same-job retry only after the operator has established the previous provider request ended; first reconcile uncertainty. |
| `merchant_catalogue_pause_delivery` | Pause between requests or resume the same original job; never imply cancellation of an in-flight provider request. |
| `merchant_catalogue_accept_metadata` | Accept reviewed unrelated metadata changes through the original full readback and package lease. |
| `merchant_catalogue_confirm_request_finished` | Record the operator's actual confirmation that the earlier provider request ended. This is not an automatic timeout recovery. |
| `merchant_catalogue_configure_feed` | Save the complete original recurring contract using declared producer paths; enabled=true authorizes this original feed. |
| `merchant_catalogue_replace_feed` | Replace the original full feed contract, retaining its native replacement journal and applicable current job. |
| `merchant_catalogue_set_feed_enabled` | Enable or pause the exact saved original feed; preserve its original history. |
| `merchant_catalogue_tick` | Advance due original feeds and jobs once. An accepted activity is distinct from a finished provider result. |
| `merchant_catalogue_export_delivery` | Export the original full job, plan, CSV and producer manifests. Preserve the selected filename and earlier exports. |
| `merchant_catalogue_artifact_info` | Read the original artifact URI's full digest, byte count, media type and filename. |
| `merchant_catalogue_download_chunk` | Read a full native artifact range with original full-file/chunk hashes. Native maximum is 262144 bytes. |
| `merchant_catalogue_approval_status` | Read actual review counts and eligible completed original deliveries. |
| `merchant_catalogue_approval_records` | Page original profiles, reviews, provider operations or edition observations. |
| `merchant_catalogue_approval_inspect` | Retain the complete original review/operation and its source, native decision and history links. |
| `merchant_catalogue_approval_add_profile` | Bind the declared credential reference to the actual authenticated principal at the retained target. |
| `merchant_catalogue_approval_track` | Track one completed delivery and independently reread the exact native edition before retaining its review. |
| `merchant_catalogue_approval_refresh` | Refresh the same native review, source bytes and principal; retain the new local revision for a later decision. |
| `merchant_catalogue_approval_save_notes` | Save notes with the currently inspected original local revision. |
| `merchant_catalogue_approval_request` | Request review through the original contributor principal. Keep native request_id and complete body unchanged on recovery. |
| `merchant_catalogue_approval_decide` | Approve or reject through actual native reviewer permissions and edition/revision checks. Approval can publish the dataset. |
| `merchant_catalogue_approval_reconcile` | Read the original saved provider operation and current complete edition after an uncertain response. |
| `merchant_catalogue_approval_retry` | Explicitly replay the same original provider operation key after its saved outcome has been inspected. |
| `merchant_catalogue_approval_export` | Export the original complete review source, delivery, observations, native operations and notes. Each original export remains distinct. |
| `merchant_catalogue_approval_restore` | Restore the exact declared complete approval ZIP into a fresh declared destination through the original receiver. |
| `merchant_catalogue_connections` | List host-declared aliases and closed source descriptors; no live listener required. |
| `merchant_catalogue_connect` | Attach to the selected launch and validate its private authority. |
| `merchant_catalogue_disconnect` | Drain this agent client and release its byte readers, leaving the application owner intact. |
| `merchant_catalogue_info` | Read live installation, worker and source identity, plus environment names only. |
| `merchant_catalogue_catalogue` | Retain all 34 original native tool definitions and resource templates. |
| `merchant_catalogue_browser` | Open catalogue, implementation or approval view on the selected original listener. |
| `merchant_catalogue_artifact` | Stream and retain a whole original URI or returned HTTP artifact. |
| `merchant_catalogue_files` | Page complete retained-file descriptors. |
| `merchant_catalogue_file` | Read SHA-bound bytes, up to 196,608 per call, through the same readId. |
| `merchant_catalogue_file_release` | Close the selected immutable byte reader. |
| `merchant_catalogue_file_inspect` | Page full entries of a retained JSON pointer; bytes remain fully downloadable. |
| `merchant_catalogue_requests` | Page full selected intents, dispatch markers and original HTTP observations. |
| `merchant_catalogue_implementation_read` | Read template/list/get/deployment, or inspect a declared original profile. |
| `merchant_catalogue_implementation_action` | Prepare/plan/queue/adopt-job/bind-target/advance/receiving/feeds/export using original payloads. |
| `merchant_catalogue_implementation_receive` | Receive a declared full native implementation ZIP into a separately declared destination. |

Original native record identifiers remain 24 lowercase hexadecimal characters. Host aliases use lowercase letters, digits, underscore and hyphen. Original rows are strings: long identifiers, leading zeroes, empty strings and complete CSV cells must not be coerced to numbers. Native read_rows returns its actual offset, next_offset, total_rows and complete flag; a large row stays available in the full original file.

The manager's response has full-file metadata, `fileRead`, `originalStatus`, `ok`/`status` where applicable and a bounded `value` projection. Arrays or large nested values expose JSON pointers rather than silent truncation. Use `file_inspect` to page complete entries or `file` through EOF for the exact original HTTP bytes. An inline projection is never the complete native result unless its full descriptor proves it.

Original JSON writes retain the 8 MiB native bound. Native CSV/file inputs remain subject to the original 2 GiB limit and original archive-reader limits. Installed full-file retention permits up to 4 GiB for complete archives including metadata; this does not enlarge the original reader's admission limits. Retained reads are at most 196,608 bytes per call; original native download_chunk supports up to 262,144. JSON inspection has its own 32 MiB limit. Larger files remain byte-readable.

Captured input copies preserve the declared original basename in a stable private hash-selected directory. Reuse verifies full SHA/count. This keeps the original Store's recorded CSV filename instead of substituting a cache filename. Complete input bytes remain immutable even if the external producer changes later.

## 6. Delivery, uncertainty and native review

Import the complete declared CSV and candidate/dataset metadata, then inspect its original source record and full rows. Add the existing target through its host alias; this performs actual native inspection. Create a plan using the selected source, target and explicit text fields. Review the complete baseline, protected metadata, full difference and original source identity before queueing. Queue reuses the plan ID as the job ID.

Advance or reconcile the original job and read its actual state. An accepted background activity is not a completed upload/readback. After uncertainty, reconcile actual destination bytes and metadata first. `retry_delivery` and `confirm_request_finished` are explicit operator assertions about the prior provider request; do not use a timeout as that proof. Pause affects future original steps and cannot erase an in-flight remote request.

A feed records a whole approved producer contract: target, paths, fields, selected columns, schedule, row/drop bounds and enabled state. Replacing it retains the original replacement history and applicable current job. A distinct source edition can create useful recurring work; retries, chunk reads and transport copies do not create new customer outputs or billable editions.

Approval starts from a completed original delivery. Register the actual contributor/reviewer profile with a declared credential reference, track that job and refresh its complete source/native/principal observation. Save notes with the current local revision. Request review or decide using both the original `request_id` and host `requestId`, selected profile, exact notes and expected revision. Native permission and changed-source/revision checks remain enforced. Approval may publish a dataset; only the actual authorized reviewer chooses it.

The original approval bridge journals each provider operation key and complete body. `approval_reconcile` reads that saved operation; `approval_retry` explicitly resends the same original operation key where the native journal supports it. An APPLIED operation is reused. Never create a new provider request simply because a response was lost.

## 7. Exact host request recovery

The complete installed intent and any declared source are retained before dispatch. The host records a create-only dispatch marker, then preserves the complete original HTTP response, including errors. A full response remains retained if the application closes immediately afterward. Later file access reauthorizes the original workspace/source against the current connection.

`HTTP_OBSERVED` means an actual HTTP exchange was recorded, not that the business operation succeeded. A 400,409 or500 can follow partial original effects. Inspect its full response and original state. Replaying an already observed host request returns its complete retained observation without redispatch. If concurrent exact calls observed both failure and success, the existing complete success is preferred; all observations remain, and content-hash sorting is not described as chronology.

When dispatch has no observed response, only source-native replay families are automatically eligible: identical source import, the same plan queue, original approval request/decision/retry, and content-bound implementation preparation. Other requests return `DISPATCH_UNCERTAIN` with the exact retained intent. Inspect the original job/review/implementation or use its explicit reconciliation action before selecting another operation. This preserves the original outcome instead of assigning generic idempotence to all HTTP routes.

An implementation or approval export remains its own native artifact. Original approval restore requires a fresh destination. The host journal preserves an observed receive result after later edits; it does not rewrite an existing destination to imitate first receiving. A listener restart requires explicit reconnect to its actual new launch; no native mutation is silently replayed to reauthenticate.

## 8. Customer implementation and full onward delivery

Use the original implementation template, then declare the complete profile privately. It retains customer/staff/deployment responsibility, resource bindings, producer editions, selected columns and identifier columns. Inspect complete sources and identifier comparisons before preparing the original implementation. Plan, queue, adopt a completed job or bind a target only through the original action and revision contract. Original receiving acceptance and feed activation remain explicit reviewed actions.

Download the entire original implementation package. It contains the complete selected CSV editions, supplied manifests, original Store records, resource/profile bindings, comparisons, job/readback history and filtered application source. Keep the separately transferred full private application source alongside it. Native approval exports carry each review's complete source, delivery, principal references, observations, operations and notes; they are separate packages and are not implicitly inside the implementation ZIP.

The installed `implementation_receive` calls the unchanged original reader into a host-declared independent destination and holds its actual destination workspace lock. Original approval_restore similarly receives its complete graph into a fresh declared destination. Neither reader starts a feed or provider action. Select a new managed launch and host alias for the received workspace; do not silently switch the existing writer or overwrite the donor.

Use [RECEIVING.md](RECEIVING.md) for the complete original-result and installed course. It preserves the original implementation ZIP and both selected native approval phases/archives, checks actual contributor/reviewer identities and APPLIED operation/event evidence, and joins complete unchanged base records with both original review graphs. Local notes and their revision/history change remain separate from prior native decisions. The course uses the actual three interfaces and registered agent, downloads full artifacts, exports onward, independently receives and cold reopens complete source/history. It must receive actual native results, not convert a local data-only result into proof of an authentic destination run.

## 9. Original CLI and lifecycle

The generic wrapper delegates to the actual selected original module with the reviewed workspace, Python and source. Choose `--engine catalogue`, `approval` or `implementation`. Keep original arguments after `--`:

```sh
node products/catalogue-delivery-workbench/cli.mjs \
  --configuration /srv/private/catalogue-control/launch.json \
  --engine catalogue -- status

node products/catalogue-delivery-workbench/cli.mjs \
  --configuration /srv/private/catalogue-control/launch.json \
  --engine implementation -- list
```

Use the original engine's `--help` to select exact action flags. The configuration owns the workspace; the wrapper rejects overriding or abbreviated workspace flags. Managed Applications owns long-lived serve/worker operation. Do not start an independent CLI writer while that workspace is managed. The original kernel lock and actual child close define ownership, including failure; preserved logs are not substitutes for confirmed closure.

## 10. Installation, commerce and source handover

The profile `catalogue-delivery-workbench` joins the existing Installation workorder, Workshare and acceptance process. Select the actual customer, complete population, source/operating periods, delivery/approval owners, hosting and maintenance responsibility, priced unit and receiving criteria. Use original integer atomic price/count/budget, payment, assignment and withdrawal machinery. This application does not change payment policy or turn attempts into purchases.

A useful baseline or recurring edition includes complete source, reviewed mapping/metadata, actual native delivery, approval where agreed, full artifacts and an independently usable received workspace. Missing native evidence remains missing. Preserve prior editions and unresolved differences. An approved new source period or changed population may be a linked task; replaying the same result or moving it to another host remains that task.

Keep public wrapper source and privately supplied original application inventories separate. Deliver every selected source member and original archive in authorized private custody. Do not put credential values, capability files, launch files or raw customer communications into agent outputs or public source. Existing authorized private Slack/Pages/file handover remains available; this boundary creates no new approval queue.

Every positive/warm human contact and each subsequent outgoing message requires Bryce's approval of that exact message and attachments. Preserve the original sender. Internal engineering and authorized cold work remain under their current instructions.

## 11. Actual outgoing product inspection

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949


