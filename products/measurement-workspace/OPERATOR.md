# Measurements: operator guide

The installed Measurements product connects the existing scientific workspace to Applications, the command line and the Merchant agent. They operate the same original records, intake editions, reviews, studies, reports and receiving functions. The native Node/SQLite service remains the scientific authority.

## Open the selected workspace

Use the existing Runtime build/install workflow to select the complete Measurements source, then the managed Applications entry to start and open its configured workspace. Keep the source manifest, managed configuration and connection receipt with that installation. The browser opens the original Measurements interface. Its native intake, reconciliation, flow studies, observed benchmarks, source handback and large-file controls remain available.

The managed connection identifies the physical workspace directory, its native workspace ID, the selected source manifest, the reviewed configuration and this particular running instance. A new process has a new instance ID. An independently received copy may retain the native project identity while having a different physical workspace binding. Treat those as separate destinations.

Applications Open supplies browser authentication through a local, per-instance session. An agent uses the token environment name recorded in its private connection receipt. Keep token values out of URLs, command arguments, source repositories and handover reports. Use the normal managed start/stop operation so the original child and accepted work drain together.

## Keep three locations

| Location | Contents | Operator rule |
| --- | --- | --- |
| Scientific workspace | Original native database, source files, studies and scientific history | Keep it under the native workspace owner. |
| Input directory | Complete operation JSON and original selected source documents | Configure file aliases; inspect and pin exact input bytes before dispatch. |
| Client custody directory | Original requests, response bytes, headers and interrupted attempts | Use a separate absolute owner-only directory outside all scientific workspaces and input files. |

Connection/configuration files are owner-only regular files. Client files are create-only: writing the same bytes to an existing destination is an exact recovery; different bytes require a new destination. Use absolute paths without symlink traversal. Keep the full custody directory when handing an interrupted operation to another authorized operator.

## Configure the client

The installed command is `starforge measurement-workspace-client`, forwarding the original `products/measurement-workspace/client-cli.mjs`. The examples below use the direct source invocation, which also works from the corresponding complete installed source root.

Choose an alias such as `study`. The managed service supplies a complete connection JSON file; record its SHA-256 from that file. Prepare an input-alias document containing actual absolute file paths, for example:

```json
{
  "reviewed-import": "/srv/measurements-input/import-operation.json",
  "benchmark-save": "/srv/measurements-input/benchmark-save-operation.json"
}
```

Those names are examples. Each referenced file must already contain the actual complete operation selected by the operator. Create the private configuration with a fresh output receipt path:

```sh
node products/measurement-workspace/client-cli.mjs configure \
  --config /srv/measurements-client/connections.json \
  --workspace study \
  --connection /srv/measurements-control/connection.json \
  --connection-sha256 ACTUAL_CONNECTION_SHA256 \
  --exports-directory /srv/measurements-custody \
  --label "Selected measurements study" \
  --inputs /srv/measurements-input/aliases.json \
  --out /srv/measurements-client/configuration-receipt.json
```

Replace the explicit digest placeholder with the actual 64-character digest. The process environment must supply the token under the receipt's exact `tokenEnv` name. Configuration publication validates the connection and declared custody before writing. Its `connectionText` field retains the exact non-secret original receipt bytes and digest, so historical request/status/download access remains usable after normal Stop removes the active receipt; network dispatch still requires the current live file and authenticated identity. If configuration publication itself was interrupted, repeat the exact original `configure` invocation with its original connection file and output path; the create-only publisher repairs its own interrupted temporary link before reusing the identical file. To change a configuration, create a reviewed successor file instead of overwriting the old one. Preserve the old configuration alongside any requests made through it.

Run `catalogue --config ... --out ...` to save the current workspace aliases, connection identities and native operation catalogue. The catalogue is the authoritative list of operation names and parameters for the selected source.

## Read and retain the actual result

A transport request UUID identifies one original request and its retained result. Generate and retain it before calling the client. The following placeholders deliberately require your actual UUID and paths:

```sh
node products/measurement-workspace/client-cli.mjs read \
  --config /srv/measurements-client/connections.json \
  --workspace study --operation summary \
  --request-id ACTUAL_TRANSPORT_UUID \
  --out /srv/measurements-client/summary-receipt.json

node products/measurement-workspace/client-cli.mjs download \
  --config /srv/measurements-client/connections.json \
  --workspace study --request-id ACTUAL_TRANSPORT_UUID \
  --part response \
  --out /srv/measurements-downloads/summary.json
```

The first output is a client receipt. The second is the full original HTTP response body. Reusing the same UUID returns the first complete observed result; use a fresh UUID when you want a new live read. A completed HTTP error also remains the original completed result. Inspect both its HTTP status and native response body.

GET operations with parameters accept `--params` pointing to a complete JSON file. Use the original IDs returned by the native catalogue. For paged record/export lists, follow the native total/offset/limit values and retain each page. Use the full snapshot or portable export when the task calls for the entire project.

## Submit an authored native operation

An input file has exactly `operation`, optional `params`, and the complete native `body` for a non-GET operation:

```json
{
  "operation": "intake-import",
  "params": {"id": "ACTUAL_SAVED_PREPARATION_ID"},
  "body": {
    "revision": 1,
    "previewSha": "ACTUAL_PREVIEW_SHA256"
  }
}
```

This is a structural example, not a ready-to-send import. Take the real ID, saved revision and preview digest from the selected preparation. Keep all authored body fields required by that original operation.

1. Save the complete operation under a configured input alias.
2. Run `inspect` with `--workspace`, `--input`, `--config` and a fresh `--out`. Read its actual digest, native route, effect and replay rule.
3. Retain a new transport UUID.
4. Run `execute` with that alias, the inspected `--sha256`, the retained `--request-id` and a fresh output receipt.
5. Download and inspect the complete response. Continue the same native workflow using its returned identities.

The client saves the full original input and request identity before network dispatch. It does not replace native revision checks or native request identifiers. A transport UUID and a benchmark body's `request_id` serve different purposes; preserve both.

## Complete scientific work

### Original source intake

Receive the complete original chemistry, station or daily-discharge file. Use guided inspection to see original headers, interpreted fields, rejected rows and the native preview. Save the named preparation with its reviewer, context and mapping. Preview that saved edition, then import its exact revision and preview digest. The saved preparation remains available with its original text, edition history and import receipt. Current guided intake also preserves the original workbook-to-worksheet lineage: use `intake-source-lineages`, `intake-original` and `intake-validate-working` to inspect that exact original and validate the full authored working input. Keep those complete originals when copying or receiving a preparation.

The original provider-query operation constructs a source query. The original provider-fetch operation obtains the provider response and native preview; it does not import it automatically. Retain the returned complete source and select the appropriate native intake/import action after review.

### Reconciliation and observed benchmarks

Review logical-result variants and source membership before making selections. Reconciliation decisions and frozen reports remain in the native workspace.

For an observed benchmark, author the actual authority/reference, cohort, station and date selection, parameter, unit/basis/fraction requirements, comparison operator, threshold, period and required sample support. Inspect the entire row and period results, including censored intervals, unresolved variants and unallocated samples. Save the exact preview against its original workspace revision. The saved study retains its definition, selected source snapshot and attribution.

Download the full HTML report, rows CSV, periods CSV and complete benchmark project. The original benchmark draft and pending-request functions keep an interrupted edit recoverable. Use the native request receipt and atomic abandon operation when retiring an unapplied save; an absent GET response alone does not establish that a competing save cannot complete.

### Flow and paired loads

Select complete original daily-discharge sources, their explicit series and time interval, and authored station/sample relationships. Review missing, ambiguous, provisional and unquantified days. Save the preview identity as `expected_id` for flow/load saves. Preserve that field on any supported exact retry.

The native study retains source dates, qualifiers, calendar coverage and discrete sampling context. Download the complete study/load bundle and all applicable daily, period, sample, context and annual outputs. Do not infer a spatial relationship or a regulatory benchmark from a convenient nearby source.

### Complete source handover

Collections preserve original inputs and companion files alongside native imports. Publish a selected collection edition or source handback from the reviewed native state. Keep the whole edition, its original members and its manifest. The portable workspace, collection edition, source handback and large-file edition are different native receiving formats; use the receiving route matching the original format.

For large input/output, use the existing large-intake, chunk, preparation, commit and edition operations. Keep their original IDs and offsets. Read back native progress before continuing an interrupted upload. The client streams responses to disk; the configured complete-response limit defaults to 1 GiB and can be explicitly set up to 8 GiB. An operation JSON input is limited to 128 MiB, so chunked native intake is the appropriate route for larger material.

## Recover a lost or interrupted call

Run `status` with the original workspace alias and transport UUID before sending anything again.

| Phase | Meaning | Continue |
| --- | --- | --- |
| ABSENT | No retained request was found in this custody directory | Confirm the original configuration, alias and directory before creating another request. |
| PREPARED | Original input/request exists without an observed dispatch marker | Continue the exact original invocation; preserve its UUID and input digest. |
| UNKNOWN | Dispatch may have occurred; no complete accepted response was selected | Inspect the retained attempts and original native result. |
| COMPLETED | One full HTTP result was retained and verified | Download it. Check status and native body before deciding what follows. |

Use `file-info` or `download` with `--part input`, `request`, `receipt` or `response`. For an interrupted attempt, supply its actual `--attempt` UUID and select `headers`, `error`, `dispatch`, `attempt-receipt` or `response`. A partial response is preserved as observed bytes; it is not a complete native result.

Only explicitly retry an unresolved request with `--retry true` when the inspected original route supports `read` or `exact` replay. Keep the same input, transport UUID and native request identity. For legacy mapping/review, collection publication, handback, whole-workspace receive and other `never` routes, first inspect the actual native state and determine whether the original action completed. Do not replace the old request with a new UUID merely to get past its uncertain state.

After a managed restart, review the new connection receipt and create a successor client configuration. Keep the original custody directory so historical request/status/download access survives. The old transport UUID remains bound to its original connection; do not reuse it to dispatch through the successor instance. Reconcile the native outcome first. If an original native operation supports exact recovery across restart, preserve its native request identity in the deliberately selected successor transport request. A new service instance is not evidence that an old write failed.

A successful whole-workspace receive may replace the initially empty destination's native intake UUID. Retain its complete receiving response. The existing connection then reports an identity change; use the original Applications Stop, Review and Start workflow to obtain a new connection bound to the received project. This is the receiving continuation, not a reason to repeat the receive.

## Merchant agent tools

The configured Merchant operator exposes eight tools:

- `merchant_measurement_workspaces`: inspect configured workspace aliases and available operations.
- `merchant_measurement_input_inspect`: inspect the complete configured input and obtain its digest.
- `merchant_measurement_read`: perform a declared native read.
- `merchant_measurement_execute`: dispatch a pinned complete input operation.
- `merchant_measurement_request`: recover the original transport request status.
- `merchant_measurement_file_info`: inspect a retained original part.
- `merchant_measurement_file_read`: read a retained part through the configured file interface.
- `merchant_measurement_file_release`: release the selected complete retained file.

Use the tool's actual schema for arguments and follow its returned file size/progress when reading complete material. Host configuration chooses paths and token names. Agent arguments select aliases and original IDs.

## Finish and hand over

Keep the selected source manifest, installation and managed configuration, connection receipt, full scientific receiving package, actual reports, original input files and relevant client custody together. Use [RECEIVING.md](RECEIVING.md) to reopen that full delivery in a separate recipient workspace.

The producing operator must open and operate the exact outgoing product, inspect desktop and narrow layouts, use its final downloads and attachments, and reopen its editable project. Record the actual resulting source/project identities and observations. Source inspection or a command that never started cannot establish a rendered or native operating result.

## Standing rendered-product and attachment instruction

Source: Bryce's standing instruction, revision `rendered-product-inspection-20261013-all-attachments-v1`; original Commons source blob `e692a3f2af3189bd2f7724e3013e646f7431bbd8`.

Before calling any client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing peer must actually open, run or render the exact outgoing version, LOOK at the actual screen or real screenshots, and operate the important controls. Check screenshare and relevant narrow/mobile widths; populated, empty, loading and error states; downloads, exports and reopening. Capturing screenshots without viewing them is insufficient. Repair ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized product. Code review, DOM counts, HTTP 200, tests and peer approval cannot replace seeing the product.

ALL ATTACHMENTS count. Literally open, view, play and use every final HTML, PDF, report, slide deck, spreadsheet, map, image, video, audio, archive and project as a recipient. Extract archives and open the contained deliverables and working project. Tests, checklists and captured-but-unseen screenshots are no substitute. Use available high-quality generative media and natural voice generation/TTS for videos rather than robotic default voices. Watch and listen to the final export for pronunciation, pacing, timing and audio alignment.

Keep building and fixing; inspection is not performance theatre. Use plain industrial design: readable tables and hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve the real workflows, data and computation. Reviews lead directly to repairs and do not replace implementation or integration, become a separate verification product, or turn into endless rechecking. Use focused validation, not broad suites. Empty scientific Workspace images are not completed-product acceptance.

Persist the complete rule into every active owned instruction surface actually consumed: global/project AGENTS, CLAUDE, GEMINI/rules, provider boot, Commons/source/cloud mirrors and current build/receiving guides. Every child assignment carries the complete rule, including all attachments and final media. Return exact paths, versions and readback; a Slack acknowledgment alone is insufficient. Preserve owner controls, historical evidence and third-party/vendor policies. Do not force restarts, add watchers or revive owner-stopped work. Continue the original scientific, run, browser, receiving, source, native, runtime and archive owners. The Ecosystem October 13 10 a.m. EDT/14:00 UTC cutoff belongs to that project; it does not expire this standing rule or other projects' schedules. The canonical machine policy files retain their original Root owner. Portable publication does not claim that another host has been updated.

Source engineering and integration may be complete while actual native and rendered readiness remain unclaimed. Continue through the existing authorized operating owner and actual available equipment; this instruction does not create a new controller or permission gate.
