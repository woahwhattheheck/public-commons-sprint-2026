# Coastal source tools and retained-file receiving

The source-owned CO-OPS provider attaches to the original merchant MCP host. It operates the same console, workspace UUID, revisions and journal used by staff. It never creates a second coastal workspace or provider process.

## Host-selected connection

Start/reopen the original Coastal source operations application first. Save a private connection file:

```json
{
  "schema": "stellar-forge.coops-workspace-connection.v1",
  "workspaces": {
    "coastal-study": {
      "label": "Selected coastal study",
      "workspaceId": "ACTUAL_ORIGINAL_WORKSPACE_UUID",
      "applicationUrlFile": "/absolute/private/original-applications-url.json"
    }
  }
}
```

Use the actual native startup UUID and original Applications URL record. Alternatively select exactly one `consoleUrlFile` containing the original private console URL or `consoleUrlEnv` naming its host variable. Keep the token out of public source, work requests and tool arguments.

A host may declare up to 32 workspaces. Optional `sourcePackages` aliases contain host-selected `{path,sha256,label}` records for exact existing capture packages. Tools select these aliases; they cannot supply arbitrary paths or substitute another hash.

Initialize the original merchant host through its `coopsWorkspaceConnection` input. The helper `initializeCoopsWorkspaceMerchant({directory,connection,name})` creates an original merchant configuration, release store and customer-export directory. It does not launch the coastal console or send a payment.

## Calls and exact request identity

```sh
coops-mcp tools --url ACTUAL_MCP_URL --workspace coastal-study \
  --token-env MCP_ACCESS_TOKEN
coops-mcp action --url ACTUAL_MCP_URL --workspace coastal-study \
  --token-env MCP_ACCESS_TOKEN --request-file /absolute/private/request.json
```

An action file is the exact native `{action,payload,operationId,expectedRevision}`. A read-call file is `{tool,args}`. Files must be owned private regular UTF-8 JSON, at most 512 KiB. Credentials are read only from the selected host variable.

Retain the request before dispatch. After a lost or interrupted response, read `merchant_coops_operation` for that ID, then repeat the **same** request if needed. The native ledger reconciles it before current-revision validation. Responses retain `ok`, original HTTP/native state, selected workspace UUID and exact request. `OUTCOME_UNCERTAIN` does not authorize a new operation ID.

## Native tool groups

| Tools, with prefix `merchant_coops_` | Original operation |
| --- | --- |
| workspaces, schema, view | Host aliases, actual schema/capabilities and current workspace. |
| operation | Exact retained operation state/result without redispatch. |
| editions, edition, rows | Revision-bound archive, immutable source and at most 500 rows per call. |
| files, file_read, file_release | Exact metadata, verified bounded reads and temporary reader release. |
| station_save, station_archive | Station profiles and retained history. |
| capture_preview/start/pause/resume/import | Request plan and original capture. Import uses a host source-package alias. |
| backfill_preview/start/pause/resume/export | Serial historical study and streamed retained parts. |
| mapping_file, mapping_save | Read-only original JSON convention inspection, explicit selected-target save, retained input-file bytes and revision history. |
| edition_select/compare, annotation_save | Original selection, streamed comparison and retained review. |
| dataset_prepare/query | Original SF30 selected snapshot and existing query engine; optional mappingId pins the saved receiving convention and original file. |
| release_prepare/inspect/activate/start/stop/rollback | Existing SF82 lifecycle and generation controls. |
| buyer_inspect/receive | Existing SF88/SF100 intents and five-file receiving. |
| export_create | Original source packages, complete tables and readable reports. |

Every mutating tool requires native fields, a stable operation ID and the current original revision. Products, datum, units and time basis are explicit selections. Source quantities and payment outcomes are never inferred.

For archive pagination, retain the returned revision as `expectedRevision` on every subsequent page. A concurrent change requires restarting that listing. Immutable row paging retains its edition ID, table, dates and selected products.

The existing `merchant_coops_dataset_prepare` payload accepts optional `mappingId`. Its native reservation pins the saved revision, and its result identifies the ordered receiving columns and original mapping-file SHA. Native query field names follow those selected headings. Names must meet the original SF30 column contract (`^[A-Za-z][A-Za-z0-9_]{0,47}$`, excluding reserved names); a mapped value requires the original valueType companion. Later mapping saves leave the prepared dataset and original release source package unchanged.

## Complete file receiving

```sh
coops-mcp inspect --url ACTUAL_MCP_URL --workspace coastal-study \
  --kind export --id ACTUAL_EXPORT_ID --token-env MCP_ACCESS_TOKEN
coops-mcp download --url ACTUAL_MCP_URL --workspace coastal-study \
  --kind export --id ACTUAL_EXPORT_ID --out /absolute/private/received-export \
  --workspace-id ACTUAL_ORIGINAL_UUID --manifest-sha256 REVIEWED_TRANSFER_SHA256 \
  --token-env MCP_ACCESS_TOKEN
coops-mcp reopen --out /absolute/private/received-export \
  --manifest-sha256 REVIEWED_TRANSFER_SHA256
```

Kinds are `source` (an immutable edition's responses), `capture-source` (the capture's accepted and failed responses), `mapping-source` (all retained original input-file revisions for one saved mapping), `export` and `receipt`. Source kinds accept an optional original page index. For `mapping-source`, `page` is its exact positive mapping revision; omitting it from transfer inspection selects all input-file revisions. A customer receipt has the five native `dataset.csv`, `dataset.jsonl`, `review.html`, `delivery.json` and `manifest.json` files.

Inspection supplies a transfer index and SHA-256. Download writes that index plus every selected original file. Repeating the same command resumes its original private directory, hashes and progress. Reopen verifies completed local bytes without a network call.

The adapter validates each complete HTTP file against its retained byte count/hash, then passes a read-only descriptor to the existing retained-file reader. Chunks carry native read IDs, offsets, byte counts, hash and base64 data. Closing the console does not invalidate a retained reader. An expired reader can resume against the same file hash. Transfer identity uses the immutable workspace UUID, so a legitimate listener-port change does not reassign the download.

Accepted source files are original decoded HTTP JSON response bytes. Failed attempts may contain arbitrary error bytes and use an octet-stream type. No separately captured wire body is claimed. The index records local receiving names while retaining original filenames and selections. If a source-set index exceeds 65 KB, select an original page or mapping revision or use a complete native source-package export.

## Limits and recovery

The console owns capture/backfill/export limits. Retained data exports are bounded to 1 GiB. MCP downloads use the existing bounded reader instead of embedding a full export in JSON. Temporary receiving files remain private and are unlinked once the verified read-only descriptor is handed over.

After authentication rejection, reopen the original session reference. After an interrupted action, retain its exact request. If file size/hash changes, reconcile the selected source before continuing; do not overwrite a receiving manifest with another one.

The catalogue imports only the pure tool contract. The existing lazy registry loads runtime code when the host selects its configured CO-OPS attachment. Other providers and signer/payment authorization remain unchanged.

## Complete coastal analysis

`merchant_coops_analysis_export` joins two original retained edition identities
to the complete analytical workbook. Supply `workspace`, the stable
`operationId`, current `expectedRevision`, `observationsEditionId` and
`predictionsEditionId`. Optional `options` retain the GMT window, quality,
inference/tolerance exclusions, sigma and residual thresholds. Optional
`analyst` retains name, project, question, interpretation and follow-up.

The native result includes `workbookExportId`, `portableExportId` and every
`files[]` descriptor. Use the existing export selectors with
`merchant_coops_files` and `merchant_coops_file_read` to receive the actual
complete HTML, editable workbook, all numerical/source files and manifest.
The original journal reconciles an interrupted request before revision checks.
Accepted source no-data outcomes remain explicit missing coverage in the workbook.

See [the complete analyst and native operating guide](analysis/README.md).
