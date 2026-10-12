# Leap device interval operations

This operator turns retained interval sources and an explicit device ownership mapping into a reviewed Leap load. It keeps the original files, normalized rows, validation issues, upload bytes, provider job receipts, missing-interval searches and portable delivery together in one workspace.

Open the **Leap intervals** console to move through source intake, device mapping, batch review, upload jobs, missing intervals and receiving. The same Python owner serves the browser and the command-line workflow. Every mutation carries its original workspace revision and request UUID.

## Start the installed operator

Use the source-owned command from the installed Starforge package:

~~~sh
starforge leap-intervals --workspace /private/leap-workspace init

starforge leap-intervals --workspace /private/leap-workspace serve \
  --port 0 --connection-file /private/leap-console.url
~~~

The listener prints its original READY descriptor and writes a private URL with a bearer capability in its fragment. Open that exact URL. The server listens on 127.0.0.1 and authenticates the browser against the same owner.

The Node entrypoint forwards arguments to the original Python CLI and waits for its exit. It selects an explicit leading `--python /absolute/python3`, then `CODEX_PRIMARY_RUNTIME_PYTHON`, then `STARFORGE_PYTHON`, then `python3`. Python 3.11 or later is required. The Leap modules use the standard library and the retained Utility time and shared helpers; the selected product contains their original source.

Keep the server open for its browser session. SIGINT or SIGTERM drains the listener and closes the workspace. The connection file is removed only when it still contains that owner's original URL. Reopening the workspace creates a fresh private listener capability and keeps the retained logical records.

## 1. Configure the destination

The Overview page shows the actual workspace ID, revision, retained counts and current configuration. Save a complete configuration object:

~~~json
{
  "environment": "staging",
  "partner_account_id": "YOUR_EXISTING_PARTNER_ACCOUNT_ID",
  "token_env": "LEAP_API_TOKEN"
}
~~~

The token value stays in the selected server process environment. The browser stores its local console capability separately and never asks for the Leap API key. Leap's documented authentication uses the existing environment-specific API key directly as a bearer credential.

A production mapping and a staging mapping belong to different provider contexts. Review the environment and partner account in the saved mapping as well as the current configuration before submission. The engine validates the actual destination and source selection.

The equivalent CLI action reads the same object:

~~~sh
starforge leap-intervals --workspace /private/leap-workspace configure \
  --file /reviewed/configuration.json
~~~

The current public provider contract and its retrieval identities are retained in [contracts/SOURCES.md](contracts/SOURCES.md) and [contracts/leap-api-contract.json](contracts/leap-api-contract.json). Those files document the original routes and field meanings. An API contract is separate from an actual account, owned device or successful provider operation.

## 2. Retain the complete original source

Use **Source files** to choose the original file and its interpretation:

| Format | Intended source |
| --- | --- |
| `leap-load` | An original Leap load CSV using the eight wire columns below |
| `utility-profile` | A retained Utility interval profile whose source meter, series and channel are assigned by an explicit mapping |
| `evidence` | Complete supporting bytes, including the reviewed evidence for device custody |

The upload retains the complete raw body. Source SHA-256 and byte length identify those bytes. Use **Inspect** to see full metadata and download the original. Source lists are paged; their total is the retained collection size, rather than the number visible in the current table.

~~~sh
starforge leap-intervals --workspace /private/leap-workspace import \
  --file /reviewed/device-load.csv --format leap-load

starforge leap-intervals --workspace /private/leap-workspace import \
  --file /reviewed/utility-profile.csv --format utility-profile

starforge leap-intervals --workspace /private/leap-workspace import \
  --file /reviewed/device-custody.json --format evidence
~~~

The row review preserves exact UTC boundaries and the original source references. Energy fields represent **kWh for the interval**. They are distinct from instantaneous power or a whole-period bill amount.

| Wire field | Review meaning |
| --- | --- |
| `meter_id` | The actual Leap-created DEVICE UUID selected by the mapping |
| `interval_start_time_utc` | Original interval start in UTC |
| `interval_end_time_utc` | Original interval end in UTC |
| `energy_net_kwh` | Net interval energy |
| `energy_consumed_kwh` | Consumed interval energy |
| `energy_generated_kwh` | Generated interval energy |
| `final` | Original final-data value carried by the load |
| `region` | Original region value carried by the load |

Leap's retained load contract describes 15-minute UTC intervals and net energy or the consumed/generated pair. When all three energy quantities are present, consumed minus generated must equal net. The original engine owns exact numeric, interval and field validation. Keep its row issues visible instead of editing an output CSV to bypass them.

## 3. Review device identity and ownership

Use **Device mappings** to author one complete mapping object. The JSON editor preserves the original schema; **Preview mapping** renders the ownership windows and source-channel assignments as separate tables before saving.

~~~json
{
  "schema": "stellar-forge.leap-interval-mapping.v1",
  "name": "Reviewed device interval delivery",
  "environment": "staging",
  "partner_account_id": "YOUR_EXISTING_PARTNER_ACCOUNT_ID",
  "reviewer": "YOUR_REVIEWER",
  "ownership_evidence_source_id": "SHA256_OF_RETAINED_EVIDENCE",
  "ownership": [
    {
      "meter_id": "YOUR_ACTUAL_LEAP_DEVICE_UUID",
      "start_utc": "REVIEWED_UTC_START",
      "end_utc": "REVIEWED_UTC_END"
    }
  ],
  "entries": []
}
~~~

All uppercase values in that example must be replaced by reviewed customer values. The empty entries array is the direct `leap-load` case, where the file already carries the actual device UUID.

For a Utility profile, include each explicit source assignment:

~~~json
{
  "source_meter_id": "EXACT_RETAINED_SOURCE_METER",
  "source_series_id": "EXACT_RETAINED_SOURCE_SERIES",
  "source_channel": "EXACT_RETAINED_SOURCE_CHANNEL",
  "leap_meter_id": "YOUR_ACTUAL_LEAP_DEVICE_UUID",
  "target_column": "energy_consumed_kwh"
}
~~~

The accepted target columns are `energy_net_kwh`, `energy_consumed_kwh` and `energy_generated_kwh`. Assign the intended channel to the intended quantity. Keep distinct source identities distinct, including identifiers that happen to have similar display names.

The retained provider contract distinguishes DEVICE from UTILITY_METER. Retain evidence that each DEVICE meter was created through the **Create Meters API or Portal CSV** and that the selected partner account held custody during the source intervals and still holds custody at submission. The meter response does not establish that full creation-channel or historical ownership basis. API visibility, creation time, and an `audit.created_by` enum therefore do not replace the explicit evidence and reviewed ownership windows.

Saving a mapping creates its retained identity:

~~~sh
starforge leap-intervals --workspace /private/leap-workspace mapping-save \
  --file /reviewed/mapping.json
~~~

Inspect the saved mapping, its environment, partner account, reviewer, evidence source and entries before preparing a batch.

## 4. Prepare and inspect a batch

Use **Batch review** to select exact source and mapping identities:

~~~json
{
  "name": "Reviewed interval load",
  "source_ids": ["SHA256_OF_RETAINED_INTERVAL_SOURCE"],
  "mapping_id": "SHA256_OF_SAVED_MAPPING"
}
~~~

A correction can add `correction_of` with the retained original batch ID. A batch prepared to answer a missing-interval search can add `missing_snapshot_id`. Both are explicit lineage links; retain the original batch and provider history.

~~~sh
starforge leap-intervals --workspace /private/leap-workspace prepare \
  --file /reviewed/batch-plan.json
~~~

The batch inspection shows its identity, source IDs, mapping ID, row and issue counts, meter count, upload file hash and any job, correction or missing-snapshot link.

Switch between **Rows** and **Issues**. Both are complete paged views. Every row retains `row_index` and `origins`, including source ID and original line. Every issue retains its native code, column, message and any original source or device identity. Open a full row record when a table cell is insufficient.

A `VALIDATION_FAILED` batch needs a corrected source or mapping and a new explicitly linked preparation. Download the exact generated upload file from the batch metadata when reviewing what the provider would receive.

## 5. Submit, refresh and reconcile the original job

From the selected batch, open **Upload jobs**. The submission editor uses that selected batch ID. The review confirmation applies to the displayed batch and provider destination; changing the submission text or saving a different configuration clears it.

~~~json
{
  "batch_id": "SHA256_OF_REVIEWED_BATCH"
}
~~~

The original CLI exposes the same operations:

~~~sh
starforge leap-intervals --workspace /private/leap-workspace submit \
  --batch-id REVIEWED_BATCH_SHA256

starforge leap-intervals --workspace /private/leap-workspace refresh \
  --batch-id REVIEWED_BATCH_SHA256

starforge leap-intervals --workspace /private/leap-workspace reconcile \
  --batch-id REVIEWED_BATCH_SHA256
~~~

Reconciliation can also name an exact observed job:

~~~sh
starforge leap-intervals --workspace /private/leap-workspace reconcile \
  --batch-id REVIEWED_BATCH_SHA256 --job-id OBSERVED_JOB_UUID
~~~

The engine owns the provider request, original response pages, job identifiers, errors and complete file retrieval. The console displays the full retained result and current batch state. The **Original provider evidence** panel pages through API receipts, device observations and recovered original upload files. Inspect a record to receive its complete metadata and download the exact retained response or upload.

| Observed state | Operator continuation |
| --- | --- |
| `VALIDATION_FAILED` | Inspect original row issues and prepare an explicit correction |
| `SUBMITTED` | Retain the upload acknowledgement and read the same job |
| `QUEUED` or `PROCESSING` | Refresh the same provider job |
| `COMPLETED` | Retain the provider's completed response and export its evidence |
| `FAILED` | Inspect the complete provider errors and prepare a reviewed correction |
| `UNKNOWN` | Reconcile the original attempt before any decision about a new submission |
| `DEFERRED` | Keep the original Retry-After and continue after its retained boundary |
| `AUTHENTICATION_REQUIRED` | Supply the original configured process credential and retain the native error |
| `ELIGIBILITY_REVIEW` | Inspect the original device observation and eligibility failure |
| `NEEDS_REPLAN` | Review the changed missing-window snapshot before preparing a load |
| `DUPLICATE_REVIEW` | Inspect the existing accepted or uncertain batch with the same upload bytes |

A local action may be `COMPLETED` while the batch is `UNKNOWN`: the operator successfully retained the uncertain outcome. That is distinct from a completed provider job.

The provider's original-file endpoint returns a temporary location. The original API layer downloads the complete file and compares it with the retained upload bytes without forwarding the provider API key to the file host. A limited preview cannot establish whole-file equality. Keep the actual job ID, original upload bytes and comparison result together.

The workspace does not invent a provider idempotency field or automatically repeat an uncertain upload. A later correction remains an explicit new batch linked to the original one.

## 6. Retain missing-interval requests

Use **Missing intervals** to enter the complete original search scope. The editor supports the retained API fields:

~~~json
{
  "meter_ids": ["YOUR_ACTUAL_LEAP_DEVICE_UUID"],
  "status": "OPEN",
  "missing_interval_window_start_date_time_utc": "REVIEWED_UTC_START",
  "missing_interval_window_end_date_time_utc": "REVIEWED_UTC_END"
}
~~~

The original API also accepts the documented submission-deadline start and end fields. Use the actual reviewed window rather than a guessed broad account search.

~~~sh
starforge leap-intervals --workspace /private/leap-workspace missing \
  --file /reviewed/missing-scope.json
~~~

The engine receives every original page and retains the search snapshot. Inspect its complete response and download its original files. The current list has its own paging and total.

The retained provider contract defines an inclusive start and exclusive end for missing intervals; its submission deadline is exclusive. OPEN requests data, while PENDING indicates submitted data is being processed. Preserve that distinction when selecting a correction batch's `missing_snapshot_id`.

## 7. Export and cold reopen

Use **Export & receiving** to export the selected batch:

~~~json
{
  "batch_id": "SHA256_OF_REVIEWED_BATCH"
}
~~~

The returned metadata contains the original export ID, name, byte length, SHA-256 and authenticated download URL. Browser downloads verify their complete length and hash before saving.

The CLI writes the same original portable export to a new destination:

~~~sh
starforge leap-intervals --workspace /private/leap-workspace export \
  --batch-id REVIEWED_BATCH_SHA256 --out /delivery/leap-customer.zip
~~~

Close the original owner before a same-directory CLI command that needs its lease. For a separate receiving location:

~~~sh
starforge leap-intervals --workspace /private/leap-received init

starforge leap-intervals --workspace /private/leap-received restore \
  --file /delivery/leap-customer.zip

starforge leap-intervals --workspace /private/leap-received status

starforge leap-intervals --workspace /private/leap-received serve \
  --port 0 --connection-file /private/leap-received.url
~~~

The portable workspace preserves the same logical workspace ID, sources, mappings, batches, upload bytes and retained provider evidence. The receiving directory and listener capability are new. Compare logical identities and exact original files when verifying the handoff.

The complete receiving runner in [the operating delivery directory](../../../../operations/scf-leap-interval-receiving-20261012/README.md) performs source verification, the original owner/browser workflow, complete file receiving, CLI export and a cold reopen. Its private input names the actual reviewed sources, mapping, batch plan and provider actions. It saves original responses and never substitutes a documentation example for a successful live provider call.

## Request and connection recovery

The browser retains a pending mutation before transmitting it. The saved record includes the original workspace ID, request UUID, expected revision and exact action body. Raw imports additionally retain the filename, format, byte length and SHA-256; their file bytes stay in the original selected file.

If an HTTP response is lost:

1. Keep the same workspace and private connection.
2. Use **Read original operation** on the pending panel.
3. If the original operation is RUNNING, inspect it again when it has an outcome.
4. If it is COMPLETED or FAILED, reopen that retained result.
5. When the same owner explicitly reports that UUID absent, or returns an interrupted local operation with `recoverable: true`, the UI offers the same exact request again. A raw request requires the same original file bytes. An interrupted provider submission is recovered as its retained UNKNOWN batch and proceeds through reconciliation.

A failed validation can be corrected after its original failure is retained. An interrupted provider upload whose batch is UNKNOWN goes through batch reconciliation, even when the local action itself completed.

The pending record is scoped to the workspace ID in browser storage. A different workspace at the same origin cannot silently consume it. Keep the original capability private. A new listener uses its newly printed private URL; the connection panel can attach it without changing source or batch identities.

Every CLI mutation can supply `--request-id UUID --expected-revision INT`. The generic command uses the same action dispatcher:

~~~sh
starforge leap-intervals --workspace /private/leap-workspace action \
  --name batch.reconcile --file /reviewed/reconciliation.json \
  --request-id ORIGINAL_REQUEST_UUID --expected-revision ORIGINAL_REVISION
~~~

The complete operation endpoint returns its original action, status, timestamps, revision, result and structured error. A report should distinguish retained source preparation, upload acknowledgement, provider processing and actual completion.

## Developer interface

| Method and path | Original result |
| --- | --- |
| GET `/api/state` | Workspace schema, ID, revision, configuration, counts and recent retained collections |
| GET `/api/list?collection=...&offset=...&limit=...` | `{items,total,offset,limit}` |
| GET `/api/item?collection=...&id=...` | Complete retained item metadata |
| GET `/api/rows?batch_id=...&offset=...&limit=...` | Paged wire rows and source origins |
| GET `/api/issues?batch_id=...&offset=...&limit=...` | Paged native validation issues |
| GET `/api/missing?snapshot_id=...&offset=...&limit=...` | Complete paged missing-interval windows |
| GET `/api/operation?id=UUID` | The original local operation record |
| GET `/api/file?id=SHA` | Complete original file bytes |
| GET `/api/export?id=SHA` | Complete original portable export |
| GET `/api/launch` | READY listener, original workspace ID, origin and revision |
| POST `/api/action` | `{action,payload,expected_revision,request_id}` → original result/revision |
| POST `/api/upload` | Raw source bytes with exact name, format, revision and UUID headers |
| POST `/api/restore` | Raw complete portable ZIP with the same revision and UUID envelope |

Raw headers are `X-Leap-Name` (URL-encoded filename), `X-Leap-Format`, `X-Leap-Revision` and `X-Leap-Request-Id`. The browser's local bearer is required on every protected request. There is no base64 file wrapper or second owner behind these routes.

The source-owned [Leap product selection](../../distribution/selections/LEAP_INTERVALS.md) retains this full interface and the complete original Utility contribution. It uses the maintained Starforge builder and installer and keeps original source paths, package identity and recovery journals.
