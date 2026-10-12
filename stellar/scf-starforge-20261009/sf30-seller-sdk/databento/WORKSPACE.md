# Databento historical migration workbench

This module keeps native acquisition, complete source editions, operator decisions, and customer delivery in one practical workflow. The acquisition client uses the original Databento SDK for account operations. The workbench uses the existing retained Python merchant workspace for source history, previews, releases, customer exports, and portable reopening. The processor streams every selected source record and writes complete data files outside the native function response.

## Entry points

| Entry | Purpose |
| --- | --- |
| acquisition.py | Account-bound estimates, one selected batch submission, same-job receiving, original DBN decoding, exact source retention, complete partitions, and source packet export. |
| workbench.mjs | Create or reopen the original Python workspace, serve the operator UI, forward original workspace commands, and deliver the selected saved build. |
| processor.py | The same source assessment used by previews and the full streaming export command. |
| application.py | Original merchant function exports: inspect_migration, build_migration, customer_migration. |
| CORE_CONTRACT.md | Exact source, field, review, report, and streaming delivery contracts. |
| README.md / UI.md | Core behavior and the complete operator interface. |

Run acquisition with Python 3.10 or newer and the original compatible SDK pair, databento 0.87.0 and databento-dbn 0.70.x. Account commands use the SDK's declared HTTP dependencies. The native DBN decoder is the original extension from that pair; offline decoding does not import the HTTP client.

The workbench requires Node 22.13 or newer because the original workspace uses built-in node:sqlite. Its --source-root points to the original repository root or the installed package's source directory. Omitting it derives that same root from this module's location. It never modifies the installed package.

All acquisition-wide options appear **before** the command. Workbench options appear **after** its command. No API key is passed as a command argument.

## 1. Select the original account and gateway

Keep the acquisition directory separate from the publishable source packet and merchant workspace. It contains original account responses and authenticated download metadata and is created with private directory/file permissions.

Use an existing environment variable:

~~~sh
python acquisition.py --store ./private-acquisition \
  --key-env DATABENTO_API_KEY \
  --gateway hist-preview.databento.com \
  estimate --id preview-mbo-estimate --request ./preview-mbo-request.json
~~~

Alternatively, select an existing mode0600 key file with --key-file. Do not put the key in a request JSON, source descriptor, operation ID, UI file, or shell argument.

Omit --gateway for the SDK's original historical default. The first-party migration announcement identifies hist-preview.databento.com and shows it directly in db.Historical(gateway=...). The client forwards the selected gateway through that original constructor. An operation's selected account and gateway remain bound to the original request; the same ID cannot switch from production to preview.

The September 30, 2026 announcement schedules the historical cutover and preview closure for October 31, 2026. Preview requests use the same usage pricing and applicable US Equities plan coverage as historical requests. Refresh that original source when scheduling a customer cutover; the client does not treat preview as a free data service.

A request plan contains the original SDK fields, for example:

~~~json
{
  "dataset": "XNAS.ITCH",
  "symbols": ["NVDA"],
  "schema": "mbo",
  "start": "2025-09-16T08:00:00Z",
  "end": "2025-09-16T13:30:00Z",
  "stype_in": "raw_symbol",
  "stype_out": "instrument_id",
  "encoding": "dbn",
  "compression": "zstd",
  "pretty_px": false,
  "pretty_ts": false,
  "map_symbols": false,
  "split_symbols": false,
  "split_duration": "day",
  "delivery": "download"
}
~~~

These are example selection fields, not a completed customer purchase. Set the real agreed symbol, dataset, schema, and window before running account commands. Start is inclusive and end exclusive; the native batch API filters on ts_recv when that field exists, otherwise ts_event. Integer time selections are Unix nanoseconds. The account client preserves exact native response bodies before the SDK interprets their JSON.

Optional limit remains an explicit native record limit. It must not be described later as full-window coverage. Native split_size is a batch-file option measured in bytes; the original API documents 1–10 GB. It is separate from the much smaller source-file cap in the merchant workspace. Use a real complete interval or binary gzip when preparing workspace inputs.

The client preserves exact cost lexemes as Decimal-compatible strings. The estimate retains native available range, record count, billable bytes, cost, and the original request selection.

## 2. Submit once, observe, and receive the same job

Submit only the reviewed estimate and explicit USD cap:

~~~sh
python acquisition.py --store ./private-acquisition --key-env DATABENTO_API_KEY \
  --gateway hist-preview.databento.com \
  submit --id preview-mbo-submit \
  --request ./preview-mbo-request.json \
  --estimate-id preview-mbo-estimate --max-cost-usd 12.00
~~~

The example cap is an operator-selected ceiling, not an estimate or a promise about provider charges. The client gets a fresh native cost for that same account, gateway, and request before issuing the original submit_job once. A higher current cost returns COST_EXCEEDS_SELECTION without submitting.

Each native operation has an explicit ID and immutable request hash. A repeated completed command returns its original retained result. A started batch POST is never automatically repeated after a lost connection or process exit. If the complete original acknowledgement was captured, the client recovers its original job ID. Otherwise, inspect the native job list and select the actual job:

~~~sh
python acquisition.py --store ./private-acquisition --key-env DATABENTO_API_KEY \
  --gateway hist-preview.databento.com \
  jobs --id preview-jobs-observed-1 --since 2026-10-12T00:00:00Z

python acquisition.py --store ./private-acquisition --key-env DATABENTO_API_KEY \
  --gateway hist-preview.databento.com \
  job --id preview-job-details-1 --job-id ORIGINAL_JOB_ID

python acquisition.py --store ./private-acquisition --key-env DATABENTO_API_KEY \
  --gateway hist-preview.databento.com \
  reconcile --id preview-mbo-submit --job-id ORIGINAL_JOB_ID \
  --reviewer customer-operator
~~~

Reconcile compares the exposed original selection fields, binds the selected original job, and records the reviewer and any fields the provider did not expose. It does not call submit_job. A different exposed dataset, schema, encoding, symbology, time selection, symbol selection, or limit fails instead of silently substituting another job.

The list command deliberately omits the deprecated short parameter. The original SDK supports get_job_details separately, and this client uses that endpoint for full selected job state. A list or detail operation is a retained observation: choose a new read ID when asking for a fresh observation.

Receive into the same private operation directory:

~~~sh
python acquisition.py --store ./private-acquisition --key-env DATABENTO_API_KEY \
  --gateway hist-preview.databento.com \
  receive --id preview-mbo-files --job-id ORIGINAL_JOB_ID
~~~

Use repeated --filename options to select particular original manifest files. Otherwise, every listed file is received.

The original SDK downloads each selected file into downloads/ORIGINAL_JOB_ID/FILENAME. Its native Range handling continues an incomplete file at the retained byte offset. The wrapper verifies the complete original manifest size and hash before recording it as completed; an SDK checksum warning alone does not mark the file complete. A failed or interrupted receive preserves the same partial bytes for continuation.

If a job has not exposed files yet, the same receive operation can make a later read of that job. Once the available original manifest is selected, subsequent receiving uses that retained file selection. A complete-size file with the wrong digest remains preserved; select a new receiving operation for the same already-submitted job. No new paid batch submission is required.

The client retains full original HTTP bodies and headers in private calls/. response.content is captured before SDK JSON interpretation; it is explicitly identified as the native HTTP client's decoded response body, not an invented transport-byte claim. Selected summaries and source handoffs exclude the account binding, credentials, raw response headers, and authenticated download URLs.

## 3. Decode original DBN or retain existing exact source

The native decoder preserves the original DBN record version with VersionUpgradePolicy.AS_IS. It uses the original Transcoder and DBNDecoder together, requires complete decoder buffers, and preserves nested hd/levels structures. It disables pretty price/time conversion and automatic symbol insertion. Original timestamps and integer prices remain the native JSON number strings.

~~~sh
python acquisition.py --store ./private-acquisition \
  decode --id preview-mbo-decoded --from-id preview-mbo-files \
  --source ./private-acquisition/operations/preview-mbo-files/downloads/ORIGINAL_JOB_ID/FILENAME.dbn.zst
~~~

The completed operation contains the exact content-addressed JSONL projection and a separate original metadata source. That metadata retains DBN version, dataset, schema, original start/end/limit, stype values, symbols, partial/not-found lists, and original symbology intervals. The source descriptor binds the original DBN file's complete SHA256/byte count and native decoder versions. The original DBN remains in receiving custody. --from-id binds this source to the completed receiving operation's exact file, original job, selected gateway, and safe full-job view; those original identities continue into the source packet. The same optional linkage is available on retain and partition when their input comes from an existing retained source operation.

For existing CSV, JSONL, or JSON, provide the original core source descriptor:

~~~json
{
  "id": "customer-mbp1-source",
  "format": "csv",
  "kind": "records",
  "role": "primary",
  "dataset": "XNAS.ITCH",
  "schema": "mbp-1",
  "encoding": {
    "prices": "decimal-fixed9",
    "timestamps": "iso8601-nanoseconds"
  },
  "representation": {
    "sourceKind": "customer-retained-original",
    "sourceUrl": "https://databento.com/"
  },
  "completeness": {"status": "unknown"}
}
~~~

Use the real source URL and completeness from the actual source. The descriptor above only illustrates the field names. A source descriptor may include original corpus metadata and an independently hashed corpus.index.

~~~sh
python acquisition.py --store ./private-acquisition \
  retain --id customer-mbp1-retained \
  --source ./source.csv --descriptor ./source-descriptor.json
~~~

retain copies the original bytes, streams all record rows to establish the count, and verifies an already-stated count. It does not turn unknown completeness into a complete-window claim. If the source is gzip, declare compression:"gzip"; the actual bytes must match that declaration. The exact linked corpus.index is also copied. Its path is resolved from the descriptor's directory or an explicit --input-root.

Use a separate native symbology operation when that is part of the selected integration:

~~~sh
python acquisition.py --store ./private-acquisition --key-env DATABENTO_API_KEY \
  --gateway hist-preview.databento.com \
  symbology --id preview-symbols --request ./symbology-request.json
~~~

The request contains dataset, symbols, stype_in, stype_out, start_date, and end_date. Its dates are the original inclusive/exclusive UTC dates. Those native mappings remain a separate source; they do not rewrite the original record identifiers.

## 4. Prepare a complete natural partition

The private source receiver and standalone processor can retain files larger than the merchant workspace source cap. To include an agreed complete session in a native revision, select the actual half-open interval:

~~~sh
python acquisition.py --store ./private-acquisition \
  partition --id mbo-premarket \
  --source ./original-mbo.csv.gz --descriptor ./original-mbo-descriptor.json \
  --time-field ts_recv --start 2025-09-16T08:00:00Z --end 2025-09-16T13:30:00Z \
  --gzip --max-file-bytes 8388608
~~~

The partitioner streams every input record and records the entire decoded source's byte count, SHA256, and record count. It writes the original CSV header and exact selected logical record bytes, retaining original numeric strings, quoting, and line endings. JSONL rows retain their exact selected bytes as well. The record index records all included original row intervals and whether they are contiguous.

The result binds both the complete input corpus identity and the complete decoded selected partition identity. Gzip is a binary source representation; the wrapper copies it unchanged into the original workspace, and the processor verifies its decoded bytes/hash and gzip completion while scanning.

--max-file-bytes rejects an oversized complete result. It never drops records to fit. Use an agreed smaller natural interval or gzip, or run the complete source through the standalone processor if it is outside native revision limits.

## 5. Export a complete source packet

The acquisition export composes selected **completed** source operations into the exact original core schema. Its selection file supports multiple editions; each has explicit sourceOperations rather than implicit guesses about where a file came from.

~~~json
{
  "title": "Customer Nasdaq historical migration",
  "selectedEdition": "preview-premarket",
  "editions": [
    {
      "id": "production-premarket",
      "label": "Production: agreed premarket window",
      "capturedAt": "2026-10-12T00:00:00Z",
      "role": "baseline",
      "scope": {
        "dataset": "XNAS.ITCH",
        "schema": "mbo",
        "symbols": ["NVDA"],
        "stypeIn": "raw_symbol",
        "start": "2025-09-16T08:00:00Z",
        "end": "2025-09-16T13:30:00Z",
        "timeField": "ts_recv",
        "gateway": "historical"
      },
      "sourceOperations": ["production-mbo-decoded"]
    },
    {
      "id": "preview-premarket",
      "label": "Preview: the same agreed premarket window",
      "capturedAt": "2026-10-12T00:00:00Z",
      "role": "preview",
      "scope": {
        "dataset": "XNAS.ITCH",
        "schema": "mbo",
        "symbols": ["NVDA"],
        "stypeIn": "raw_symbol",
        "start": "2025-09-16T08:00:00Z",
        "end": "2025-09-16T13:30:00Z",
        "timeField": "ts_recv",
        "gateway": "preview"
      },
      "sourceOperations": ["preview-mbo-decoded", "preview-symbols"],
      "compareToEditionId": "production-premarket"
    }
  ],
  "reviews": [],
  "outputColumns": []
}
~~~

Replace the example capture timestamps with the actual retained observation times, and select operations that already exist. A reference sample uses role:"reference". The export does not rename a sample as a customer production or preview response.

~~~sh
python acquisition.py --store ./private-acquisition \
  export --id customer-source-packet --selection ./packet-selection.json \
  --out ./customer-source-packet
~~~

The destination is create-only. A completed packet contains workspace.json, acquisition.json, the full exact captures/ closure, and manifest.json. Duplicate content-addressed source files are copied once; every descriptor and linked corpus index remains bound to its bytes. The acquisition index records the original operation IDs, selected gateways, source IDs, and response identities. Raw private account responses are not part of that output.

Completed exports reopen and verify their original files. An interrupted packet build continues its same retained selection and private staging directory, then publishes the complete directory. It never repeats a provider job.

~~~sh
python acquisition.py reopen --packet ./customer-source-packet

python acquisition.py --store ./private-acquisition \
  reopen --id preview-mbo-decoded
~~~

Both commands operate offline. The packet is directly accepted by workbench create through its workspace.json.

## 6. Create and operate the original merchant workspace

~~~sh
node workbench.mjs create \
  --source-root /absolute/original/source-root \
  --dir ./customer-migration \
  --dataset ./customer-source-packet/workspace.json

node workbench.mjs status \
  --source-root /absolute/original/source-root --dir ./customer-migration

node workbench.mjs serve \
  --source-root /absolute/original/source-root --dir ./customer-migration --port 8431
~~~

--dir is the wrapper's outer operation directory; its retained native store lives in workspace/. Do not pass that nested store as the wrapper's --dir.

The default service name is the valid short original label "Databento migration"; the workspace keeps the complete dataset title. An explicit --plan file may supply label, serviceName, publicOrigin, and the original payment tuple. The native public service name must contain 1–32 printable ASCII characters. The full human title belongs in label.

Without --plan, the declaration is explicitly unconfigured for deployment. Local source previews call the original Python worker; they do not submit a provider job or invoke a signer. A real published service uses the operator's configured public origin and actual deployment/payment settings.

The original authenticated server serves the included UI at /databento-migration/. It preserves the original editor route, authentication, origin checks, CSP, source/revision APIs, and process ownership. The returned operator URL selects the domain UI. --operator-assets can supply an explicit web directory or the original server's asset manifest when needed.

The default declaration contains:

| Function | Operator purpose |
| --- | --- |
| inspect_migration | Stream all selected records, compute the complete assessment, and return one selected page of records, findings, instruments, sessions, changes, or sources. |
| build_migration | Produce complete compact aggregates and seven retained report files. |
| customer_migration | Return five customer report files without private review notes. |

Inspection defaults to 100 rows and accepts at most 250 on a page. That is a presentation page, not the number of records assessed. All selected rows are scanned on each assessment. Full mapped exports use the processor's streaming CLI once, not a loop of preview pages.

The UI retains source edits, explicit source/edition choices, named reviews, output-column mappings, and original completed previews. A preview belongs to its saved revision and selected edition. Editing current source does not retroactively change an older build.

To access any original workspace command, forward it after --:

~~~sh
node workbench.mjs workspace \
  --source-root /absolute/original/source-root --dir ./customer-migration \
  -- help
~~~

The wrapper supplies the actual retained --workspace path to the original CLI and leaves the remaining original arguments unchanged.

## 7. Deliver a selected saved build and all mapped records

Select the actual completed **build_migration** preview ID shown by the operator. The wrapper uses --preview, not --id:

~~~sh
node workbench.mjs handoff \
  --source-root /absolute/original/source-root \
  --dir ./customer-migration \
  --preview ACTUAL_COMPLETED_BUILD_PREVIEW_ID \
  --out ./complete-operator-handoff \
  --audience operator
~~~

The handoff first verifies the completed preview and its seven original file envelopes. It then reconstructs the exact saved revision attached to that preview, including all binary captures. It invokes that revision's original processor.py export once with the selected edition. Current draft files are not substituted.

The original full export streams complete mapped CSV and NDJSON into customer/. The operator audience also contains complete findings, instrument, session, and change NDJSON files plus the original internal reports. The wrapper verifies the original completed manifest and the byte count/hash of every actual file. Large files are hashed as streams.

The operator handoff adds the original native preview and the full original portable workspace, with history and source, under operator/. It preserves the unchanged processor manifest.json and adds handoff.json tying the output to the exact workspace, revision, preview, source, audience, and files.

The destination is create-only and is published after its complete files and manifests are saved. Repeating a completed handoff verifies the existing original output. If the local process was interrupted before the standalone export completed, the same saved source can regenerate that offline export; it does not submit a native preview, rerun acquisition, or purchase data.

For a customer-only delivery:

~~~sh
node workbench.mjs handoff \
  --source-root /absolute/original/source-root \
  --dir ./customer-migration \
  --preview ACTUAL_COMPLETED_BUILD_PREVIEW_ID \
  --out ./complete-customer-handoff \
  --audience customer
~~~

That bundle includes full customer data and safe reports, with no operator directory, private review notes, native preview dump, or full portable operator workspace.

The original processor's standalone form is also available:

~~~sh
python processor.py export \
  --workspace /absolute/saved/source/workspace.json \
  --edition-id THE_SELECTED_EDITION \
  --out ./complete-data-export \
  --audience operator
~~~

Its completion manifest uses schema tj.databento-migration-delivery.v1, allSelectedRecordsProcessed:true, exact processed/primary/customer/excluded counts, source coverage, assessmentReady, and files with path/bytes/sha256. It has no separate invented completion flag. Manifest paths are relative to the exported directory. Native preview files use name/body/bytes/sha256 instead.

The full source corpus can be much larger than a native output envelope. Full-file capacity and completion are accounted for in the standalone export and its final manifests. The original native report remains compact.

## 8. Keep private operator functions separate from a customer release

The original Python declaration drives both preview availability and published routes. There is no same-revision "private function" switch.

Use the existing saved-revision seam:

1. Keep the operator revision containing inspect_migration, build_migration, and customer_migration for the private operator workspace.
2. Save a derived revision with identical application and captures but functions containing only customer_migration.
3. Stage and activate that exact saved customer revision using the original release engine.
4. Restore the retained operator revision as the current editing head.

The customer release retains its immutable customer-only function configuration. Restoring the operator editing head does not change that release. The original release review, activation, stop/restart, rollback, customer SDK export, and offline buyer review remain the native engine's operations.

A customer report release returns the five safe report files. Complete mapped files are the separate full streaming handoff, whose exact file identities remain reviewable.

## 9. Reopen the full retained workspace

~~~sh
node workbench.mjs export \
  --source-root /absolute/original/source-root \
  --dir ./customer-migration \
  --out ./migration.python-workspace.json

node workbench.mjs reopen \
  --source-root /absolute/original/source-root \
  --dir ./reopened-migration \
  --bundle ./migration.python-workspace.json
~~~

The export is the original native portable format. Reopen uses its create-only import into a new directory. It preserves workspace identity, revisions, binary sources, completed previews, stages/releases, customers, and retained files according to the original model. It does not recreate a source store or run acquisition to restore the workspace.

The operator handoff's operator/workspace.python-workspace.json is also an original portable bundle. Select that file directly when reopening a complete operator handoff.

## Native limits and meaningful capacity

| Boundary | Actual behavior |
| --- | --- |
| Native source file | At most 8 MiB per original source file; gzip is binary, not text. |
| Native source revision | At most 32 MiB and 512 files, including application/configuration and the complete source closure. |
| Native function response | At most 1 MiB; complete data is streamed into files by the same processor. |
| Native function timeout | 120,000 ms, the original supported maximum. |
| Worker configuration | One worker, at most two pending operations. |
| Inspection page | Default 100, maximum 250; whole-source assessment remains complete. |
| Full export | Whole selected sources, create-only output, per-file fsync, complete manifest and hashes; no row clipping. |
| Acquisition custody | Independent private raw store; not constrained to the merchant revision's source-file cap. |

The retained reference packet used during development contains four complete NVDA sessions from the original September 16, 2025 XNAS samples: MBP-1 premarket 46,898 rows, MBP-1 after-hours 6,388, MBO premarket 111,635, and MBO after-hours 224,514. Original definition/status companions and the actual MBO reset observation are separate references. The MBO sessions are retained as exact binary gzip. Full day corpora and indexes are preserved separately.

Those editions exercise full-session streaming, explicit source lineage, original market-data precision, binary revision preservation, and complete mapped delivery. A customer cutover comparison uses its own exact matching production and preview request windows, with their actual gateway and observation metadata.

## Original sources

- Original SDK0.87.0 source: https://github.com/databento/databento-python/tree/25eef4ee8e66559e2370166a57c20925ce244d49
- Native batch API implementation: https://github.com/databento/databento-python/blob/25eef4ee8e66559e2370166a57c20925ce244d49/databento/historical/api/batch.py
- Original DBN store and transcoding behavior: https://github.com/databento/databento-python/blob/25eef4ee8e66559e2370166a57c20925ce244d49/databento/common/dbnstore.py
- Nasdaq historical migration announcement and preview gateway: https://databento.com/blog/nasdaq-historical-data-changes-2026-09
- Original native schemas, source representations, and delivery contract: CORE_CONTRACT.md in this module.

