# Approved World Bank sources for the original programme agent

The existing Merchant World Bank provider now receives an approved complete handover ZIP, registers its typed document through the running Analysis owner, retains the exact registered original files, and returns the source name, revision and document ID for a named programme. The same workflow is available through the typed JavaScript client, MCP tools and installed CLI.

## Run a complete intake

Use the configured original Analysis alias from `merchant_worldbank_programme_connections`. Its private launch file still selects the existing numeric-loopback Analysis capability and exact saved workspace ID. The original World Bank seller core must be installed for native registration. Intake does not acquire public data or create another Analysis owner.

Keep the source ZIP private and select a new stable 32-character lowercase hexadecimal intake ID. The ID shares the original native World Bank operation namespace. Use an empty private operation directory whose parent already exists.

```sh
chmod 600 /absolute/approved-handover.zip
starforge worldbank-programme-agent intake \
  --url http://127.0.0.1:9000/mcp \
  --workspace research \
  --intake-id ORIGINAL_32_HEX_ID \
  --handover /absolute/approved-handover.zip \
  --directory /absolute/private/source-intake \
  --token-env MCP_ACCESS_TOKEN
```

Substitute the actual original MCP URL, declared alias and hexadecimal ID. The tool retains the complete input ZIP and immutable intent before any upload or registration write. The intent binds the MCP endpoint, workspace alias and native identity, intake ID, original filename, byte count, SHA-256 and optional programme selection. The original MCP credential stays in the named environment variable.

On success, the command returns `REGISTERED`, the exact source name/revision/document ID, the retained export identity and the complete received files. A still-running registration returns its actual state and exit code 2; continue the same command and directory. Exit code 1 reports an error with its original identity retained.

After the first invocation, the original local `--handover` option may be omitted: the client reads its already preserved full input. If the source file is supplied again, it must contain exactly the original bytes. The saved original filename remains the same even if the local path moved.

## Continue the original operation

The native server remains the authority for registration and upload progress. The client always reopens the original intent and reads status. It never starts a replacement intake to compensate for an interrupted response.

- `UPLOADING` / `UPLOADED`: resend only from `available_bytes`, the verified contiguous bytes present in the current installation. Each replayed chunk is checked by original offset, size and SHA-256, then status is read again.
- A restored workspace may report `received_bytes` equal to the original ZIP size while `available_bytes` is zero. Its SQL history survived; temporary upload fragments did not. The client restores the same chunks under the same ID.
- `REGISTERING`: read the original registration until it completes or the selected wait expires. A lost POST response does not justify a second registration.
- `ERROR` / `INTERRUPTED`: inspect the original error and continue with `--resume true`. This explicitly resumes the same original native importer and source identity.
- `REGISTERED`: verify the original retained document through the current workspace root. Upload fragments are no longer needed. Download the original registered ZIP and complete registration.

Each observed native result or error is retained by content hash in `observations/`. A later result adds another full observation; it does not replace earlier outcomes. The operation directory uses the existing native state lease, preventing two clients from writing that same local intent concurrently.

An uncertain network outcome is returned to the caller. The next invocation reopens the same intent/status. There is no automatic mutation loop after an unknown reply.

## Join the exact source to an existing programme

Add all three explicit options to prepare the source review through the existing original programme:

```sh
starforge worldbank-programme-agent intake \
  --url http://127.0.0.1:9000/mcp --workspace research \
  --intake-id ORIGINAL_32_HEX_ID \
  --handover /absolute/approved-handover.zip \
  --directory /absolute/private/source-intake \
  --programme annual_review \
  --programme-operation-id DISTINCT_REVIEW_32_HEX_ID \
  --programme-revision 3
```

Use the actual current definition revision from `merchant_worldbank_programme_definition`, and a distinct review operation ID. Keep this complete programme selection on subsequent invocations. The client retains `programme-review-intent.json` before preparing. It uses the registered source name and exact revision returned by the original importer.

The existing programme then compares the incoming source with the accepted customer edition. Inspect its complete review, comparison pages, current customer edits and worksheet choices. Publish through `merchant_worldbank_programme_publish` with the original review hash and explicit operator note. Registration and preparation preserve the accepted report/workbook until that reviewed publication.

If a programme was not selected initially, use the retained `source-selection.json` with the ordinary programme `prepare` tool. Do not change an existing source-intake intent to add a different programme.

## Typed application integration

The maintained distribution exposes `./merchant/worldbank-programmes/intake`. From the source module, the same typed interface is:

```js
import {
  registerWorldBankSource,
  downloadWorldBankIntake
} from './worldbank-intake-client.mjs';

const result = await registerWorldBankSource({
  client: existingMerchantClient,
  workspace: actualAlias,
  intakeId: originalIntakeId,
  handover: approvedZipPath,
  directory: privateOperationDirectory,
  prepare: {
    programme: actualProgrammeName,
    operationId: originalReviewOperationId,
    expectedRevision: actualDefinitionRevision
  }
});
```

The existing client supplies `endpoint` and `call(name,args,options)`; it stays caller-owned. Alternatively supply `url`, `tokenEnv`, `environment` and optional `signal`. A client created by this operation is closed if it exposes a close method. The operation always attempts release of its original local lease.

Direct `WorldBankProgrammeClient` users also have `intakeList`, `intakeBegin`, `intakeStatus`, `intakeChunk`, `intakeRegister`, `intakeWait` and `intakeDownload` on the same original Analysis connection. Direct callers preserve their own durable intent before writes. `intakeRegister` returns the original native response; read `intakeStatus` for the complete workspace-bound status.

## MCP controls

All actions use the existing `merchant_worldbank_programme_` prefix and configured provider.

| Suffix | Original operation |
| --- | --- |
| `intake_list` | History page; follow `next_before`. Read individual status before determining local byte availability. |
| `intake_begin` | `workspace, request:{id,bytes,sha256,filename}`; exact intent replay. |
| `intake_status` | `workspace,intakeId`; original identity, status, available bytes and registration result. |
| `intake_chunk` | `request:{offset,sha256,content}`; aligned 256 KiB canonical-base64 chunks, final chunk may be shorter. |
| `intake_register` | `workspace,intakeId,resume?`; original registration only. |
| `intake_wait` | Same ID, optional 1–120000 ms wait and 100–10000 ms polling interval. |
| `intake_export` | Exact registered ID and approved ZIP `expectedSha256`; retain all three complete original files. |
| `intake_manifest` | Read the retained complete export manifest after the Analysis service closes. |
| `intake_file` | Complete file by export/manifest/file SHA-256 and offset, with original retained read ID. |
| `intake_file_release` | Release that original read after completion or interruption. |

The original native importer enforces the complete 32 MiB approved package limit. Each encoded upload chunk fits the existing one-MiB request capacity. The transport streams downloads with the existing original Content-Length/SHA-256 checks and immutable file writer.

## Complete portable source delivery

The retained manifest `worldbank-intake-delivery.json` includes the original workspace and intake identity, exact source revision/document ID, original ZIP and registration hashes, and these complete files:

- `WorldBank_Approved_Handover.zip` — exact registered input bytes, downloaded from the retained native document;
- `WorldBank_Source_Registration.json` — full original registration, original review, typed columns and source metadata;
- `WorldBank_Source_Intent.json` — original filename, full byte count and SHA-256.

The host publishes this manifest only after all three files are retained. Its content-derived export ID is stable across native reopen and provider restart. No observation timestamp is added to that identity.

Receive those files independently:

```sh
starforge worldbank-programme-agent intake-download \
  --url ORIGINAL_MCP_URL --workspace ORIGINAL_ALIAS \
  --export-id ORIGINAL_EXPORT_SHA256 \
  --manifest-sha256 ORIGINAL_MANIFEST_SHA256 \
  --directory /absolute/private/registered-source
```

The existing retained downloader verifies the complete manifest and every file, retains partial-file progress, resumes the exact same export after a provider/read restart, and receives the whole original ZIP. It uses a separate private receiving directory; never point it at the parent intake operation directory.

The input may originate from the original World Bank seller's approved handover or a registered document recovered from a portable Analysis archive. The original importer validates its source and review content. A registered source may later be selected by another explicitly reviewed programme without re-uploading or changing its document identity.
