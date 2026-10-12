# Accounting return receiving

This is the per-row accounting and deposit return workspace for the existing Berkeley cashiering product. Open **/cashiering/receiving/** on the original local server. It uses the same permitting/cashiering SQLite database, original prepared CSV artifacts, financial editions, document captures, staff names and saved request journal.

The complete upstream operating and source contracts are [WORKFLOW.md](WORKFLOW.md), [API.md](API.md) and [SOURCE_CONTRACT.md](SOURCE_CONTRACT.md). The receiving arm completes the row-level prepared-versus-returned comparison specified there. The receiving layout comes from the actual returned source and the implementation partner's supplied field definitions.

## Staff workflow

1. **Select the exact prepared exchange.** The selector identifies its original financial run, export, profile version, byte hash and prepared row count. Download the unchanged prepared CSV or read all its original rows. A financial correction creates a later financial edition; an earlier prepared exchange keeps its original interpretation and source identity.
2. **Retain the complete returned CSV or JSON.** Supply its native batch/report reference, source system, report family, original observation time with UTC offset, actual snapshot/event meaning, coverage and receiving note. You can reuse a document already retained by the same workspace. Original file bytes, large identifiers, decimal lexemes and source row types remain available.
3. **Confirm an interpretation.** Choose exact prepared/returned key column pairs, the native status labels, native event/reference/error fields and any supplied per-row observation clock. The interface can page through every distinct source status. Optional amount comparison requires explicit original amount columns, major/minor units, currency bindings, total/event meaning and contributing statuses. Save draft editions while clarifying the layout; select an exact confirmed mapping edition for comparison.
4. **Save a comparison.** Select each original returned source and its confirmed mapping version. The comparison retains the original prepared profile, financial currency scales, complete returned population and source-specific interpretations. Later mappings do not silently replace an earlier selection.
5. **Work the exceptions.** Page and search prepared rows, original returned observations and findings. Open the complete selected row, download its source, and follow its linked prepared/returned identities. An explicit assignment or exclusion records both original identities and the named explanation. Retiring an assignment retains its earlier meaning and reason.
6. **Review the exact edition.** Findings support open, investigating, accepted difference and resolved decisions with staff names and notes. A review decision records the exact input, computed comparison and finding-review hashes. Source or review changes leave earlier decisions visible with their original binding.
7. **Deliver the whole handoff.** Save a receiving ZIP, download every row family and full JSON, and retain the complete editable workspace backup. The original financial packet also includes the complete selected receiving comparisons and their actual returned documents. Reopen the database or an exact earlier receiving edition to continue.

A finding review records a staff disposition; the native returned status, original amount and prepared financial close retain their own identities. Report families and currencies are presented separately. Missing observations have explicit denominators rather than becoming returned zero amounts.

## Original data and comparison rules

- Every prepared row is identified from its actual retained artifact, artifact SHA-256, ordinal and complete original CSV values. Headers, delimiter, header presence, row count and retained export/profile/financial metadata are checked together.
- A returned observation binds the full captured file SHA, source ID, original record number, original values and original scalar types. Its interpretation separately records the selected mapping edition and mapping SHA.
- Automatic matching uses only the configured exact native key tuple. Missing keys, repeated prepared keys and unmatched returned keys remain visible. No date or amount proximity match is inferred.
- CSV values remain text. JSON numeric lexemes are retained as source text with original type metadata. Monetary arithmetic uses the financial engine's exact signed integer minor units under the original currency scales.
- Original observation times require an explicit timezone/UTC offset. A supplied per-row time is interpreted explicitly. An invalid clock remains unsupported rather than falling back to the upload time.
- The latest selected snapshot in a source family supplies current observations. Earlier snapshots remain in the complete rows and source history. Concurrent snapshots and mixtures of snapshot/event semantics produce findings. A mixed family's expected amounts remain visible, while returned amounts and differences stay unavailable until the selected source modes are separated.
- Reported row totals use the latest original observation point. Incompatible amount interpretations, currencies or equally current conflicting values remain unavailable for aggregation.
- Incremental event amounts require native event IDs. Identical repeated native events remain visible and contribute once. Native event meaning uses the original fields, prepared target, interpreted status/amount/currency and an explicitly mapped native timestamp. Each source report's observation time remains separate for latest-status display. Conflicting event identities, including a shared ID attached to different prepared rows, produce findings and do not supply a usable amount.
- Prepared and known returned amounts are separate by source system, report family and currency. Every total gives prepared rows, rows with usable returned amounts and rows without them.
- Manually assigned rows preserve their original values and the complete assignment history. An assignment to a source no longer selected becomes a retained stale-assignment finding.
- Native row calculations are retained once per complete input signature and indexed in SQLite. Normal paging and finding review use the retained population. They do not reread and recalculate all the source files on every page.

## Browser drafts and original-request recovery

The page is mounted at both /cashiering/receiving and /cashiering/receiving/. Both addresses use the same stable database identity and browser storage namespace.

Drafts, selected original file bytes and complete original requests are retained in IndexedDB. This supports the original 25 MiB capture limit without placing base64 source bodies in localStorage. The original file hash and complete bytes travel with the pending capture request.

Before a write starts, the browser durably retains its complete action, payload, original UUID, original global revision and receiving workspace identity. It reads the committed original request and verifies its request hash before clearing the pending state. The original Cashiering transaction stores the business mutation and request response together.

If the response is lost:

1. Open **Original saved request** and choose **Read original result**.
2. A committed request reopens its original saved source/comparison. Its UUID and payload are preserved.
3. If the original result is absent, **Continue original request** submits those same retained inputs and UUID.
4. A definitive local validation or stale-edition rejection preserves the edited form, records that the attempt was unsaved and allows a new reviewed request.
5. Drafts prepared against an earlier receiving version retain that version. **Use these edits with the current edition** explicitly carries the reviewed form forward after inspecting the current source and finding context.

Browser request downloads can be applied by the installed CLI. The complete envelope's original UUID and request SHA are checked before it enters the existing Cashiering request transaction. The browser's completed request list includes the most recent 50 summaries; complete original request records remain in that workspace's browser storage.

A received full database backup retains the same receiving workspace identity, sources, mappings, saved requests and editions. Distinct databases created independently have distinct identities. Server GET/POST and CLI routes carry the original identifiers.

## Same-database implementation

The additive modules are:

| Component | Responsibility |
|---|---|
| receiving_model.py | Exact prepared/returned identity, source modes, clocks, statuses, event identity, amounts and findings |
| receiving.py | Same-database sources, mapping editions, retained indexed analyses, version guards, staff review, source integration and read routes |
| receiving_report.py | Full receiving JSON/CSVs, original bytes, grayscale report and portable source package |
| receiving_cli.py | Installed original database operation, exact request preparation/replay, reads, backup and restore |
| public/receiving.html, receiving.mjs, receiving.css | Mounted staff workspace, complete source views, retained forms, request recovery and delivery |

Cashiering initializes the additive tables in the existing database. All receiving writes execute through Cashiering.write and its existing BEGIN IMMEDIATE, global revision and cash_requests transaction. Original financial run source/edit revisions and close signatures are not advanced by a receiving observation. Receiving maintains its own saved comparison versions and immutable edition IDs.

The mounted host serves only the explicit receiving static filenames. It uses the existing workspace token and URL/host checks. Cashiering read dispatch and original financial packet preparation compose the receiving arm through narrow existing hooks.

## Reading the complete retained state

Receiving routes use the original server and JSON response envelope. Query arguments are ordinary URL parameters.

| GET route under /api/cashiering/receiving/ | Complete retained result |
|---|---|
| state?run_id=…&export_id=… | Stable workspace ID, original prepared exports, returned sources, confirmed mapping catalog and saved comparisons |
| requests/UUID | Original request identity/hash, whether it committed and its saved response |
| exports/EXPORT_ID?run_id=…&offset=0&limit=100 | Original prepared profile, currency scales and exact prepared row page |
| sources/SOURCE_ID?mapping_version=N | Original file identity, selected mapping, all mapping editions and preview |
| sources/SOURCE_ID/rows?offset=0&limit=100 | Complete original returned records by page |
| sources/SOURCE_ID/values?column=STATUS&offset=0&limit=100 | Exact source values and counts for the selected original column |
| runs/RECEIVING_ID | Current comparison metadata, exact edition ID and source/review binding |
| editions/EDITION_ID | Metadata for the selected saved edition |
| runs/RECEIVING_ID/history | All saved editions of the comparison |
| editions/EDITION_ID/prepared | Prepared row page |
| editions/EDITION_ID/observations | Returned observation page |
| editions/EDITION_ID/findings | Finding page and its saved review |
| editions/EDITION_ID/FAMILY/ROW_ID | The complete exact original selected row |
| editions/EDITION_ID/json | Full receiving document, every row and history through that edition |
| editions/EDITION_ID/report | Complete staff report with bounded display tables and full export references |
| editions/EDITION_ID/prepared.csv | All prepared records |
| editions/EDITION_ID/observations.csv | All original returned observations |
| editions/EDITION_ID/findings.csv | All findings and their saved review |

Row pages accept offset, limit (1–500), query and exact status/code filters. Finding pages also accept review_status. The browser pins row pages and downloads to the exact saved edition ID so a concurrent update cannot mix populations between pages.

The prepared artifact is /api/cashiering/artifacts/ARTIFACT_ID. The unchanged returned document is /api/cashiering/captures/DOCUMENT_ID/download. Complete database backup remains /api/backup. Saved receiving ZIPs use the same original artifact route.

The report displays up to 200 rows from each large row family with its actual total and complete-file references. CSV and receiving.json retain every selected row. A human-readable CSV protects spreadsheet formula/large-identifier interpretation; the original source bytes and full JSON keep the source values.

## Write contract

POST actions remain /api/cashiering/ACTION. Every receiving write requires:

- request_id: the original canonical UUID
- revision: the observed original workspace revision
- receiving_workspace_id: the stable ID returned by receiving/state
- owner: the named operator
- note: the retained explanation

| Action | Additional fields |
|---|---|
| receiving-capture | run_id, export_id, metadata and exactly one document_id or filename/content_base64/captured_at |
| receiving-mapping | source_id, mapping_version (current mapping version), mapping, confirmed |
| receiving-compare | run_id, export_id, label, sources |
| receiving-refresh | receiving_id, receiving_version, sources, optional label |
| receiving-assign | receiving_id, receiving_version, observation_id, prepared_id or excluded:true |
| receiving-assignment-retire | receiving_id, receiving_version, assignment_id |
| receiving-review | receiving_id, receiving_version, finding_id, status |
| receiving-decision | receiving_id, receiving_version, status, statement |
| receiving-packet | receiving_id, receiving_version, label |

Each sources binding is exactly {"source_id":"…","mapping_version":2}. Source metadata contains source_system, report_family, native_reference, observed_at, mode ("snapshot" or "events"), complete (boolean) and note.

A confirmed mapping contains keys (prepared/returned column pairs), status_column, status_map (exact native values to accepted/rejected/posted/pending/void/unknown), optional event_id_column/reference_column/error_code_column/error_message_column/observed_at_column, amount and note. Empty optional columns mean absent source fields.

The optional amount object contains prepared_column, returned_column, prepared_mode, returned_mode, prepared_currency, returned_currency, value_basis and included_statuses. Currency bindings are exactly {"column":"…"} or {"literal":"USD"}. Major/minor and reported_total/incremental_events are explicit choices.

## Installed CLI

Use the repository's complete product source and the original existing database. Paths below stand for the operator's actual retained files.

~~~bash
python -B cashiering/receiving_cli.py --db /private/original-workspace.sqlite state --out /private/receiving-state.json

python -B cashiering/receiving_cli.py --db /private/original-workspace.sqlite request \
  --action receiving-capture --payload /private/reviewed-capture-fields.json \
  --original /private/original-accounting-response.csv \
  --out /private/original-capture-request.json --apply \
  --result-out /private/original-capture-result.json

python -B cashiering/receiving_cli.py --db /private/original-workspace.sqlite apply \
  /private/original-capture-request.json --out /private/original-capture-result.json

python -B cashiering/receiving_cli.py --db /private/original-workspace.sqlite recover \
  ORIGINAL_UUID --out /private/original-recovered-result.json

python -B cashiering/receiving_cli.py --db /private/original-workspace.sqlite read \
  editions/ORIGINAL_EDITION/observations --query '{"offset":0,"limit":100}' \
  --out /private/returned-page.json

python -B cashiering/receiving_cli.py --db /private/original-workspace.sqlite read \
  /api/cashiering/artifacts/ORIGINAL_PACKET_ARTIFACT \
  --out /private/Accounting_Return_Handoff.zip

python -B cashiering/receiving_cli.py --db /private/original-workspace.sqlite backup \
  --out /private/complete-receiving-workspace.sqlite

python -B cashiering/receiving_cli.py --db /private/reopened-workspace.sqlite restore \
  /private/complete-receiving-workspace.sqlite
~~~

The request command accepts action-specific fields and captures the current original global revision, workspace ID and UUID before writing the complete request file. Supply mapping_version or receiving_version from the exact reviewed source/comparison. Apply reuses the original complete request. It accepts either the CLI's {action,payload} file or the complete browser request envelope.

CLI outputs are durably published with their exact byte count/hash. An existing different destination is preserved. The original request file remains usable if the operation commits but later output publication is interrupted. Restore requires a new destination and uses the maintained original workspace backup/restore operation.

## Existing Berkeley receiving custody

The original daily cashiering operating run remains the 82E4-owned case and database. Its existing native and browser continuations are the source for adopting this additive receiving arm. Original prepared exports and close records are reused. Controlled operating examples retain their actual source labels and do not replace a customer/vendor returned original.

Complete operating artifacts belong with that same original case and delivery. A generated database or returned source containing customer information belongs in the original private delivery surface. Maintained software and explicitly labeled example inputs remain repository source.

## Continue the saved original worked example

The complete original operation is in `examples/operate_original_receiving.py`. It accepts the retained 82E4 database, the complete source directory and a private output directory. It selects the already saved run and exact prepared exchange, keeps their identities, receives complete labeled example return files, retains all mapping and review editions, produces the existing financial handover with its receiving rows, and reopens the full database backup. Its original UUIDs support request replay.

~~~bash
python -B cashiering/examples/operate_original_receiving.py \
  --db /private/original-82e4-workspace.sqlite \
  --source-dir /private/berkeley-clariti-32600118-20261010 \
  --source-pin CURRENT_SOURCE_COMMIT \
  --root /private/original-row-receiving
~~~

Use the original browser operation to open `/cashiering/receiving/` on that same saved workspace and select the returned receiving ID from `result.json`.

Browser drafts retain immutable draft IDs in the exact original request. A completed request clears only its submitted draft; later edits retain their own source/comparison context and require reconciliation against a newer edition. Original row selection uses separate generations for each assignment endpoint and the visible row, so response ordering preserves the operator's latest selection.

The host prints its actual bound loopback URL, including when `--port 0` selects an available port.
