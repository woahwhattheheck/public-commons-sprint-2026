# Gravity referral connected workspaces

This module exposes the complete source-owned Gravity referral operator through the existing Merchant MCP host, a local command, and a typed JavaScript client. Its **115 actions** include all 77 inherited eLTSS operations and 38 Gravity operations. The operator continues to own source intake, exact resource identities, graph resolution, source-selected reviews, conditional exchange and editable receiving.

The native operator, browser and connected client use the same workspace. A Merchant connection borrows an operator already opened by Applications or the native CLI. An explicitly allowed persistent owner may start the normal native command. Closing Merchant drains its calls and file readers; a borrowed operator remains available to its original owner.

## Installed entry points

| Capability | Original entry point |
| --- | --- |
| Native browser, source operations and HTTP API | `starforge gravity-referrals`; [native API](../HTTP_API.md) |
| Connected command | `starforge merchant-gravity-referrals` |
| Merchant provider | `gravity-referral-workspaces` |
| Merchant configuration input | `gravityReferralsConnection` |
| Provider family | `gravityReferrals` |
| MCP action prefix | `merchant_gravity_referral_` |
| Typed client | [client.mjs](client.mjs), with [client.d.mts](client.d.mts) |
| Complete original operating journey | [RECEIVING.mjs](RECEIVING.mjs) |
| Native input schemas | [referral-schema.json](../referral-schema.json) |
| Native source, graph and file implementation | The existing [eLTSS workspace](../../fhir_eltss/README.md) and its connected runtime |

The installed selection includes the maintained Merchant host, release store and original dataset receiving dependencies. The connected contribution is `gravity-referrals-connected`; the separate native contribution is `gravity-referrals`. The product's Applications provider and installed receiving driver use these same identities.

### Private workspace and connection identities

| Identity | Literal |
| --- | --- |
| Native marker schema | `stellar-forge.eltss-workspace.v1` |
| Native UUID file | `eltss/identity.json` |
| Active operator descriptor | `referral/operator-connection.json` |
| Operator descriptor schema | `stellar-forge.gravity-referral-operator-connection.v1` |
| Native startup schema | `stellar-forge.gravity-referral-startup.v1` |
| Host connection schema | `stellar-forge.gravity-referral-merchant-connection.v1` |
| Referral state subtree | `state.referral`, schema `stellar-forge.gravity-referral.v1` |
| Complete retained export | `stellar-forge.gravity-referral-merchant-export.v1` |
| Retained manifest filename | `gravity-referral-manifest.json` |

The descriptor contains the current native workspace UUID, instance ID, process ID and local access token. The connected owner verifies the original marker and active HTTP identity before a call. Credentials and the live descriptor stay in the private host configuration; receiving uses the source-owned native archive.

## Connect an existing private workspace

Create the original workspace with the native command, or select the workspace already opened by Applications. Start its private operator with the native `serve` command. Use the actual workspace UUID returned by the native `status` command if selecting `--expected-workspace-id`.

~~~sh
starforge gravity-referrals init --workspace /absolute/referral-workspace
starforge gravity-referrals serve --workspace /absolute/referral-workspace --port 0
~~~

The command emits its actual startup URL and identity. A separately selected provider credentials file uses the native `--credentials-file` option. Python selection follows `SF30_REFERRAL_PYTHON` and the maintained XML runtime fallback; the installed source launcher uses the actual Node executable.

Create a private connection JSON file. Every workspace and input file is selected by the host:

~~~json
{
  "schema": "stellar-forge.gravity-referral-merchant-connection.v1",
  "workspaces": {
    "operator": {
      "directory": "/absolute/referral-workspace",
      "label": "Selected referral programme",
      "allowStart": false,
      "inputs": {
        "review": {
          "file": "/absolute/complete-reviewed-input.json",
          "label": "Complete selected requirement and field review"
        },
        "examples": {
          "file": "/absolute/original-published-examples.zip",
          "label": "Complete original published example archive"
        }
      }
    }
  }
}
~~~

The paths above are operator selections. Read `workspaces` to inspect the actual UUIDs, labels, byte counts and SHA-256 identities returned for the selected files. To pin an input before execution, put its actual SHA-256 in the input's optional `sha256` field and repeat it as `expectedSha256` on the operation. The native browser upload flow remains available independently.

Keep the connection file private. Local command access reads this file and writes retained output only to its explicitly selected `--exports` directory:

~~~sh
starforge merchant-gravity-referrals tools
starforge merchant-gravity-referrals call \
  --connection /absolute/gravity-connections.json \
  --exports /absolute/connected-exports \
  --action state \
  --args /absolute/state-arguments.json
~~~

The corresponding argument file contains the host alias:

~~~json
{"workspace":"operator"}
~~~

The one-shot local command releases its connection when it exits. Use a running native browser/Applications operator for repeated one-shot calls. A persistent SDK or Merchant host can call `operator_open` and own the normal native serve process when `allowStart` is true.

## Use the maintained Merchant MCP host

Initialize one private Merchant configuration from the exact connection file:

~~~sh
starforge merchant-gravity-referrals init \
  --directory /absolute/gravity-merchant \
  --connection /absolute/gravity-connections.json \
  --name "Selected referral programme"
~~~

The result supplies the actual `configuration` path. Initialization uses the original native release store, records its chosen completed store, and creates the ordinary Merchant configuration with `gravityReferralsConnection`. Repeating the same setup receives its existing source selections.

Open that configuration through the maintained Merchant host. A host already configured for other source-owned providers can add `gravityReferralsConnection` while preserving its other settings. The provider registry loads the connected source directly.

MCP clients call full names such as:

~~~text
merchant_gravity_referral_state
merchant_gravity_referral_referral_catalogue
merchant_gravity_referral_referral_review_save
merchant_gravity_referral_referral_exchange_advance
merchant_gravity_referral_receive_export
~~~

The local and typed clients accept the shorter action names too. The doubled word in `merchant_gravity_referral_referral_review_save` is intentional: the provider prefix is fixed, and the domain action retains its native `referral_` name.

For an existing MCP endpoint:

~~~sh
starforge merchant-gravity-referrals call \
  --url http://127.0.0.1:SELECTED_PORT/mcp \
  --token-env SELECTED_MCP_TOKEN \
  --action referral_state \
  --args /absolute/state-arguments.json
~~~

Select the actual URL and token environment variable emitted or configured by the original host. The command uses the original Merchant authentication and retained-file protocol.

## Typed client and complete results

The client offers camel-case methods for every declared action and a typed `call` method. Input declarations come from the native 16-schema catalogue. The inherited 77-action declarations remain imported from the original eLTSS client.

~~~js
import {
  openGravityReferralMerchantClient,
  readGravityReferralValue,
  downloadGravityReferralExport
} from "./client.mjs";

const client = await openGravityReferralMerchantClient({
  url: process.env.SELECTED_MERCHANT_URL,
  tokenEnv: "SELECTED_MCP_TOKEN",
  environment: process.env
});

try {
  const retained = await client.referralState({ workspace: "operator" });
  const state = await readGravityReferralValue({ client, result: retained });

  const selected = state.assessments.find(row => row.id === process.env.SELECTED_ASSESSMENT_ID);
  if (!selected) throw new Error("Select an assessment returned by this original workspace.");

  const exported = await client.referralAssessmentFile({
    workspace: "operator",
    assessmentId: selected.id
  });

  await downloadGravityReferralExport({
    client,
    workspace: "operator",
    exportId: exported.exportId,
    expectedManifestSha256: exported.manifestSha256,
    directory: process.env.SELECTED_COMPLETE_OUTPUT
  });
} finally {
  await client.close();
}
~~~

`readGravityReferralValue` retrieves the complete immutable response through native file ranges. A small MCP preview may report the number of elements and a JSON pointer; it is a view of the same retained response. For large source/assessment/archive files, use complete-file download.

A successful original read or write returns:

- Its actual native status and operation identifiers.
- A retained export ID and manifest SHA-256.
- The complete unchanged native response or original file payload.
- `original-request.json` with the original action, route and arguments.
- `original-input.json` when `input_apply` used a complete host-declared JSON file.
- `original-artifact.json` when receiving a native delivery artifact.

A result with `retention.state="FAILED"` retains its actual native status and recovery details. Recover the original record or operation after restoring storage before repeating a write. The result's native outcome and file-retention outcome remain separate fields.

## Complete action coverage

### Inherited source, eLTSS and dataset operations

All 77 original actions are present under the Gravity prefix. Their input contracts remain the maintained eLTSS contracts, with two additive changes: `input_apply` accepts the 14 new Gravity body actions, and `receive_export` accepts `kind="referral-handoff"`.

| Area | Actions |
| --- | --- |
| Connected ownership and files | `workspaces`, `schema`, `operator_open`, `operator_release`, `operator`, `manifest`, `file`, `file_release`, `json`, `input_apply`, `receive_export` |
| Native configuration and source acquisition | `state`, `catalogue`, `auth_profiles`, `connection_save`, `connection`, `discover`, `discovery`, `request_save`, `request`, `request_advance`, `operation`, `operation_pause`, `operation_resume` |
| Complete source receiving | `source_import`, `source`, `source_members`, `source_rows`, `source_row`, `source_file`, `source_packet` |
| Original reference graph | `graph_create`, `graph`, `graph_nodes`, `graph_edges`, `graph_node` |
| Original eLTSS domain | Native profile, edition, review, assessment, decision, correction, comparison, handoff and receiving actions remain available with their original names |
| Native datasets and customer receiving | `mapping_default`, `mapping_preview`, `plan_save`, `plan`, `build_create`, `build`, `build_query`, `build_dataset`, `build_packet`, `comparison_create`, `comparison_changes`, `comparison_file`, `packet_import` |
| Original artifacts and editable receiving | `artifact_import`, `artifact_file`, `handoff_import`, `workspace_packet`, `workspace_import` |

Run `tools` or read `schema` for the complete literal metadata, required arguments and bounds. In Gravity, both inherited `workspace_packet`/`workspace_import` and the explicit referral workspace actions select its complete native-plus-referral archive.

### Gravity source and record reads

| Action | Exact selection |
| --- | --- |
| `referral_catalogue` | Complete native catalogue, input schemas, limits and source profile |
| `referral_state` | All native referral collection descriptors |
| `referral_profile` | Complete original profile, all 57 requirements and 24 field definitions |
| `referral_guidance` | Complete original guidance index with member paths, sizes and hashes |
| `referral_guidance_packet` | Entire unchanged original guidance JSON envelope |
| `referral_guidance_file` | `member` from that exact original index |
| `referral_records` | `collection`, optional `query`, `offset` and `limit` |
| `referral_record` | `collection` and exact `recordId` |

The native collections are `configurations`, `editions`, `reviews`, `assessments`, `decisions`, `comparisons`, `correctionPreviews`, `corrections`, `exchangeRequests`, `exchangeOperations`, `monitoring`, `handoffs`, `receivings` and `receives`.

State descriptors intentionally omit large saved bodies. Open the original record for its complete requirements, field mappings, request, original source context or frozen handoff files.

### Gravity body operations

Each action below accepts `workspace` and the one named complete body. `input_apply` can receive that same body from a declared host input without fitting it into a small MCP envelope.

| Action | Body key | Native schema |
| --- | --- | --- |
| `referral_configuration_save` | `configuration` | `configuration` |
| `referral_edition_save` | `edition` | `edition` |
| `referral_review_profile` | `profile` | `profileAdoption` |
| `referral_review_save` | `review` | `review` |
| `referral_assessment_create` | `assessment` | `assessment` |
| `referral_decision_save` | `decision` | `decision` |
| `referral_edition_comparison_create` | `comparison` | `comparison` |
| `referral_correction_preview` | `correction` | `correctionPreview` |
| `referral_correction_apply` | `apply` | `correctionApply` |
| `referral_exchange_request_save` | `request` | `exchangeRequest` |
| `referral_monitoring_prepare` | `monitoring` | `monitoring` |
| `referral_handoff_prepare` | `handoff` | `handoff` |
| `referral_receiving_save` | `receiving` | `receiving` |
| `referral_export_prepare` | `selection` | `export` |

The saved request body is explicit. Configurations retain topology, actor/server roles, selected source version, actual host role and monitoring policy. Editions retain the original Task record IDs, source, graph policy and configuration. Reviews contain all 57 requirement rows and all 24 field rows; each row keeps its authored disposition, source references, owner, target mapping and receiving link.

### Assessment and comparison pages

`referral_assessment_tasks`, `referral_assessment_findings`, `referral_assessment_cells` and `referral_assessment_decisions` take the saved `assessmentId`. Optional selectors are `taskId`, `query`, `offset` and `limit`.

A page is:

~~~text
{ rows, total, offset, nextOffset, pageBytes }
~~~

Follow the returned `nextOffset` until it is null. The interactive byte budget can shorten a page before its requested row count. `referral_assessment_file` returns the complete original JSON with the same Tasks, findings, cells, decisions, source IDs and frozen `asOf`.

`referral_edition_changes` and `referral_edition_changes_file` use the original `comparisonId`. Resource identity, reviewed links and exact original JSON values determine the native comparison. This remains separate from the native dataset comparison, which compares every mapped dataset cell.

### Native conditional exchange and monitoring

| Action | Purpose |
| --- | --- |
| `referral_exchange_advance` | Advance the exact saved `requestId` with its original `operationId` |
| `referral_exchange_operation` | Read that actual mutable operation after progress or an unknown response |
| `referral_exchange_operation_file` | Receive complete unchanged `operation.json` |
| `referral_exchange_operation_packet` | Receive its complete original request, response bodies, headers and history |
| `referral_monitoring_prepare` | Prepare native acquisition from actual endpoint discovery and the selected monitoring policy |

The native exchange uses the original selected endpoint and actor role. A conditional PUT retains its actual source preimage, reviewed body and selected ETag. Native readback runs before a repeated write. Keep `requestId`, `requestSha256`, `operationId` and the original response state together; a timeout is a reason to read that operation.

The request retains actual capabilities and role/consent decisions. Task status, status reason, business status and returned outcome resources stay distinct. Task.for permits Patient, RelatedPerson or Group, while ServiceRequest.subject permits Patient, Group or Location in the selected profiles. The native review preserves their actual relationship.

Search monitoring and instance history use their source-declared parameters. Current capability declarations use `_lastUpdated` for the selected search. Instance history uses its native `_since` and actual history-instance capability. The native engine preserves pagination, source bytes and original acquisition operation IDs.

### Whole files and receiving

| Action | Result |
| --- | --- |
| `referral_handoff_packet` | Frozen complete referral handoff, including original native workspace and referral registry |
| `referral_workspace_packet` | Current complete editable native-plus-referral workspace |
| `referral_workspace_import` | Receive a declared full workspace input |
| `referral_handoff_import` | Receive a declared full referral handoff input |
| `referral_published_examples_import` | Receive the complete original published example ZIP with explicitly reviewed source metadata |
| `referral_export_prepare` | Retain a native workspace, handoff, assessment, comparison or exchange-operation artifact |

Published-example intake takes `selection={label,actor,note?,publicationUrl,referenceBase}`. It retains every original archive/member byte and the explicitly selected reference-base assignments. Its response is:

~~~text
{
  source,
  archiveSha256,
  resourceDocuments,
  referenceAssignments: [
    { member, sha256, resourceType, logicalId, reviewedFullUrl }
  ]
}
~~~

`resourceDocuments` counts the original resource members placed into the reviewed collection. The source inventory also indexes nested resources, so its resource count can differ. Preserve each original count and its meaning.

## Original filenames and full-file handling

A declared file route streams every successful original response, including `application/json`. Source JSON, assessment JSON, original exchange JSON and JSON delivery artifacts keep file results and their native kind.

For source and guidance members, the connected export retains the original selected basename when it fits the maintained portable filename contract. A name containing path controls, unsupported characters or reserved connected metadata names uses the existing safe delivery name; the complete original member path remains in `original-request.json`. All bytes and hashes remain those of the selected original.

Download, inspect and reopen the complete export:

~~~sh
starforge merchant-gravity-referrals download \
  --connection /absolute/gravity-connections.json \
  --exports /absolute/connected-exports \
  --workspace operator \
  --export-id ACTUAL_EXPORT_SHA256 \
  --manifest-sha256 ACTUAL_MANIFEST_SHA256 \
  --directory /absolute/received-export

starforge merchant-gravity-referrals reopen \
  --workspace operator \
  --export-id ACTUAL_EXPORT_SHA256 \
  --manifest-sha256 ACTUAL_MANIFEST_SHA256 \
  --directory /absolute/received-export
~~~

The receiver resumes its existing saved prefix, verifies the original manifest, checks every complete file and preserves the file-read identity. Its binding uses the native workspace UUID and host alias, so a Merchant port change does not change the original export. Local `reopen` verifies the saved bytes without another server.

Full native packets support the maintained 512 MiB bound. Native interactive input supports 4 MiB; complete native JSON response custody supports 64 MiB. Source intake retains the original source engine's 256 MiB bound. Large handoffs use the direct packet route rather than the smaller native artifact store.

## Receive into the correct native destination

`receive_export` takes:

~~~text
{
  workspace: destinationAlias,
  sourceWorkspace: originalAlias,
  exportId: originalExportId,
  expectedManifestSha256: originalManifestSha256,
  kind: source | packet | handoff | artifact | workspace | referral-handoff,
  label?: selectedLabel
}
~~~

The exact retained kind selects the actual native route. Dataset customer packets, original source packets and artifacts can compose in a customer workspace. **Complete Gravity handoffs and complete editable Gravity workspaces each require a fresh destination.**

A Gravity archive contains an inner native workspace archive and its outer referral registry and custody. The outer archive hash belongs to `state.referral.receives`. The inherited `state.receives` describes the inner archive. Reconciliation uses the matching outer record and native UUID, including a response lost after import.

A completed receive adopts the original workspace UUID and returns the actual archive SHA-256 and reconstructed state. Repeating the same original archive receives that existing result. A partial receive resumes its own complete archive; the native receiver verifies all declared members and retained objects before completion.

Save an actual receiving record after the receiver has reopened the selected handoff. Use the receiver's original operation/archive ID, actual destination object or retained result artifact, observed time and original source references. Authored acknowledgements and observations remain separate from the original source's clinical values.

## Complete original receiving operation

`RECEIVING.mjs` consumes the **unchanged completed** `OPERATED_GRAVITY_REFERRAL.json` from the native source operation:

~~~text
schema: stellar-forge.gravity-referral-operated.v1
operation: SCF-GRAVITY-REFERRAL-WORKSPACE-450E-20261012
~~~

It retains the native result's complete bytes and SHA-256, original UUID, all source/configuration/edition/review/assessment/decision/correction/comparison/build/handoff IDs, native acquisition and exchange IDs, and exact published example/definition identities.

Run against that existing workspace:

~~~sh
node fhir_referral/connected/RECEIVING.mjs \
  --receiving /absolute/OPERATED_GRAVITY_REFERRAL.json \
  --out /absolute/gravity-connected-receiving \
  --playwright /absolute/playwright/index.mjs \
  --chromium /absolute/chromium
~~~

For an explicitly restored copy on another equipped host, preserve the original result file unchanged and select the receiving paths:

~~~sh
node fhir_referral/connected/RECEIVING.mjs \
  --receiving /absolute/unchanged/OPERATED_GRAVITY_REFERRAL.json \
  --workspace /absolute/restored-original-workspace \
  --original-examples /absolute/unchanged/Gravity_Original_Examples.zip \
  --original-definitions /absolute/unchanged/Gravity_Original_Definitions.zip \
  --out /absolute/gravity-connected-receiving \
  --playwright /absolute/playwright/index.mjs \
  --chromium /absolute/chromium
~~~

Use `--credentials-file ABS` only when the selected native operator needs that existing private provider profile. The receiver uses saved source bytes and reads original operations. A saved conditional exchange is advanced only when its original state is already complete, through the native same-operation branch.

Node 22 or newer, Python, the full selected source closure and an existing Playwright/Chromium runtime are required. The receiver uses the maintained Merchant host and SDK dependencies; it installs no runtime packages. Its native child uses `SF30_REFERRAL_PYTHON` or the maintained runtime selection.

### Four-workspace journey

| Workspace | Actual operation |
| --- | --- |
| `original` | Reopen the complete source operation; receive all records/files; retain the connected full review, assessment, delivery artifact, handoff and actual receiving observation |
| `customer` | Receive the unchanged published examples and definitions, original source packet, native dataset customer packet and complete artifacts |
| `handed` | Receive the complete frozen Gravity handoff in a fresh native workspace and adopt the original UUID |
| `restored` | Receive the complete current editable archive in a fresh native workspace and adopt the same UUID |

The driver performs the following connected journey on the actual native application:

1. Verify the unchanged original result, workspace UUID, source identities and every installed connected action.
2. Read the whole installed guidance envelope, all 57 requirements, all 24 field definitions and usable original guidance files.
3. Page every original source resource, receive each complete source packet and verify selected raw JSON/context/archive members.
4. Read every saved native referral collection, original graph nodes/edges and selected Task resources.
5. Read every native assessment through all four paginated views and its complete file; compare the exact source values and field pairs.
6. Replay the already-saved correction preview and exact apply hash, and receive each complete comparison.
7. Receive original selected discovery and operation history, including complete conditional exchange custody and saved monitoring operations.
8. Send the entire original selected review through `input_apply`, retain its exact input bytes, and create the complete connected assessment at the original saved `asOf`.
9. Receive the assessment as a real JSON delivery artifact, run the original native mapping/query/cursor/dataset comparison, and download its customer packet.
10. Receive complete original published ZIPs and explicit reference assignments; verify the same original resource values in the customer workspace.
11. Freeze and receive a complete handoff; reopen all selected Tasks, all 24 cells per Task and the original native dataset.
12. Record the actual receiver's archive operation and destination, then freeze and receive the complete editable workspace.
13. Close and reopen Merchant while the same native browser remains usable; run the rendered queue/dataset/receiving views and actual native query.
14. Reopen every downloaded manifest and complete file after Merchant restart, drain owned resources and preserve the completed result.

The original native and browser workflow remain the same application. The connected browser leg uses read-only navigation and native query controls around the Merchant lifecycle; source/domain mutations go through the declared connected actions.

### Outputs and continuation

The complete output is `OPERATED_CONNECTED_GRAVITY_REFERRAL.json`. It contains the original result binding, selected source files, original and connected IDs, actual Task/field counts, operator/Merchant lifecycle, full export and download manifests, receiving results and browser query observations.

The output directory also includes:

- `CONNECTED_JOURNEY.json` with exact input arguments, request order, attempts, saved complete response identities and completion state.
- Complete original call/input JSON, source/guidance/assessment/comparison/operation files and every exported archive.
- `CONNECTED_CATALOGUE.json` and full original/reopened state files.
- Three browser images covering the original operator, the operator while Merchant is closed, and the same operator after Merchant reopens.
- The separate editable customer, handoff and restored directories.
- Complete-file download state, including a deliberately paused and then resumed original guidance-file prefix.

Continue with the same command, same unchanged native result, same selected workspace and same output directory. The operation lease prevents two receivers from mutating that destination concurrently. Saved write envelopes retain their original arguments and stable journal sequence. A resumed source edition is recorded without rewriting an earlier source edition or completed native output.

The completed result is written after browser/native readback and owned resource release. Preserve that result, the journey and the complete received archives together so another operator can reopen the same original content.

## Source and implementation references

- [HL7 SDOH Clinical Care Implementation Guide, published3.0.0](https://hl7.org/fhir/us/sdoh-clinicalcare/STU3/): original profiles, capability declarations, examples and workflow semantics retained by the native source bundle.
- [Original implementation-guide source](https://github.com/HL7/fhir-sdoh-clinicalcare): full source members are retained in `gravity-source.json` with their original identities.
- [Native Gravity HTTP contract](../HTTP_API.md), [typed native input catalogue](../referral-schema.json), and [source-selected review profile](../referral-profile.json).
- [Original eLTSS connected implementation](../../fhir_eltss/connected/README.md): source/graph/dataset/file operations reused by the three optional composition seams.
- [Provider](provider.mjs), [runtime](runtime.mjs), [connection](connection.mjs), [client](client.mjs) and [whole receiving operation](RECEIVING.mjs).

The implementation is MIT-licensed source. Original HL7 source, examples and notices retain their own source attribution in the native source envelope and the installed native product.
