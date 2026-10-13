# Human Services Directory connected operator

Operate the selected native directory workspace through the maintained Merchant SDK, MCP host or command line. The directory provider includes original Gravity referral and eLTSS operations, then adds original directory acquisition, complete indexing, mapping review, service selection, explicit referral joins and editable handoffs.

The package export is `@tokenjunkielabs/starforge-merchant/merchant/human-services-directory`. Its TypeScript declarations and callable catalogue follow the installed `directory-schema.json` and `directory-source-schema.json`. The normal host discovers `human-services-directory-workspaces` from the distribution contribution.

## Select the original workspace and files

Create the directory with `human-services-directory init --workspace ABS`, receive an existing complete directory archive, or use the workspace already opened in Applications. Store the connection JSON in a private directory with owner-only file permissions. Paths may be absolute or relative to this connection file.

```json
{
  "schema": "stellar-forge.human-services-directory-merchant-connection.v1",
  "workspaces": {
    "provider": {
      "directory": "/absolute/private/directory-workspace",
      "label": "Provider service directory",
      "allowStart": false,
      "inputs": {
        "directory-snapshot": {
          "file": "/absolute/original/provider-directory.zip",
          "label": "Original directory archive"
        }
      },
      "credentialsFile": "/absolute/private/authentication-profiles.json"
    }
  }
}
```

`allowStart: false` selects an operator already running in Applications or through `serve`. A persistent SDK or MCP owner can set `allowStart: true` and call `operator_open`; the original connection lifecycle then owns that native process. Closing a borrowed connection leaves its application running. The optional `credentialsFile` references existing named authentication profiles. Omit it for an unauthenticated source.

Each declared input is a complete original host file. Add its `sha256` when a previously reviewed identity is available. Configuration loading records its exact byte identity and rejects a changed declared digest. The selected workspace UUID is read from its native private marker; it is never supplied as an arbitrary alias.

## Local SDK operation

```js
import {
  openHumanServicesDirectoryLocalClient,
  importHumanServicesDirectorySource,
  readHumanServicesDirectoryValue,
  downloadHumanServicesDirectoryExport
} from '@tokenjunkielabs/starforge-merchant/merchant/human-services-directory';

const client = await openHumanServicesDirectoryLocalClient({
  connection: '/absolute/private/directory-connection.json',
  exportsDirectory: '/absolute/private/retained-exports'
});
try {
  const imported = await importHumanServicesDirectorySource({
    client, workspace: 'provider', input: 'directory-snapshot',
    profile: {
      label: 'Original provider directory', format: 'hsds-csv-zip',
      origin: 'operator_source', scope: 'snapshot',
      filename: 'provider-directory.zip'
    }
  });
  const sourceId = imported.source.id;
  let offset = 0;
  do {
    const result = await client.call('directory_source_rows', {
      workspace: 'provider', sourceId, offset, limit: 250
    });
    const page = await readHumanServicesDirectoryValue({
      client, workspace: 'provider', result
    });
    // Process every row in page.rows, preserving sourceId and recordId.
    offset = page.nextOffset;
  } while (offset !== null);

  const packet = await client.call('directory_workspace_packet', {workspace: 'provider'});
  await downloadHumanServicesDirectoryExport({
    client, workspace: 'provider', exportId: packet.exportId,
    directory: '/absolute/private/received-directory'
  });
} finally {
  await client.close();
}
```

The import helper first saves the complete native import profile, then streams the original input to that profile's content endpoint. It returns `importProfileId`, the complete profile and source operation descriptors, and the original source record. If the upload reply is interrupted, retain the saved profile ID from the error and resume against that same profile. Source records keep the original filename separately from the content identity.

Every action also has its camel-case convenience method, such as `directorySourceRows(args)`. `client.call` accepts the catalogue action or its full `merchant_human_services_directory_` tool name.

## Merchant MCP and CLI

Initialize the maintained Merchant host configuration from the original connection:

```sh
starforge merchant-human-services-directory init \
  --directory /absolute/private/directory-merchant \
  --connection /absolute/private/directory-connection.json \
  --name 'Human Services Directory operator'

starforge merchant-human-services-directory tools

starforge merchant-human-services-directory call \
  --connection /absolute/private/directory-connection.json \
  --exports /absolute/private/retained-exports \
  --action directory_source_rows --args /absolute/private/source-page.json
```

The generated `merchant-mcp.json` selects `humanServicesDirectoryConnection`, the existing native release store, and the retained customer export directory. Start it using the repository's normal Merchant host. A remote SDK client uses `openHumanServicesDirectoryMerchantClient({url, tokenEnv, environment})`. The CLI accepts `--url MCP_URL --token-env ENV_NAME` in place of local connection and exports options. Keep the access token in the named environment variable.

`call` reads its complete argument object from the selected JSON file. For the example above:

```json
{
  "workspace": "provider",
  "sourceId": "REPLACE_WITH_ORIGINAL_SOURCE_SHA256",
  "offset": 0,
  "limit": 250
}
```

Use `value` for the retained original response, `inspect` for its complete manifest, `download` for every original file, and `reopen` for the already received directory:

```sh
starforge merchant-human-services-directory download \
  --connection /absolute/private/directory-connection.json \
  --exports /absolute/private/retained-exports \
  --workspace provider --export-id ORIGINAL_EXPORT_SHA256 \
  --directory /absolute/private/received-directory

starforge merchant-human-services-directory reopen \
  --workspace provider --export-id ORIGINAL_EXPORT_SHA256 \
  --directory /absolute/private/received-directory
```

The complete manifest is `human-services-directory-manifest.json`. Downloads retain the original file lengths and SHA-256 values, use resumable file reads, and verify existing bytes before continuing. Reopening a completed download is independent of the transient MCP port.

## Directory actions

| Work | Catalogue actions | Result |
| --- | --- | --- |
| Inspect the selected workspace | `directory_state`, `directory_catalogue`, `directory_guidance` | Original full-family state, native schemas and source guidance |
| Read complete saved records | `directory_records`, `directory_record` | Paginated collection and exact immutable record |
| Save and inspect a provider | `directory_connection_save`, `directory_discover`, `directory_request_save` | Selected connection, captured discovery and explicit request |
| Run the original acquisition | `directory_acquire`, `directory_operation`, `directory_advance`, `directory_pause`, `directory_resume`, `directory_capture_source` | Same retained operation ID, received pages and complete capture |
| Import original bytes | `directory_import_profile_save`, `directory_source_import` | Saved full profile and streamed original source |
| Browse original source records | `directory_source_rows`, `directory_source_row`, `directory_source_members`, `directory_source_file`, `directory_source_record_file` | Full rows, original member inventory and exact files |
| Review an edition | `directory_edition_save`, `directory_edition_rows`, `directory_edition_row`, `directory_edition_links`, `directory_link_targets` | All selected records and original relationship candidates |
| Compare editions | `directory_compare`, `directory_comparison_changes`, `directory_comparison_changes_file` | Complete original change decisions and JSONL |
| Receive the whole index | `directory_index_file` | Complete source, edition or comparison SQLite file |
| Review and apply mapping | `directory_mapping_save`, `directory_mapping_preview`, `directory_mapping_preview_details`, `directory_mapping_apply` | Explicit source rules, complete preview resources/fields/findings and saved conversion |
| Choose a service | `directory_selection_save`, `directory_selection_candidates` | Retained criteria, schedule decisions, candidates and operator dispositions |
| Bind a clinical referral | `directory_referral_join` | Explicit original Task/ServiceRequest bindings and a successor edition |
| Prepare and receive a handoff | `directory_handoff_prepare`, `directory_handoff_file`, `directory_handoff_import`, `directory_receiving_save` | Complete editable handoff and receiving review |
| Prepare other complete output | `directory_export_prepare`, `directory_export_file`, `directory_guidance_file`, `directory_capture_file` | Original complete files |
| Transfer the workspace | `directory_workspace_packet`, `directory_workspace_import` | Complete directory, Gravity and inherited source workspace |

Native body actions take the named object declared by the catalogue: for example `directory_mapping_save` takes `mapping`, `directory_mapping_preview` takes `mapping_preview`, and `directory_edition_save` takes `edition`. Use those installed schemas rather than rebuilding a shortened request. `input_apply` also accepts the declared directory native body actions and the existing original Gravity/eLTSS actions.

## Complete pages and large files

Native collection, source-row, edition-row, relationship-target, comparison, mapping-preview and selection-candidate pages carry `rows`, `total`, `offset`, `limit`, `nextOffset`, `bytes` and `byteBudget`. Continue with the returned `nextOffset` until it is null. Preserve all selected query parameters while following pages. The directory state also carries per-collection `total`, `returned` and `nextOffset`; it is a current view of those collections. Use the collection pages whenever a remaining prefix is declared.

An edition link may include its first relationship candidates and `candidatesTruncated`. Follow `directory_link_targets` for every original target when that flag is set. A record's source reference is the pair `{sourceId, recordId}`; the source ID is essential when two editions contain equal record bytes.

Native source/index limits are 256 MiB, interactive page responses are 4 MiB, and native complete workspace archives support 2 GiB. The inherited connected host file transport retains its 512 MiB maximum. Use the native complete-file CLI for a larger workspace archive. A native operation does not become complete merely because one page was returned.

## Interrupted acquisition and receiving

Acquisition IDs are supplied by the caller and support letters, digits, dots, underscores, colons and hyphens under the native schema. Reuse the same operation ID and inspect `directory_operation` after an interrupted response. The native acquisition retains the original request, raw response pages, continuation URLs, headers, provider timing, completion state and capture journal. `advance`, `pause`, `resume` and `capture-source` use the existing operation.

A retained connected result records the original action, full arguments, response and original export manifest. The full receiving programme checkpoints that descriptor before validation, so a provider or storage failure remains recoverable. Reuse the same operation output and selected original files when resuming.

## Operate the complete connected programme

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/connected/RECEIVING.mjs \
  --receiving /absolute/native/OPERATED_HUMAN_SERVICES_DIRECTORY.json \
  --workspace /absolute/private/original-or-received-workspace \
  --out /absolute/private/connected-receiving
```

The native receiving JSON supplies the actual workspace UUID, original input files and exact accepted replay inputs. If those original files moved, pass `--source-files ABS_JSON` with the existing source keys mapped to their new absolute paths; their retained lengths and SHA-256 values must still match. An existing authentication profile file may be selected with `--credentials-file`.

The programme uses the maintained Merchant host, imports all declared original directory inputs, exercises all accepted native replay inputs, follows complete pages, receives complete indices and original files, receives the handoff and latest complete workspace into separate destinations, reopens the Merchant connection while keeping the original native operator, and verifies all retained downloads. It writes `OPERATED_CONNECTED_HUMAN_SERVICES_DIRECTORY.json` and its restartable `CONNECTED_JOURNEY.json`. See [the complete product receiving guide](../../../../../products/human-services-directory/RECEIVING.md).


## Directory standards assessment and review

The connected catalogue includes all four conformance writes, complete finding and row paging, exact finding reads, all declared full files, and the four immutable conformance collections. The input schemas come from the installed native catalogue.

See [Conformance](../CONFORMANCE.md) for the complete operator workflow, SDK helpers, typed arguments, native routes, review semantics and editable receiving. The same local client, normal Merchant host, retained downloader and installed Applications entry operate these records.


## Complete Operating Plans

The same provider exposes all eight native Operating Plans operations plus full catalogue, document, draft, input and basis reads. Exact schemas come from **directory-operating-plans-schema.json**, alongside the existing Directory and Conformance contracts. Existing source/acquisition operation ownership and full-file transport are unchanged.

Use **directory_operating_plan_preview** with **operating_plan_create**, review the complete response, then **directory_operating_plan_create** with the exact accepted **previewRecordId**. Save, copy and prefix-history receiving use the original OperatingPlan model and saved-head checks. Step preparation and current-registration comparison do not write native plan records.

The typed client exports **prepareHumanServicesDirectoryOperatingPlan**, **saveHumanServicesDirectoryOperatingPlan**, **readHumanServicesDirectoryOperatingPlan** and **downloadHumanServicesDirectoryOperatingPlan**. The read helper reopens the entire document, working draft, source basis and complete accepted input through the maintained original-response range reader. Its optional historical revision selects old content while retaining the full history's latest draft base. The download helper receives every native JSON, Markdown or HTML byte with the existing export manifest and resume protocol.

See [Operating Plans](../OPERATING_PLANS.md) for all thirteen action names, input keys, strict limits, native and browser/SDK/MCP receiving commands, saved-history semantics and the original-model source. Complete workspace imports carry the immutable **operatingPlans** records and their four retained files through the original Directory receiver; receiver-local import receipts retain their existing meaning.

## Complete declared relationships

The same provider now exposes the three original relationship page actions: `directory_conformance_foreign_keys`, `directory_conformance_foreign_key_candidates` and `directory_conformance_foreign_key_matches`. Their exact query schemas come from the installed conformance catalogue. Outcome, candidate and match types preserve original references and separate existence from identity resolution; every ambiguous match remains available.

Use `iterateHumanServicesDirectoryForeignKeys` with `kind: "outcomes"`, `"candidates"` or `"matches"` to receive every native page. The original conformance iterator also exposes the corresponding `foreign_keys`, `foreign_key_candidates` and `foreign_key_matches` forms. Its earlier findings and assessed-row types are preserved. Every page carries its complete retained result and original ordinal progression.

The existing conformance file action receives the four additional native kinds: `foreignKeys`, `foreignKeyCandidates`, `foreignKeyMatches` and `foreignKeyCoverage`. Earlier assessments retain their original files. The existing full download, manifest and reopening helpers preserve every byte; the connected 512 MiB file limit remains explicit alongside the native larger-file routes.

See [Complete relationship receiving](../CONFORMANCE_FOREIGN_KEY_CLIENTS.md) for typed examples, exact action/filter names, whole-file custody and the complete `operate_foreign_key_clients.mjs` command. That programme consumes an actual completed native relationship result, reads the same workspace through its browser and Merchant, and receives the browser's full editable packet into a separate customer workspace. It preserves every immutable Directory record and any existing complete OperatingPlan histories without starting another source acquisition or assessment.

## Complete returned-procedure review

The existing provider now exposes `directory_operating_return_prepare/revise/complete/apply/receive/export` with the exact native input schemas, plus `directory_operating_return_review/comparison/input/rows/file`. The immutable collection is `operatingPlanReturns`. Full details, limits, operating commands and recovery are in [OPERATING_RETURNS.md](../OPERATING_RETURNS.md).

`changeHumanServicesDirectoryOperatingReturn({client,workspace,action,input})` performs one exact action. Complete the review first and persist that native intent; apply is a separate call with the selected saved head. Preserve the accepted input on interruption. The applied-return receipt and native plan save are separate recoverable writes.

`readHumanServicesDirectoryOperatingReturn` reopens all original JSON inputs; `iterateHumanServicesDirectoryOperatingReturn` reads every contiguous original change page. The complete-file helpers validate the runtime-declared payload against its native descriptor and use the existing resumable whole-file receiver. Original model types and every native return input/record/page are exported in this package's declarations. Large native inputs use the original CLI/HTTP path; existing connected JSON limits are unchanged.

The complete native course is `operate_operating_returns.py`; its actual completed result is consumed by `operate_operating_returns_clients.mjs`, covering the real operator, SDK/MCP reopen, full original files and fresh customer workspace. Preserve the selected completed result with its exact workspacePacket.


## Complete original-row corrections

The provider now exposes the same four source-native correction actions: `directory_correction_prepare`, `directory_correction_preview`, `directory_correction_apply` and `directory_correction_export`. Their argument keys are `correction_prepare`, `correction_preview`, `correction_apply` and `correction_export`; each contains the entire corresponding input from `directory-corrections-schema.json`.

Preparation stores exact original source/row/resource/member identities and ordered lexical JSON or physical CSV edits. Preview builds complete derived sources and an immutable candidate edition/comparison. Apply explicitly accepts that exact preview and expected original edition; it does not replace a mutable head or update a publisher.

Read full records with existing `directory_record` and `directory_records` for `correctionPlans`, `correctionPreviews` or `corrections`. Use `directory_correction_rows` with collection/recordId/offset/limit for every contiguous native edit/change page. Use `directory_correction_file` with collection/recordId/fileKind for complete plan input or change/review files. Prepared exports use the existing `directory_export_file` transport.

Typed helpers keep the complete original request in error details, require exact saved identities, follow every page and verify full files against immutable native descriptors. They select the runtime-declared source.payloadFile rather than payload metadata. JSON value text remains a string throughout transport; no numeric reserialization is required.

```js
const prepared = await changeHumanServicesDirectoryCorrection({
  client, workspace, action: 'prepare', input: completeOriginalInput
});
// Review prepared.record and explicitly select it.
const preview = await changeHumanServicesDirectoryCorrection({
  client, workspace, action: 'preview', input: {planId: prepared.record.id}
});
// Review all complete files and the candidate before acceptance.
const accepted = await changeHumanServicesDirectoryCorrection({
  client, workspace, action: 'apply',
  input: {previewId: preview.record.id, expectedEditionId: prepared.record.editionId, actor}
});
```

The explicit directory_correction_ action family uses the native32MiB JSON allowance through the scoped connected transport. Unrelated action defaults remain4MiB. For large MCP inputs, use a complete host-declared input with input_apply and its original SHA. Full connected file receiving remains512MiB and native editable workspace receiving remains2GiB.

[Source corrections](../SOURCE_CORRECTIONS.md) explains the full operator and native contract. [Complete client/customer course](../CORRECTION_CLIENTS.md) receives original files, reopens Merchant, independently restores the customer workspace and exports that actual customer state.

## Complete offline customer worksheets

The same provider exposes directory_correction_worksheet_prepare/export/import/review with exact native input schemas, directory_correction_worksheet_receive for complete raw returned files, and document/rows/file reads. Immutable worksheet, intake, return and review records preserve exact original source identities and field presence. A reviewed plan is prepared without previewing or accepting it.

Use receiveHumanServicesDirectoryWorksheet with either the full intake profile or its saved importId. Host input aliases must exist before connection startup. The error details preserve the same original intake for recovery. iterateHumanServicesDirectoryWorksheet checks every contiguous native page; downloadHumanServicesDirectoryWorksheetFile receives complete original JSONL when a row exceeds4MiB. The portable package helper retains the native export and every byte.

[Complete worksheet guide](../CORRECTION_WORKSHEETS.md) lists all exact actions, limits, CLI/HTTP paths and typed semantics. [The full client course](../CORRECTION_WORKSHEET_CLIENTS.md) operates the actual offline editor, private operator, Merchant reopening and independently restored customer workspace.

## Three-way worksheet reconciliation

The exact native catalogue adds `directory_correction_worksheet_reconciliation_prepare`, `review`, `export`, `catalogue`, `rows` and `file` under the same full prefix. The typed client provides `prepareDirectoryWorksheetReconciliation`, `reviewDirectoryWorksheetReconciliation`, `getDirectoryWorksheetReconciliationRecord`, `directoryWorksheetReconciliationRows`, `directoryWorksheetReconciliationFile` and `exportDirectoryWorksheetReconciliation`.

Prepare takes a selected current edition and one original/current binding for every original worksheet row. Review takes a choice for every comparison; full-row resolutions use exactly one declared JSON or physical CSV variant. Original lexical strings remain unchanged. Pages bind immutable records, counts, contiguous next offsets and4MiB budgets. Complete comparison/decision files remain downloadable up to256MiB. File helpers verify native descriptor bytes/hash against the runtime-declared payload, then use the original complete receiver.

All three native action inputs retain the scoped32MiB limit. For large inputs use the existing declared host `input_apply` route; inline Merchant requests keep their smaller transport envelope. See [WORKSHEET_RECONCILIATION.md](../WORKSHEET_RECONCILIATION.md) and the [complete client receiving guide](../CORRECTION_WORKSHEET_RECONCILIATION_CLIENTS.md).
