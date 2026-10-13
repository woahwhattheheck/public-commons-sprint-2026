# Installation Source Desk: typed and merchant agent workflow

The existing Grant workspace client now exposes the complete native Installation Source Desk. It uses the same running Grant service, original case, Source Desk draft, source blobs, preparation engine, Installation writer and request journal as the operator interface and installed Python CLI.

The two entrypoints are:

- Typed Node client: `GrantWorkspaceClient.installationSources(action, input)`, available through the existing `./grant/agent` export.
- Merchant agent: eighteen `merchant_grant_source_desk_*` tools on the existing configured Grant workspace provider.

The helper export `./grant/installation-source-desk-agent` contains the complete native request preparation, upload and review helpers. Its TypeScript declarations describe every route, original file, draft, receipt, archive review and execution result.

## Original owner and file handling

Select the existing host-declared Grant workspace alias. The original `merchant_grant_open` operation may start a service only when its declared host binding permits it. Source Desk operations borrow the existing client and enter its ordinary admission/drain lifecycle. The existing host closes its own clients and retained file readers.

Every read keeps its complete response bytes in the existing snapshot store. Large arrays have returned JSON pointers for `merchant_grant_snapshot` and `merchant_grant_rows`; a presentation summary never substitutes for the complete original file. Download the returned immutable snapshot with `merchant_grant_file_read`, its exact SHA256 and read ID. Continue through every offset, then release that read ID with `merchant_grant_file_release`.

Original files remain subject to the native limits:

| Native resource | Complete bound |
| --- | --- |
| One uploaded original file or commissioning TAR | 8 MiB |
| Selected original draft inputs | 64 MiB |
| Retained draft input/output blobs, including history | 256 MiB |
| One source draft's editable JSON/history | 12 MiB |
| Original preparation member payload | 192 MiB |
| Case attachment | 24 MiB and 200 original sources |

A preparation ZIP contains its original manifest and ZIP framing in addition to its member payload. The agent first reads the native archive description, checks its SHA and complete size, receives exactly that size and checks the returned bytes. The transport permits up to 256 MiB for this declared archive route; ordinary JSON responses retain the existing 64 MiB bound. The host's existing file reader carries the whole original archive.

## Complete tool map

| Tool suffix | Original operation |
| --- | --- |
| `profiles` | Complete installed profiles, engine hashes, source formats and native capacities |
| `list` | Every original source draft in the selected case |
| `detail` | Complete current or historical draft edition, including files, selections, preparations, attachments and history |
| `request` | Exact original native request journal and verified saved receipt |
| `file_inspect` | Original source inspection, including an explicit phase amendment preview |
| `file` | Exact SHA-bound current or historical original source bytes |
| `preparation` | Complete original prepared cohort and output descriptors |
| `archive_describe` | Complete preparation ZIP identity and byte count |
| `archive` | Whole original preparation ZIP |
| `output` | Complete selected native prepared output |
| `commissioning_inspect` | Exact saved capture files, project identities and current Installation candidates |
| `commissioning_preview` | Reviewed project-to-Installation and explicit milestone-to-phase mapping |
| `archive_inspect` | Complete TAR member inventory, exact replacements, capacity and suggested receiving selection |
| `command_prepare` | Immutable complete native command, retained before any business mutation |
| `upload_prepare` | Exact selected original bytes frozen into their native file.add command |
| `review_prepare` | Complete reviewed native archive/attachment preview bound into its exact request |
| `execute` | Original journal lookup, then at most one unrecorded native request |
| `reconcile` | Original journal lookup and complete request identity comparison |

All suffixes above use the prefix `merchant_grant_source_desk_`. The existing `receive_begin`, `receive_chunk`, `receive_commit`, retained snapshot and file-reader tools remain the complete input/output transport.

## Prepare and receive original source files

1. Read `profiles` and the existing case/draft. Keep the native engine/profile hashes and actual current revisions.
2. For a new draft, choose one stable `source-desk-` ID followed by 32 lowercase hexadecimal characters. Prepare the native `create` command with revision zero and data `{title}`.
3. Download the complete returned operation file before execution. Its identity includes the exact native request, original case/draft, native request SHA, operation SHA and configured private workspace directory.
4. Execute using the returned exact operation snapshot reference. The original journal decides whether this request already exists. A recorded request returns its existing receipt; a new one performs the native command once.
5. For each original file, use a configured host input, a complete retained snapshot, or an already committed input transfer. Keep its whole-file SHA.
6. Call `upload_prepare` with receiving filename, original MIME type, provenance URL, observation time, reviewed draft revision, actor and stable request ID. It verifies and copies all original bytes into the retained command. Changing a host alias afterwards cannot change that saved upload.
7. Save and execute that prepared operation. Read the resulting complete draft before preparing the next revision.

The upload filename is its immutable native receiving identity. Original decimal amounts stay strings; counts and revisions are exact safe integers. The adapter rejects missing array elements, unsupported values and unpaired Unicode surrogates before hashing or dispatch.

## Original source selection and preparation

Use `file_inspect` to obtain original Workshare or Delivery handover candidates, their source hashes and native field pointers. Save the complete selected mapping with native action `selection.save`. The original browser/profile/source engine continues to define the mapping; the transport forwards its full original JSON.

Every ordinary native action is available through `command_prepare`:

| Action | Original data |
| --- | --- |
| `create` | `{title}` |
| `file.add` | Complete filename/MIME/provenance/time/byte count/SHA/base64; prefer upload_prepare |
| `file.remove` | `{fileId}`, preserving original prior editions |
| `selection.save` | `{selection}`, the complete original source selection |
| `prepare` | `{expectedEngineSha256, expectedSelectionSha256, expectedProfiles}` |
| `native.receive` | `{fileId, expectedSha256, expectedEngineSha256, expectedProfileSha256}` |
| `attach` | `{preparationId, expectedSelectionSha256, expectedVersion}` |
| `commissioning.archive.receive` | Exact original archive preview selection plus its preview SHA; prefer review_prepare |
| `commissioning.attach` | Exact original project/phase preview selection plus its preview SHA; prefer review_prepare |

Prepare and receive use the original source engine and journal. Use `preparation` to read every saved output descriptor, `output` for complete individual originals, or `archive_describe` followed by `archive` for the complete native package.

## Commissioning archive to original Installation

Upload the original merchant `handover.tar` through the same native file action. Call `archive_inspect` with the original draft revision and archive file ID. If names conflict with current selected files, explicitly select the exact current file IDs to replace and inspect again.

Retain the complete preview. It includes every original member, current conflicts, exact removals, native size calculations and the normalized receiving selection. `review_prepare` validates the full preview hash, original case/draft/revision, original action schema, selected data and readiness before creating the exact archive-receive operation. The operator reason stays in its native note field.

After execute or reconcile, the native receipt includes the original `receivingSelection`. Use its exact capture file and file IDs in `commissioning_inspect`. Choose the saved project's explicit case identity, current Installation and current original phase IDs. Call `commissioning_preview` with current Operations version, Installation revision and milestone mapping.

The attachment preview retains the original complete acceptance checks and the generated reviewed phase-association source. The eventual native attachment only appends those exact sources; original acceptance observations, dates, operator names, commercial Workshare and payment selections retain their original meaning.

Keep a nonempty Installation save reason in `note`, seal the full preview with `review_prepare`, save the complete operation, then execute. The whole-account snapshot is an explicit attachment choice. The complete private archive remains retained in the original Source Desk regardless of that later choice.

## Typed Node use

This source example runs beside the original agent-client module. Installed consumers use the same existing Grant agent export and original host binding:

```js
import {readFile, writeFile} from 'node:fs/promises';
import {
  GrantWorkspaceClient, inspectGrantAgentBinding,
  prepareInstallationSourceUpload,
} from './agent-client.mjs';

const binding = await inspectGrantAgentBinding({
  directory: originalGrantDirectory,
  label: 'Original delivery workspace',
  allowStart: false,
});
const client = new GrantWorkspaceClient(binding);
try {
  await client.open({expectedSelectionSha256: binding.selectionSha256});
  const current = await client.installationSources('detail', {caseId, draftId});
  const bytes = await readFile(originalFile);
  const prepared = prepareInstallationSourceUpload(caseId, draftId, bytes, {
    filename: 'Original_Customer_Handover.tar',
    mediaType: 'application/x-tar',
    sourceUrl: originalSourceUrl,
    observedAt: originalObservedAt,
    expectedSha256: reviewedSourceSha256,
  }, {
    expectedRevision: current.value.revision,
    requestId: originalRequestId,
    actor: responsibleOperator,
    note: originalReason,
  });
  // Use an existing owner-private directory and a new immutable filename.
  await writeFile(preparedFile, JSON.stringify(prepared, null, 2) + '\n',
    {flag: 'wx', mode: 0o600});
  const result = await client.installationSources('execute', {operation: prepared});
  await writeFile(receiptFile, JSON.stringify(result.receipt, null, 2) + '\n',
    {flag: 'wx', mode: 0o600});
} finally {
  await client.close();
}
```

Package consumers should use the actual package name in their selected release's manifest; the module export paths remain `./grant/agent` and `./grant/installation-source-desk-agent`.

`execute` returns `{state, operation, receipt, response, replayed}`. Its `response` preserves the exact original HTTP bytes: the command reply on first execution, or the original lookup reply on replay. `reconcile` returns the same shape and never submits a mutation. Direct native `command` remains available to typed consumers already retaining their complete original journal.

## Uncertain replies and reopening

A complete prepared operation remains usable after process restart. Read it unchanged and call `reconcile` on the same original workspace.

- `RECORDED` means the original native request ID, payload digest, case and draft all match. The complete verified original receipt is returned.
- `NOT_RECORDED` means the journal has no entry for that ID. Re-execute the same saved operation when appropriate.
- A conflict means that the original identity already belongs to different source data. Preserve both records and inspect their original histories.

The original client carries `GRANT_RESULT_UNCERTAIN`, original request ID, error code/status, route and service identity through a lost reply. A read-only commissioning/inspection POST is explicitly marked as a read; it cannot be reported as an uncertain financial or case mutation.

Closing the typed client drains accepted work under its existing owner. The merchant provider retains immutable complete source/receipt bytes before returning its normal file-reader references. If local retention fails after an original service success, the existing snapshot response reports that actual storage failure and original known status; it does not turn a known committed native request into a different request.

## Source and receiving continuity

The original native implementation remains:

- `operations_installation_sources.py`: source drafts, original blobs, preparation, case attachment and request journal.
- `operations_installation_commissioning.py`: exact saved capture/project/phase association and original Installation append.
- `operations_installation_commissioning_archive.py`: complete native archive member and manifest receiving.
- `installation_source_desk_client.py`: existing durable native CLI operation and replay contract.
- `installation-source-desk-receiving.py`: the same complete actual-source receiving, original case export, backup and reopen course.

The new Node adapter's prepared operation schema and digest match the original Python client. Its focused adapter check covers native canonical hashing, complete source-byte binding, normalized preview/replay, lost reply recovery and full declared routes. Current customer receiving remains with the original customer case owner.
