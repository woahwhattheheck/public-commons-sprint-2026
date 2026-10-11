# Native Report Server runner

This runner moves an existing native **PBIX or RDL** through a retained Report Server operation. It uses the current Windows identity, streams native files, keeps the original target content, verifies the report returned by the server, and produces a result ZIP that the BI operator can import.

The on-premises Report Server workflow is separate from the cloud Power BI workflow. A PBIP source directory is not a Report Server PBIX. Save a real, compatible native file in the appropriate Microsoft tooling before registering it. Registration checks the existing file's bytes and container or RDL root; it does not establish optimized Desktop compatibility.

## Existing Windows environment

Use Windows PowerShell 5.1 or PowerShell 7 on the already configured Windows host. The script uses .NET libraries included with PowerShell and installs nothing.

The signed-in identity needs the existing server permissions for the selected operation. REST calls use default Windows credentials. The configured report portal and ReportServer service URLs are explicit job inputs; redirects are rejected, TLS verification remains enabled, and no password, browser cookie, token, or credential file is collected.

Keep the operation directory on durable private local storage with enough space for the original report, captures, and result ZIP. A fresh operation directory gets an ACL for the current identity and SYSTEM. Later invocations lock and reuse that same directory. Do not run two copies of a job simultaneously.

## Register the original native file

Registration is local and sends no server request. It hashes the complete file as a stream. Supply the real installed build values:

~~~powershell
.\RUN_REPORT_SERVER.ps1 -Action Register -NativeFile 'D:\Migration\Revenue.pbix' -DesktopBuild 'actual optimized Desktop build' -ReportServerBuild 'actual Report Server build' -OutputFile 'D:\Migration\Revenue.native.json'
~~~

The output uses schema **commons-bi-report-server-native/1**:

~~~json
{
  "schema": "commons-bi-report-server-native/1",
  "file": "Revenue.pbix",
  "bytes": 123456,
  "sha256": "complete-lowercase-sha256",
  "kind": "PowerBIReport",
  "embedded": false,
  "desktop_build": "actual optimized Desktop build",
  "report_server_build": "actual Report Server build"
}
~~~

The manifest contains a portable basename, never the original local path. Import it into the BI operator's native Report Server registration. The operator can embed a smaller native file in its job ZIP or retain the registration for a large external file.

For an external input, pass -NativeFile when publishing. The runner checks the complete byte count and SHA256 again, holds the file open without write sharing during upload, and remembers its path only in private Windows state. On later calls, supply the same original job and state directory. If the file has moved, -NativeFile can identify another existing byte-identical copy.

## Exact job contract

Extract the operator's job ZIP into a durable working directory. Keep the original **job.json** bytes intact: the result binds to their SHA256, not a JSON reserialization.

| Job field | Meaning |
| --- | --- |
| schema | commons-bi-report-server-job/1 |
| job_id | Stable operation identity supplied by the operator |
| native.file | Portable basename of the original .pbix or .rdl |
| native.kind | PowerBIReport for PBIX; Report for RDL |
| native.sha256 / native.bytes | Exact complete native-file identity |
| native.embedded | true: the file is next to job.json; false: supply its existing path |
| target.api_base | Configured portal URL ending in /api/v2.0 |
| target.report_server_url | Separate configured ReportServer URL-access service root |
| target.report_path | Absolute catalog path naming one report, such as /Migration/Revenue |
| parameters | Report parameter values for the default RDL capture |
| report_server_build / desktop_build | Declared actual native environment versions |
| paginated_exports | Optional array of {report_path, parameters, file} for native RDL CSV captures |

For example, the portal may be https://reports.example.org/Reports/api/v2.0 while rendering uses https://reports.example.org/ReportServer. These are configured deployment addresses, not interchangeable API endpoints.

Parameters are a JSON object. Strings pass through URL encoding; Boolean values become 1 or 0; null uses the native :isnull=true convention; flat arrays repeat the same parameter. Names are case-sensitive. For locale-sensitive values, provide the exact server-expected string.

A Report job without explicit paginated_exports captures its own RDL as report.csv. A PowerBIReport job captures only explicitly named RDL exports or an operator-supplied Desktop CSV. It never sends a PBIX to the paginated CSV renderer.

## Inspect and choose the intended operation

Inspect reads catalog metadata and, where available to the current identity, the native MaxFileSizeMb server property. It records declared builds separately from the observed property response. It does not download or change the report definition.

~~~powershell
.\RUN_REPORT_SERVER.ps1 -Action Inspect -JobFile 'D:\Migration\job\job.json' -StateDirectory 'D:\Migration\report-server-state'
~~~

Capture retains the first original target definition, exact bytes, metadata, identity, and hashes. An originally absent target is retained as an absence. Repeating Capture reuses that original; it never replaces it with a later server version.

### Complete migration evaluation and restoration

Run performs:

1. Capture the original native target and requested original-stage CSV.
2. Recheck the current target against the retained original.
3. Publish the exact input and read back its native content.
4. Capture the published-stage CSV.
5. Restore the original native content, or remove this job's newly created item.
6. Read back the restored target and capture the restored-stage CSV.
7. Package the complete result.

~~~powershell
.\RUN_REPORT_SERVER.ps1 -Action Run -JobFile 'D:\Migration\job\job.json' -NativeFile 'D:\Migration\Revenue.pbix' -StateDirectory 'D:\Migration\report-server-state' -AllowOverwrite -OutputFile 'D:\Migration\Revenue-evaluation-result.zip'
~~~

Use -AllowOverwrite when the job is intended to replace an existing target. The script requires that option because the native multipart endpoint itself has no protective Overwrite switch. For a new catalog path the option is unnecessary.

By default, Run finishes with the original target restored. Add **-KeepPublished** when the intended result is to leave the verified input installed. A job that has entered rollback cannot become a later deployment; create that later deployment as its own job.

If a published-stage CSV fails, Run still attempts the requested guarded restoration and retains the capture failure. Its result does not become a successful business comparison merely because restoration succeeded.

### Publish without the full evaluation cycle

~~~powershell
.\RUN_REPORT_SERVER.ps1 -Action Publish -JobFile 'D:\Migration\job\job.json' -NativeFile 'D:\Migration\Revenue.pbix' -StateDirectory 'D:\Migration\report-server-state' -AllowOverwrite
~~~

Publish automatically captures the original if needed. It checks the native file manifest and a fresh full target-content readback before sending the upload. If the requested bytes are already present at the same original item, it records that fact without sending another upload.

### Existing Desktop CSV

Capture a CSV through the actual Desktop workflow, then import that existing file at an explicitly selected stage:

~~~powershell
.\RUN_REPORT_SERVER.ps1 -Action Export -Stage published -JobFile 'D:\Migration\job\job.json' -StateDirectory 'D:\Migration\report-server-state' -ManualCsvFile 'D:\Migration\captures\Revenue-desktop.csv'
~~~

The result records an operator-supplied Desktop CSV. Its provenance differs from native RDL URL rendering. A manually supplied CSV is not silently reused across before, published, and restored stages.

## Restart, reconcile, and rollback

Use the exact same job.json and StateDirectory after a process, network, or host interruption. The operation is keyed by job_id plus the original job SHA256, retains its history, and takes an exclusive local lock.

Each server write is checkpointed before it starts. A process interruption can therefore leave publish_pending or rollback_pending even if the server accepted the request. Reconcile performs fresh reads and does not repeat the write:

~~~powershell
.\RUN_REPORT_SERVER.ps1 -Action Reconcile -JobFile 'D:\Migration\job\job.json' -StateDirectory 'D:\Migration\report-server-state'
~~~

| Readback | Result |
| --- | --- |
| Same target identity and exact requested native bytes | published_verified |
| Original identity and exact captured original bytes, or original absence after rollback | rolled_back_verified |
| Original unchanged after a publish attempt | publish_not_applied |
| Verified published content remains after a rollback attempt | rollback_not_applied |
| A different identity or different native bytes | target_conflict, with observed content retained |

A reconciled not_applied result allows a later **explicit** Publish or Rollback invocation. Run does not automatically retry those writes. An unresolved or conflicting result remains attached to the same operation for review.

Rollback restores the first captured native definition only after a new read proves that the current item is still this job's verified publication:

~~~powershell
.\RUN_REPORT_SERVER.ps1 -Action Rollback -JobFile 'D:\Migration\job\job.json' -StateDirectory 'D:\Migration\report-server-state'
~~~

For an existing item, rollback addresses its retained GUID and verifies the original bytes afterward. For a path originally absent, it removes only the observed item GUID after an exact current-content check, then verifies absence. Native REST upload does not provide a documented atomic compare-and-swap transaction. Use the agreed target during the operation; immediate read checks detect intervening changes but cannot eliminate a simultaneous independent writer between a check and write.

This rollback covers **native report content and catalog identity**. It is not a backup of server credentials, policies, subscriptions, refresh schedules, shared data sources, or the underlying database. Those are separate deployment configuration responsibilities. A native-content hash match does not establish that a live data source produced the desired business totals.

## Result ZIP and BI operator intake

Every completed action produces a new ZIP; errors also attempt to package retained state and partial observations. The script never overwrites an earlier result ZIP. If packaging runs out of space or its destination is unavailable, keep the operation directory and run Package with a new filename in an existing output directory:

~~~powershell
.\RUN_REPORT_SERVER.ps1 -Action Package -JobFile 'D:\Migration\job\job.json' -StateDirectory 'D:\Migration\report-server-state' -OutputFile 'D:\Migration\Revenue-result-recovered.zip'
~~~

At the ZIP root, result.json uses **commons-bi-report-server-result/1** and contains:

- job_id and job_sha256 for the exact original job bytes.
- state, complete events, original/published observations, and capture stages.
- files entries with path, bytes, sha256, role, and embedded.
- Each captured CSV has **role: capture**, report_path, parameters, stage, and capture_kind. The operator imports each embedded capture CSV as a complete dataset.
- Native files omitted because the input is registered externally have **embedded: false** and an explicit custody statement. The original source and retained server copy remain in the original private Windows operation.
- A portable state projection without the external local path or any credential material.

The ZIP also retains the original job, exact runner source, available guide, metadata, embedded native captures, upload/delete responses, and CSV bytes. All listed embedded files have a full streaming SHA256. result.json is the manifest and is not recursively listed as its own hashed file.

Native content and capture paths survive restarts. Identical native observations may reference one verified retained local copy; the runner does not create cross-workspace hard links. Keep the Windows operation until its native-file custody and required recovery period are complete.

A result can contain report data and internal server addresses. Deliver it through the established private handoff. The two source files contain no customer target, secret, or native report.

## State interpretation

created and captured are preparation states. published_verified and rolled_back_verified describe exact native-content readback. completed_published and completed_restored describe the requested sequence, including requested capture steps. A *_with_export_error state preserves a real capture failure alongside the completed target disposition.

CSV capture does not approve a migrated measure or reconciliation. Import the native result into the BI operator, select the correct original and candidate datasets, and review its concrete totals, joins, missing rows, and corrections.

## Microsoft native contracts

Primary references checked on 2026-10-11:

- [Power BI Report Server REST API](https://learn.microsoft.com/en-us/rest/api/power-bi-report/).
- [Upload Power BI report](https://learn.microsoft.com/en-us/rest/api/power-bi-report/power-bi-reports/upload-power-bi-report) and [upload paginated report](https://learn.microsoft.com/en-us/rest/api/power-bi-report/reports/upload-report): multipart Model.Upload for a new or existing native report; catalog keys accept GUIDs or escaped paths.
- [Microsoft Write-RsRestCatalogItem](https://github.com/microsoft/ReportingServicesTools/blob/master/ReportingServicesTools/Functions/CatalogItems/Rest/Write-RsRestCatalogItem.ps1): one binary File part, catalog item name as multipart filename, and default Windows credentials. The multipart endpoint ignores that cmdlet's Overwrite, Description, and Hidden properties.
- [Microsoft Get-RsRestPublicServerSetting](https://github.com/microsoft/ReportingServicesTools/blob/master/ReportingServicesTools/Functions/Admin/Rest/Get-RsRestPublicServerSetting.ps1): System/Properties?properties=MaxFileSizeMb and its named value response.
- [Microsoft Remove-RsRestCatalogItem](https://github.com/microsoft/ReportingServicesTools/blob/master/ReportingServicesTools/Functions/CatalogItems/Rest/Remove-RsRestCatalogItem.ps1): native catalog deletion.
- [Report URL access](https://learn.microsoft.com/en-us/sql/reporting-services/url-access-ssrs) and [report parameter syntax](https://github.com/MicrosoftDocs/sql-docs/blob/live/docs/reporting-services/pass-a-report-parameter-within-a-url.md): separate ReportServer rendering service, native parameters, null, and Boolean values.

The code is an original streamed implementation. Actual server execution requires the configured Windows host and target; a source parse or file registration is not a completed server publication.
