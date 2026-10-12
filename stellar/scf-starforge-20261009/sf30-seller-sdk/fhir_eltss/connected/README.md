# Connected eLTSS care-plan operations

This companion connects the original eLTSS workbench to the maintained merchant MCP host, a typed JavaScript client, and the installed `starforge merchant-eltss-careplans` command. An operator can use Applications, the browser, and connected tools on the same native workspace.

The complete surface includes source-selected Bundle, CarePlan operation and REST graph acquisition; original reference graphs; all 56 published mapping fields; saved reviews and assessments; scoped decisions; reviewed correction; original dataset projection and query; customer handoff; observed receiving; and full editable restoration. The native Python workbench remains the owner of these records and provider requests.

The implementation lives beside the native product in `fhir_eltss/connected/`. Read the [native operator guide](../README.md), [HTTP API](../HTTP_API.md), [field and source catalogue](../catalogue.json), and [original source notice](../SOURCE_NOTICE.md) with this guide.

## Installed routes and original ownership

| Route | Entry |
| --- | --- |
| Native CLI and browser | `starforge eltss-careplans` |
| Applications entry | `eltss-careplans` |
| Connected CLI | `starforge merchant-eltss-careplans` |
| Merchant provider | `eltss-careplan-workspaces` |
| Merchant configuration input | `eltssConnection` |
| Connected tool prefix | `merchant_eltss_` |
| Typed client export | `./merchant/eltss-careplans` |
| Setup export | `./merchant/eltss-careplans/setup` |
| Provider export | `./merchant/eltss-careplans/provider` |

The original merchant provider registry loads this contribution through the normal installed distribution. Its existing HTTP authentication, configuration reader, request admission, retained-file protocol, and shutdown behavior apply.

The native server publishes a private `eltss/operator-connection.json` in its own workspace. The connected adapter reads that descriptor, verifies the original workspace marker and UUID, and authenticates `GET /api/operator` before it sends a native action. The descriptor binds the workspace, process, instance, URL and token. The native full workspace archive excludes this live descriptor and credential configuration.

An already-running Applications or native browser server is borrowed. Closing the merchant host or local connected client releases that borrowed connection. A persistent connected client may explicitly call `operator_open` when the host has selected `allowStart: true`; that starts the original `eltss-careplans serve` process. Its owning client closes and drains that process on release. These two ownership states are returned by the operator tools.

## Prepare a private connection

Initialize or receive each target with the original native command first. Select a real directory and keep the original workspace UUID returned by that command.

For local use with an existing server:

~~~sh
starforge eltss-careplans serve \
  --workspace /private/careplans/current \
  --expected-workspace-id RETURNED_WORKSPACE_UUID \
  --port 0
~~~

The native command prints its actual startup URL and connection file. Applications can open the same directory through its normal saved configuration and lifecycle.

Create the following private host file. The paths below are placeholders for complete original files and initialized workspaces on that host.

~~~json
{
  "schema": "stellar-forge.eltss-merchant-connection.v1",
  "workspaces": {
    "current": {
      "directory": "/private/careplans/current",
      "label": "Selected care-plan workspace",
      "allowStart": false,
      "inputs": {
        "published_bundle": {
          "file": "/private/source/Bundle.json",
          "sha256": "COMPLETE_FILE_SHA256",
          "label": "Original published Bundle"
        },
        "complete_review": {
          "file": "/private/review/field-review.json",
          "sha256": "COMPLETE_FILE_SHA256",
          "label": "Complete reviewed field selection"
        }
      }
    },
    "receiving": {
      "directory": "/private/careplans/receiving",
      "label": "Selected editable receiving workspace",
      "allowStart": true
    }
  }
}
~~~

Protect this file and the containing directory:

~~~sh
chmod 700 /private/careplans
chmod 600 /private/careplans/connections.json
~~~

Use the actual paths that contain the file. The adapter verifies ownership and private modes on its configuration, workspaces and live descriptor. All paths resolve against the configuration directory when relative. Symlink aliases are rejected.

Each workspace has these host-controlled fields:

| Field | Meaning |
| --- | --- |
| `directory` | Existing original eLTSS workspace, including its native identity |
| `label` | Operator name for this exact directory |
| `allowStart` | Whether `operator_open` may own the normal native server |
| `credentialsFile` | Optional private native provider credential file used when this adapter starts the server |
| `inputs` | Selected complete local files addressable by aliases |

There are at most 32 configured workspaces and 64 input aliases per workspace. Each input has `file`, optional `sha256`, and optional `label`. Configuration loading hashes the entire original file. A subsequent mutation first copies that same selected file into a private stable spool and checks its complete identity.

Provider credentials stay in the native credential file. A tool call chooses a declared workspace or input alias; it does not supply arbitrary host paths or replace the server token.

## Local connected commands

The local client uses the same runtime and full-file records without opening another MCP listener. These commands borrow an operator already opened by Applications or the native CLI:

~~~sh
starforge merchant-eltss-careplans tools

starforge merchant-eltss-careplans call \
  --connection /private/careplans/connections.json \
  --exports /private/careplans/connected-exports \
  --action state \
  --args /private/careplans/state-args.json
~~~

The state argument file is:

~~~json
{"workspace":"current"}
~~~

The result identifies the complete native response, retained export and manifest hash. The small response contains either the whole value or a description of its larger fields. Read the full retained JSON using the returned identifiers:

~~~sh
starforge merchant-eltss-careplans value \
  --connection /private/careplans/connections.json \
  --exports /private/careplans/connected-exports \
  --workspace current \
  --export-id RETURNED_EXPORT_ID \
  --manifest-sha256 RETURNED_MANIFEST_SHA256
~~~

A local one-shot command closes its client when it exits. Use Applications or the native CLI to keep an operator open between these calls. A long-lived JavaScript client can explicitly own `operator_open` and release it after its complete workflow.

## Use the original merchant MCP host

Initialize the ordinary merchant configuration and its selected original release store:

~~~sh
starforge merchant-eltss-careplans init \
  --directory /private/merchant/careplans \
  --connection /private/careplans/connections.json \
  --name "Care-plan operations"
~~~

This returns the exact `merchant-mcp.json` path. Repeating initialization with the same directory and reviewed inputs reuses the completed selection. Keep that directory and its setup record when recovering an interrupted initialization.

Start the existing host with the returned configuration:

~~~sh
starforge merchant-mcp serve \
  --config /private/merchant/careplans/merchant-mcp.json \
  --port 3211 \
  --token-env MCP_ACCESS_TOKEN
~~~

The token is supplied by the existing host environment. The normal server prints its actual endpoint. Use that endpoint for connected calls:

~~~sh
starforge merchant-eltss-careplans call \
  --url http://127.0.0.1:3211/mcp \
  --token-env MCP_ACCESS_TOKEN \
  --action state \
  --args /private/careplans/state-args.json
~~~

The installed host exposes all 77 `merchant_eltss_` tools. Both the short action name and full tool name work in the connected client. Read `schema` for the exact tool arguments and `catalogue` for the original native record schemas.

## Complete operation catalogue

All actions except `workspaces` and `schema` take a configured `workspace` alias. Save actions receive a complete named native body, such as `review`, `assessment`, `decision` or `handoff`. The typed client declares those bodies directly; the original native validator determines their clinical and source semantics.

| Workflow | Actions |
| --- | --- |
| Connection and ownership | `workspaces`, `schema`, `operator_open`, `operator_release`, `operator`, `state`, `catalogue`, `auth_profiles` |
| Endpoint and acquisition | `connection`, `connection_save`, `discover`, `discovery`, `request`, `request_save`, `request_advance`, `operation`, `operation_pause`, `operation_resume` |
| Complete original sources | `source`, `source_members`, `source_rows`, `source_row`, `source_file`, `source_packet`, `source_import` |
| Original reference graph | `graph_create`, `graph`, `graph_nodes`, `graph_edges`, `graph_node` |
| Published fields and review | `profile`, `edition`, `edition_save`, `review_profile`, `review_save`, `review_set`, `assessment_create`, `assessment`, `assessment_cells`, `assessment_file` |
| Decisions and correction | `decision`, `decision_save`, `edition_comparison_create`, `edition_comparison`, `edition_changes`, `edition_changes_file`, `correction_preview`, `correction_apply` |
| Handoff and receiving | `handoff_prepare`, `handoff`, `handoff_packet`, `handoff_import`, `artifact_import`, `artifact_file`, `receiving`, `receiving_save` |
| Native datasets and query | `mapping_default`, `mapping_preview`, `plan`, `plan_save`, `build`, `build_create`, `build_query`, `build_dataset`, `build_packet`, `comparison_create`, `comparison_changes`, `comparison_file` |
| Complete input and editable transfer | `workspace_packet`, `workspace_import`, `packet_import`, `input_apply`, `receive_export` |
| Retained result files | `manifest`, `file`, `file_release`, `json` |

Native source, graph, edition, review, assessment, decision, correction, plan and build identities are returned SHA-256 content IDs. A CarePlan selection uses its original resource `recordId` from the chosen graph. It is distinct from the FHIR resource's lexical `id`, `fullUrl` and business identifiers; those original fields remain available in the full source record.

Acquisition uses the exact saved `requestId` and an operator-retained `operationId`. Native operation tokens contain 1–96 permitted characters. Keep the same token through advance, pause, resume and response recovery.

The original source pages expose `rows`, `total`, `offset`, `nextOffset`, `pageBytes` and `pageByteBudget`. Follow the returned `nextOffset`. A page can contain fewer rows than the requested limit because complete original rows have different byte sizes. Large original resource content remains available through its complete source member.

### Source-selected acquisition

Choose a saved native connection and retain its actual CapabilityStatement with `discover`. The native request chooses one of its supported source routes: an original Bundle URL, an explicitly selected CarePlan instance operation, or the original REST graph route.

The published STU2 `$all-eltss-careplan` definition is a draft experimental CarePlan instance operation. An endpoint's actual advertisement and selected request determine whether that operation is used. The native eLTSS acquisition owns GETs, page links, source identity, reference scope, authentication and `Retry-After`. See the [native API](../HTTP_API.md) and [source notice](../SOURCE_NOTICE.md) for the preserved operation and profile sources.

A connected action does one native advance. Read the returned operation before another advance and use the native `notBefore` value when provided. Existing paused and interrupted operations reopen by their original token.

### Field review and original correction

A profile supplies all 56 published field definitions with source locators and explicit default review drafts. Saving a review keeps each selected field's status, applicability, selectors and conversions. Assessment evaluates that saved review against the selected original edition; each observation remains bound to its field and CarePlan identities.

Use the complete response from `review_set`, `assessment` and `assessment_cells` when making another decision. Full cell files are retained by `assessment_file`.

Correction is a two-step native operation:

1. Submit the exact reviewed `editionId`, patches, actor and reason to `correction_preview`.
2. Read the original preview and apply its returned `previewId` with `expectedRequestSha256`.

The native correction creates a successor source and preserves the predecessor. Replaying the same preview and application returns their original identities. Source/edition comparison and native dataset comparison have separate full changes files.

## Complete JSON inputs beyond a small tool envelope

MCP arguments are capped at 256 KiB by the original provider admission. The native interactive JSON limit is 4 MiB. A full field review or another complete native body can use the selected host-file route:

~~~json
{
  "workspace": "current",
  "input": "complete_review",
  "expectedSha256": "COMPLETE_FILE_SHA256",
  "action": "review_save"
}
~~~

Send this to `input_apply`. The file itself contains the native review body, without an outer `review` wrapper. The adapter validates the declared action and JSON object, then posts the original UTF-8 file unchanged to that action's native route. It retains `original-input.json` alongside the complete native response and original request.

Supported native input actions are:

`connection_save`, `request_save`, `edition_save`, `review_profile`, `review_save`, `assessment_create`, `decision_save`, `edition_comparison_create`, `correction_preview`, `correction_apply`, `handoff_prepare`, `receiving_save`, and `plan_save`.

Fields such as clinical `valueJson` retain complete JSON text strings in the native schemas. This keeps original lexical tokens and explicit null values available to the native validator. A complete input file also preserves its whitespace and numeric tokens before the native parse.

## Typed JavaScript client

The package's `./merchant/eltss-careplans` export carries `client.d.mts` and `client.mjs`. Within this source directory the same API is available directly:

~~~javascript
import {
  openEltssMerchantClient,
  readEltssValue,
  downloadEltssExport
} from './client.mjs';

const client = await openEltssMerchantClient({
  url: process.env.CAREPLAN_MCP_URL,
  tokenEnv: 'MCP_ACCESS_TOKEN'
});

try {
  const stateResult = await client.state({workspace: 'current'});
  const state = await readEltssValue({client, result: stateResult});

  const assessmentId = state.assessments[0].id;
  const result = await client.assessmentCells({
    workspace: 'current',
    assessmentId,
    offset: 0,
    limit: 50
  });
  const firstPage = await readEltssValue({client, result});

  for (const cell of firstPage.rows) {
    console.log(cell.carePlanId, cell.fieldKey, cell.status);
  }

  const complete = await client.assessmentFile({
    workspace: 'current',
    assessmentId
  });
  await downloadEltssExport({
    client,
    workspace: 'current',
    exportId: complete.exportId,
    expectedManifestSha256: complete.manifestSha256,
    directory: '/private/receiving/complete-assessment'
  });
} finally {
  await client.close();
}
~~~

Select the actual saved assessment needed for the task. The example reads its first page and then receives the entire original assessment file.

The client exposes named camel-case methods for every catalogue action, plus `call(action, arguments, requestOptions)`. The local variant is:

~~~javascript
import {openEltssLocalClient} from './client.mjs';

const client = await openEltssLocalClient({
  connection: '/private/careplans/connections.json',
  exportsDirectory: '/private/careplans/connected-exports'
});
try {
  await client.operatorOpen({workspace: 'current'});
  const result = await client.state({workspace: 'current'});
  const state = await client.readValue({result});
  console.log(state.workspaceId);
} finally {
  await client.close();
}
~~~

The local connection's `allowStart` choice governs the explicit open. A long-lived original Applications server is borrowed; a server started by this client closes when this client releases it.

## Receive every original file

Every native result retains an `eltss-manifest.json` and complete content-addressed files. A normal JSON response contains:

- `original-response.json`: the full native response bytes.
- `original-request.json`: the original action, method, route and arguments.
- `original-input.json`: present for complete host-file native input.

A declared file route retains its complete payload with its native kind even when its media type is JSON. A raw Bundle returned by `source_packet` remains a `source-packet`; a JSON receiving artifact remains an `artifact-file`. It is not wrapped or converted into a different source format.

Artifact exports also carry `original-artifact.json` and the original name, label, content type, byte count and artifact identity. Complete file bytes are checked against their retained SHA-256 identity during receiving.

Each retained manifest names `source.payloadFile` for a file export. Receivers select that actual declared payload, independently of its filename extension. The export types include source members, complete sources, assessment cells, original resource changes, native dataset ZIPs, customer packets, handoff ZIPs, receiving artifacts and full editable workspaces.

Receive all files:

~~~sh
starforge merchant-eltss-careplans download \
  --url http://127.0.0.1:3211/mcp \
  --token-env MCP_ACCESS_TOKEN \
  --workspace current \
  --export-id RETURNED_EXPORT_ID \
  --manifest-sha256 RETURNED_MANIFEST_SHA256 \
  --directory /private/receiving/selected-export
~~~

Repeat the identical command and directory after interruption. The maintained receiver checks the manifest and every saved prefix before resuming at its exact offset. It records actual resumed bytes, complete file sizes and SHA-256 hashes.

Reopen an already-complete local delivery:

~~~sh
starforge merchant-eltss-careplans reopen \
  --workspace current \
  --export-id RETURNED_EXPORT_ID \
  --manifest-sha256 RETURNED_MANIFEST_SHA256 \
  --directory /private/receiving/selected-export
~~~

The original file identities remain valid when the merchant listener closes and reopens at another port. The receiver binds the immutable export to its native workspace UUID and alias.

### Receive into another configured workspace

`receive_export` uses an already-retained full export. Select its source alias, original export ID and manifest hash, plus an explicit native destination kind:

~~~json
{
  "workspace": "receiving",
  "sourceWorkspace": "current",
  "exportId": "RETURNED_EXPORT_ID",
  "expectedManifestSha256": "RETURNED_MANIFEST_SHA256",
  "kind": "handoff"
}
~~~

| Kind | Required retained kind | Native action |
| --- | --- | --- |
| `source` | `source-packet` | Import complete source bytes |
| `packet` | `dataset-packet` | Receive the original customer dataset packet |
| `handoff` | `handoff-packet` | Receive the selected graph, review, assessment and native dataset custody |
| `artifact` | `artifact-file` | Receive full artifact bytes and original metadata |
| `workspace` | `workspace-packet` | Restore the complete editable workspace and original UUID |

Whole-workspace import uses the native receiving transaction. A lost reply is reconciled by the original archive hash and the saved native receiving record before the adapter adopts the restored UUID. A handoff receives into the selected customer workspace while keeping that destination's own UUID.

The corresponding `source_import`, `packet_import`, `handoff_import`, `artifact_import` and `workspace_import` actions use a host-declared input alias. They share the same native routes and complete input hashing.

## Recovery and resource limits

| Surface | Native/connected bound |
| --- | --- |
| Ordinary MCP argument envelope | 256 KiB |
| Complete native JSON input | 4 MiB |
| Retained JSON response | 64 MiB |
| Complete uploaded or downloaded packet | 512 MiB |
| Complete retained export | 576 MiB across at most four files |
| Download range | At most the returned catalogue's chunk limit |
| Original source edition | Native 256 MiB, 5,000 resources and 100 CarePlans |
| Provider acquisition token | Original 1–96-character operation token |

Complete files stream in fixed-size blocks. Source/member, native archive and manifest checks retain original bytes; the workbench's source and record limits still apply.

A returned native action has two separate states: its HTTP/native result and whether the complete response was retained. Use `retention.state === "COMPLETE"` before downstream delivery. If the native write returned but export storage failed, read the original saved request, operation, content ID or archive receiving record after restoring storage, then recover that same action.

Use the exact original receiving UUID and payload after an unknown `receiving_save` response. Retain the preview ID and expected hash for correction. Keep the acquisition token on every advance, and let the native provider receipts determine the next step. These identities make response recovery part of the original operation.

The source connection and live token stay private on the host. Complete field observations, care-plan originals, artifacts, and exported workspaces retain their selected content and should be delivered to the intended receiving destination.

## Operate the complete published-source receiving journey

`RECEIVING.mjs` is a whole product operating example against the saved original native result. It runs the actual connected provider through the maintained merchant host and the actual browser on that same workspace.

First complete the native operation described in [NATIVE_RECEIVING.md](../NATIVE_RECEIVING.md). Then pass its exact `OPERATED_ELTSS.json`:

~~~sh
node connected/RECEIVING.mjs \
  --receiving /private/eltss-native/receiving/OPERATED_ELTSS.json \
  --out /private/eltss-connected-receiving \
  --playwright /absolute/existing/playwright/index.mjs \
  --chromium /absolute/existing/chrome-headless-shell
~~~

The command is relative to the original `fhir_eltss` directory. Node 22 or later, the native Python workbench, the complete installed source dependencies, and an existing Playwright/Chromium runtime are required. The optional `--credentials-file` is a private local native file path. The operating example uses the already-retained original source and performs no provider acquisition.

The genuine source is the [published STU2 Bundle](https://hl7.org/fhir/us/eltss/STU2/Bundle-2039212f3fa5406bb4ffd4a.json), preserved as 128,055 bytes with SHA-256 `b1bfe61134b7f18c8d8831b9d253f64df7d37e8bb4e457a00ab472e0aa1b4de2`. It contains 39 original resources, two CarePlans and 98 literal references. The native saved receiving result provides the actual selected source, review, correction, build, artifact and customer identifiers.

The connected journey:

1. Opens or borrows the original operator and uses its existing browser to query a native CarePlan build.
2. Reads every original resource and reference page, both CarePlans, all saved field reviews, and all 112 assessment cells for the two CarePlans.
3. Receives every complete source member, source packet, assessment file and original edition change file.
4. Replays the exact existing correction preview/application and checks their saved identities.
5. Receives a complete 56-field review from a declared JSON file, creates its native assessment and prepares a complete selected handoff.
6. Receives the unchanged published Bundle as a raw JSON source, pauses after an actually saved download prefix, and resumes that same full file.
7. Queries original native builds through real cursor pages and receives the full dataset, customer packet, handoff and JSON result artifact.
8. Records the actual completed local handoff receiving under its retained UUID.
9. Exports and restores the complete editable workspace, then reopens its source, field, dataset, decision and receiving records.
10. Closes and reopens the merchant host while the borrowed native operator and browser keep the same instance; reopens every exact file delivery.

This creates additional authored review, assessment, handoff and receiving records in the selected original workspace. Their IDs and original predecessor relationships are included in the saved result. The original native source and existing editions remain available throughout the operation.

The output directory contains:

| Output | Content |
| --- | --- |
| `OPERATED_CONNECTED_ELTSS.json` | Completed operation, source identities, native IDs and full receiving results |
| `CONNECTED_JOURNEY.json` | Original request envelopes, attempts, returned identities and continuation state |
| `CONNECTED_CATALOGUE.json` | Complete 77-action catalogue used by the operation |
| `downloads/` | Whole original payloads, request/input/artifact sidecars, manifests and resumable receiving records |
| `RECEIVED_STATES.json` | Complete observed restored and customer workspace state |
| `ORIGINAL_REOPENED.json`, `RESTORED_REOPENED.json` | Native state after merchant close/reopen |
| Three PNGs and recorded query responses | Actual same-operator browser queries before, during and after merchant reopen |
| `customer-workspace/`, `restored-workspace/` | Original editable receiving workspaces |

Reuse the same output directory and native receiving file when continuing. The journal reconciles exact retained actions and archives, preserves complete file identities, and records later source editions. The completed result is written only after full native receiving, browser operation, file reopening and owned-process cleanup.

## Source ownership

The companion uses the original native eLTSS engine, original XML/native dataset engine, SF82 release store, merchant provider registry, retained-file readers, full download receiver and existing Applications lifecycle. The code in this directory is MIT. Original HL7 material and its exact license/source notices remain in [SOURCE_NOTICE.md](../SOURCE_NOTICE.md) and the included original source files.
