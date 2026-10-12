# Complete Analysis workspace backups

An Analysis workspace contains the dataset database and the complete outputs produced beside it. Portable workspace backups carry both in one ZIP so a receiving computer can reopen saved analyses, query exports, report downloads and workbook editions together.

The feature extends the original `AnalysisWorkspace`, its single job owner, local browser application and native MCP adapter. Every export has one stable operation ID, one retained SQLite snapshot and one immutable result. The existing database-only backup remains available for database maintenance.

## Use the browser

Open the existing private Analysis launch link and choose **Workspace backup** or the **Backups** tab.

1. Review the saved contents. The application lists included output jobs, the estimated input size, separate earlier portable archives and any missing original files. Restore a missing original output to its selected workspace location before starting a complete backup.
2. Select **Include earlier database backups** when those additional database copies should travel with the workspace. Earlier portable workspace ZIPs remain separate, avoiding recursive archive growth.
3. Choose **Create complete backup**. The original Activity history and Backups panel show the same operation. Progress reports the snapshot and archive phases, completed files and original input bytes.
4. Download **workspace.zip** and **archive-manifest.json**. The selected result shows the complete ZIP byte count and SHA-256. The download uses the original private capability and verified saved file. Browsers with direct file saving stream to the chosen destination; the bounded fallback verifies the downloaded bytes and checksum. The native download client supports larger files and interrupted transfers.
5. Use the receiving commands displayed under the selected backup to inspect and reopen it in a new private folder on the receiving computer.

**Cancel export** retains its existing snapshot and operation. **Resume this backup** continues that original request. Refreshing the page reconnects to the original running job. An interrupted response does not require another backup ID.

A restored workspace preserves the original administrative job history. Earlier portable ZIPs appear as separate archives when their archive-control folder is absent in the received workspace. Their saved data is already in the restored database; choose **Create complete backup** to export the current restored workspace.

## Use the installed Python runtime

The offline receiver and browser use the same installed `stellar_forge_buyer` package. Use a matching current runtime on the receiving computer.

Review a closed workspace:

```sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer-analysis archive-review
```

Create a full export with a chosen stable operation ID:

```sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/customer-analysis workspace-export \
  --id 0123456789abcdef0123456789abcdef \
  --include-previous-backups
```

The command prints the original completed job and its exact files. Repeating the same command with the same ID and selection reopens or resumes that original export. The command uses the normal workspace lock; a running browser or native host already owns that workspace and should perform the action through its existing API.

Inspect the downloaded ZIP and receive it into a new private directory:

```sh
python -m stellar_forge_buyer.workspace_archive_receive inspect \
  workspace.zip --sha256 ZIP_SHA256

python -m stellar_forge_buyer.workspace_archive_receive receive \
  workspace.zip /private/restored-analysis \
  --operation 0123456789abcdef0123456789abcdef \
  --sha256 ZIP_SHA256

python -m stellar_forge_buyer.analysis_workspace \
  --database /private/restored-analysis serve --open
```

Substitute the selected archive's actual SHA-256. Keep the same receiving operation ID, target and source digest after an interruption. The receiver verifies every archive member, the original workspace identity and all retained SQLite table counts before publishing the destination atomically. It resumes complete staged files and reconciles an already-published target after a lost completion response. A completed replay preserves subsequent live customer changes.

See [WORKSPACE_ARCHIVE_RECEIVING.md](python/WORKSPACE_ARCHIVE_RECEIVING.md) for the full receiving operation and [native Analysis archives](../../../stellar-forge/mcp-paid-agent/ARCHIVES.md) for host registration, native review, range transport and installed download commands.

## Contents and format

The portable format is `stellar-forge.analysis-workspace-archive.v1`. Its root `archive-manifest.json` identifies the original export and workspace, creation time, producer directory, database file, exact payload list, original table counts, included output jobs and explicit exclusions.

Every payload is under `workspace/` and has a relative path, byte count and SHA-256 in the manifest. Payloads include:

| Saved content | Location in the received workspace |
| --- | --- |
| Consistent dataset and Analysis database | `datasets.sqlite3` |
| Complete selected query-export formats and manifests | `analysis-query-exports/` |
| Completed workbook XLSX, definitions, revisions, complete source cohorts and source handoff | `analysis-workbooks/` |
| Retained report HTML, JSON or CSV ZIP, and complete change JSON/CSV | `analysis-exports/` |
| Explicitly selected earlier database backups | `analysis-backups/` |

Saved queries, views, imported scalar types, report publications, comparisons, profile results and original job history travel in the consistent SQLite database. Registered acquisition provenance stays attached to that original data. A receiving service creates its own local lock, launch capability and provider configuration.

The exporter selects completed output identities from its own retained database snapshot. It resolves all current file access below the selected private workspace. Producer absolute paths stay as provenance, including after the archive is received at another location. Original report, change and database-backup downloads resolve the verified local files after receiving.

## Existing service API

All routes share the current loopback service, origin checks and `X-Analysis-Capability` header.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/workspace-archive-review?include_previous_backups=true` | Contents, known input size, selected outputs, exclusions and missing files. |
| POST | `/api/start/workspace-export` | Start or reconnect using `{id, include_previous_backups}`. |
| GET | `/api/jobs/ID` | Original job, saved progress and computed local archive availability. |
| GET | `/api/workspace-archives?limit=25&before=SEQUENCE` | Newest-first original history with `next_before`. |
| POST | `/api/workspace-archives/ID/cancel` | Request cancellation of the original export with `{}`. |
| GET / HEAD | `/api/workspace-archives/ID/files/workspace.zip` | Verified ZIP with complete byte length, SHA-256 and strong ETag. |
| GET / HEAD | `/api/workspace-archives/ID/files/archive-manifest.json` | Verified manifest for the selected completed export. |

File GET supports Range and If-Range through the existing immutable export transport. Each request opens the same private saved descriptor and validates its expected identity. A descriptor-signature cache avoids hashing the complete archive again for every range. The receiving CLI independently verifies the resulting complete ZIP and every uncompressed payload before publishing a workspace.

## Recovery and storage

The original job owner persists archive intent before committing its RUNNING row. A completed snapshot is retained under `analysis-workspace-archives/ID/snapshot/`; its frozen manifest is retained in `archive-inputs.json`. Resuming reuses that snapshot and those original immutable outputs. ZIP metadata is deterministic, so interruption after publishing the archive can be reconciled against identical rebuilt bytes.

Disk-full or cancelled exports retain their operation and completed snapshot. Restore sufficient local capacity, then resume the same ID. A receiving operation stages below the target's existing private parent and publishes with the platform's original no-replace directory operation. The selected target and source digest remain bound to the same receiving journal.

Keep the complete ZIP on a private storage medium appropriate for the customer data it contains. Public distribution packages carry the implementation and operator guides; customer workspace data stays in its selected private locations.
