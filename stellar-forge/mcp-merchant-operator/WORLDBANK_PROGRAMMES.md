# World Bank customer programmes through Merchant

This provider operates a named programme in an already running, privately owned Analysis workspace. The original World Bank service owns source preparation, comparison, review, report publication, workbook creation, SQLite history and portable workspace export. Merchant exposes these actions to an agent and retains every delivered file. The existing Console workflow series owns dates, periods, calls, review pauses and handover.

The native service instructions remain [Analysis programmes](../../products/worldbank/ANALYSIS_PROGRAMMES.md), [World Bank operating guide](../../products/worldbank/OPERATING.md) and [recurring source delivery](../../products/worldbank/RECURRING.md). Read the installed source manifest to identify the exact code in use. Source acquisition and registering a new World Bank response remain with the original service owner. Choose a real retained source revision; these tools never synthesize a source response.

## Connect the original service

Start or reopen Analysis through its existing owner. Keep its private `analysis-launch.json`, native workspace ID, named programme and existing source revisions. Supply a private connection file using [the example](examples/worldbank-programme-connection.json). Replace every example value from the original launch/state; the example does not name a customer case.

```json
{
  "schema": "stellar-forge.worldbank-programme-connection.v1",
  "workspaces": {
    "economics": {
      "label": "Original economic workspace",
      "workspaceId": "00000000000000000000000000000000",
      "launchFile": "../analysis/analysis-launch.json",
      "programmes": ["quarterly_economic_report"]
    }
  }
}
```

Set the existing Merchant host configuration's `worldbankProgrammeConnection` to this file. Retain the host's normal `exportsDirectory`, original bearer environment and existing Console configuration. The connection and launch files must satisfy the original private-file reader: owned regular files and private directories, without symlink traversal. The capability stays in the original launch file and is never returned in a tool result.

Each operation rereads that file and pins its exact loopback URL/capability for the whole call. A restarted original Analysis service may update its launch URL, but its 32-character workspace ID must remain the configured one. Only declared programme names can be selected. The host advertises `worldbank-programmes`; its family is `worldbankProgrammes`.

The provider uses its own concurrency and abortable shutdown. This lets a Console workflow call the World Bank tools on the same Merchant host. Closing the provider cancels its own pending reads and transfers, drains their outcomes, and closes retained-file reads; it does not close the original Analysis owner.

## Inspect before writing

Call `merchant_worldbank_programme_connections`, then `state`, `list` and `sources` with the chosen workspace alias. Follow each returned pagination cursor. `definition` returns the complete named programme and `history` returns retained revisions. The source list describes actual retained source documents. Preserve source name/revision, country and indicator coverage, time bounds, missing values, units, source links and retrieval metadata.

All tools below use the prefix `merchant_worldbank_programme_`:

| Action | Original service operation |
| --- | --- |
| connections | Read configured aliases, workspace IDs and allowed programme names |
| state / list / sources | Read the original workspace, programme directory and source pages |
| definition / history | Read a complete programme or revision page |
| save | Save a reviewed programme definition with stable request ID and expected revision |
| prepare | Prepare one exact source revision under its stable native operation ID |
| status / wait | Read that same native operation; a bounded wait can return unfinished |
| review / comparison | Read the full retained review and comparison pages |
| publish | Publish the reviewed source/report/workbook with exact review digest and note |
| reopen | Create an explicitly requested linked portable delivery of an accepted edition |
| recipe | Prepare the four-step recipe for the existing Console workflow engine |
| export | Retain all original files from an exact COMPLETE native result |
| manifest / file / file_release | Receive the full immutable manifest and files by hash, offset and retained read ID |

A save request carries `id`, `expected_revision` and the complete original definition. Prepare carries `id`, `expected_revision`, and `source:{name,revision}`. IDs are 32 lowercase hexadecimal characters. Keep an ID and its complete body before dispatch; a different intended source or edition needs its own explicit operation. A failed write response may be outcome-unknown. Inspect the same ID before deciding whether its original request can be continued.

## Review and publish

Prepare is asynchronous. Read status or use `wait`; neither HTTP202 nor elapsed time establishes completion. At REVIEW_READY read the complete review, including baseline/candidate source descriptions, change counts and detailed comparison pages, excluded columns, report definition and workbook proposal. The operator chooses the actual accepted source and supplies a review note.

Publish uses the same operation ID, exact `review_sha256`, original note and full worksheet columns when required. The native manager retains these choices. Explicit `resume:true` continues a retained interrupted/error operation; it does not allocate another period. A changed review digest or changed source intent is rejected by the native service.

Optional `awaitCompletion:true`, `timeoutMs` (up to120000) and `pollMs` make publish read the same operation after dispatch. The result always retains the actual native state. WORKBOOK_COLUMN_CHOICES_REQUIRED, ERROR, INTERRUPTED and RUNNING remain visible; no state is translated into success. Worksheet choices use the native proposal's exact ordinal names and complete mapping shape. Do not infer mappings from a shortened table.

The returned wrapper is `{workspace,operation,resultSha256}`. The digest is present only for a complete native result and binds all fields of that result. Export requires this exact digest.

## One saved workflow series and period

Use `recipe` with the actual programme revision, source revision, stable native period operation ID, operator review note and any known column choices. It returns a complete original Console recipe with the current tool definitions, original argument mappings and source hash. It contains four steps:

1. Prepare the exact source on the original service.
2. Wait for REVIEW_READY, then pause for human review.
3. Publish and receive that same native operation, requiring COMPLETE.
4. Retain every original customer file.

Install the recipe using the existing `merchant_workflow_series_recipe_prepare` and `recipe_install` controls, then the normal series, calendar, cycle-review/save and start-review/start methods. Preserve their actual full review objects and exact expected hashes. Each saved period supplies its approved source revision and its own stable native operation ID. The recipe does not schedule or manufacture a period.

After the review pause, inspect the saved native review call and resume the original run using its current revision. The initial note and columns are retained run inputs. If further worksheet choices are needed, publication remains the unfinished step. The following recovery uses the existing Console machinery and preserves its entire history:

1. Read the original run. It must be inactive and waiting at `publish`.
2. Read the original native operation and exact worksheet proposal. Select the complete mappings.
3. Call the exported read-only `prepareWorldBankProgrammeRecovery` helper with that run ID/revision, a stable new recovery draft ID and full columns. It reads the saved publish call and returns a complete draft with `recoveryOf` set to that call. The native ID, review digest and note are preserved; `resume` becomes true.
4. Save that draft through `merchant_workflow_series_draft_save`; retain the returned revision. Start it through `call_start` using one stable call ID, the same profile and the current host fingerprint.
5. Read the saved call. A COMPLETE tool call containing a still-running native operation is not enough: its `operation.status` must be COMPLETE. If another bounded wait or explicit choice is needed, create another recovery draft linked to the original unfinished call. Keep each attempted draft/call.
6. Resolve the original `publish` step using `run_resolve`, the current run revision, completed recovery call ID and an operator note. Then resume that same run. Its export step reads the recovered result digest.

The helper accepts a `MerchantWorkflowSeriesClient` or its original Console client. It only prepares the recovery request; it never sends a publication or starts a call. The original engine verifies recovery linkage, current owner, profile, native result conditions and revision. Failed prepare/review waits use the same standard saved recovery-call procedure. All original calls and attempts remain in the period history.

## Complete files and customer handover

After native COMPLETE, call export with the displayed result digest. It streams every original filename and verifies its declared bytes/SHA256. This includes the analytical workbook, workbook handover, report formats, source comparison, retained selection, workspace ZIP/manifest and original delivery ZIP. It also retains the full operation record as `WorldBank_Programme_Operation.json`, excluding only the current machine's dynamic download-availability flags.

`worldbank-programme-delivery.json` binds the exact native operation, source result digest and every file. The export ID is derived from this full manifest body. The manifest is published only after every file has been received. An interrupted transfer resumes the same selected hashes; differing existing bytes are preserved and rejected. Once retained, the manifest and files remain readable even after the Analysis owner closes.

Choose **World Bank programme** in the Console Customer receiving form, or use generic `merchant_workflow_series_customer_receive` with:

```json
{
  "profileId": "original-profile",
  "family": "worldbank-programme",
  "workspace": "economics",
  "exportId": "EXACT_EXPORT_SHA256",
  "expectedManifestSha256": "EXACT_MANIFEST_SHA256",
  "expectedHostFingerprint": "EXACT_CURRENT_HOST_SHA256"
}
```

The Console recognizes the original export call and fills this selection. Wait for the local delivery to become COMPLETE before downloading its files. Its archive route streams the original `WorldBank_Analysis_Delivery.zip`. Individual files can be up to1GiB; the browser route streams them instead of constructing one large JSON or in-memory ZIP.

Use the normal workflow-series capture and receive controls to carry the full profile history and all customer files into the destination Console. The profile's JSON archive alone retains file identities, not remote file bytes; use complete handover capture/receive for actual transfer. The receiver checks every member's full size/hash, preserves all original requests and accepts the same archive again without creating another native programme. Opening the native workspace ZIP follows the original Analysis restore instructions and retains its workspace identity.

## Reopen an accepted edition after restoring its workspace

Read the original native operation after restoring the complete Analysis workspace. Status includes `accepted_edition` and `can_reopen`. The service verifies the retained review, selected source version, report publication and completed workbook before exposing that accepted binding. An operation interrupted while assembling its portable ZIP can therefore remain `INTERRUPTED` while `can_reopen` is true. Keep that original state and history.

When `can_reopen:true`, call `merchant_worldbank_programme_reopen` with the same workspace/programme and a request containing a **new explicit delivery id**, plus `operation_id` naming the accepted parent. Keep that request unchanged on recovery; `resume:true` continues this new delivery if it is interrupted. The service retains `parent_operation_id`, `accepted_operation_id` and the accepted binding hash, reuses the original report/workbook, and snapshots current customer edits. It does not republish the original business outputs or rewrite the old archive.

Wait for the new linked delivery to become COMPLETE, then export its exact result digest through the same file and Console handover controls above. A readable accepted edition alone is not a complete downloadable delivery. If the original workbook is unfinished or its native job has not yet been committed, the service withholds `can_reopen`; continue the original operation through its existing review/publish recovery instead.

## CLI and reusable clients

The installed World Bank selection includes `worldbank-programme-agent`:

```sh
starforge worldbank-programme-agent call --url http://127.0.0.1:PORT/mcp --tool merchant_worldbank_programme_status --arguments status.json --output status-result.json
starforge worldbank-programme-agent download --url http://127.0.0.1:PORT/mcp --workspace economics --export-id EXPORT_SHA256 --manifest-sha256 MANIFEST_SHA256 --directory /private/customer-delivery
```

Use the original bearer-token environment, or explicitly name it with `--token-env`. The complete arguments file is limited to the native1MiB request envelope. Existing different output files are never overwritten. A result-file failure after a response is reported as `resultReceived:true`; inspect the existing native operation and retained response rather than creating another ID.

The package exports `./merchant/worldbank-programmes/client`, `./merchant/worldbank-programmes/recipes` and `./merchant/worldbank-programmes/provider`. The client preserves original HTTP error status/details and marks uncertain writes. Retained downloads use bounded chunks, stable read IDs, full-byte hashes and the existing transfer checkpoint/lease implementation. Release an active read on completion or interruption. A fresh process reopens the same file hash/offset rather than assuming an old descriptor remains live.

## Boundaries and source closure

The new provider contributes JavaScript roots, its command, guide and private-config example. The World Bank recipe includes the current merchant-console contribution so its existing Applications, workflow-series, archive and receiving modules ship together. The original complete SF88 Python component remains selected, including the owner-maintained programme manager/HTTP routes. Dynamic Console browser assets and source-read runtime inputs are selected by the maintained distribution composer; original Python/support files remain explicit.

There is one native Analysis owner and one saved workflow period. This adapter does not retrieve a fresh upstream response, launch a competing Analysis service, change an existing schedule or issue payments. Source values and native report/workbook/workspace bytes are preserved exactly. Operator assumptions, approvals and source exclusions remain visible in their original records.


## Inspect the completed application before delivery

Before presenting the completed application or its reports as ready, open the exact outgoing version with the populated customer workspace, look at its rendered screens or real screenshots, and operate the important controls. Review the screenshare width and relevant narrow/mobile width, empty, loading and error states, downloads, exports and reopening. Fix unreadable, clipped, overflowing, unstyled or broken output in the same application. Capturing screenshots without viewing them, source review and HTTP responses do not replace this inspection.

Use plain industrial presentation: readable tables, clear hierarchy, consistent typography and spacing, restrained controls and useful labels. Keep the original workflows and computations. Continue through observed repairs and the existing receiving programme; use focused checks rather than a broad suite. Carry this requirement into delegated receiving work and any standalone application handoff. This implements the repository's owner-directed rendered-product inspection instruction, version 2026-10-13.1.
