# Complete Finage customer receiving operation

This program carries two completed producer exports through the original Finage
customer warehouse and its existing portable reading view. The producer owns
acquisition, mapping, source classification and the complete delivery exports.
The receiver owns staging, exact-value storage, customer selection, queries,
exports and recovery.

Run the program with the original two export directories and their exact
manifest SHA256 values. Both exports are retained as separate deliveries.
Labels describe their original source scopes; this program does not infer a
baseline/preview or live/historical relationship between them.

## Configure the actual receiving operation

Keep operate.py, read-views.mjs and this operating guide together. Create a JSON
configuration from the actual source and export paths:

~~~json
{
  "schema": "finage.customer-receiving-operation/v1",
  "operation_id": "finage-customer-receiving-operator-selected-id",
  "output": "/customer/receiving-operation",
  "receiver_command": [
    "/usr/bin/python3",
    "/selected/stellar/scf-starforge-20261009/sf30-seller-sdk/finage/receiving/receiver.py"
  ],
  "receiver_source_files": [
    "/selected/stellar/scf-starforge-20261009/sf30-seller-sdk/databento/receiving/receiver.py",
    "/selected/stellar/scf-starforge-20261009/sf30-seller-sdk/finage/receiving/receiver.py"
  ],
  "source_pin": "EXACT_SELECTED_SOURCE_COMMIT",
  "actor": "Named receiving operator",
  "deliveries": [
    {
      "directory": "/producer/first-complete-customer-export",
      "manifest_sha256": "EXACT_ORIGINAL_MANIFEST_SHA256",
      "label": "Original first export label"
    },
    {
      "directory": "/producer/second-complete-customer-export",
      "manifest_sha256": "EXACT_ORIGINAL_MANIFEST_SHA256",
      "label": "Original second export label"
    }
  ],
  "browser": {
    "node": "/selected/bin/node",
    "playwright_module": "/selected/node_modules/playwright/index.js",
    "chromium_executable": "/selected/chromium"
  }
}
~~~

Use absolute paths and an existing Python 3.11+ interpreter. Select all original
profile/receiver source files actually used by the command. If using the shared
engine directly, put "--profile", "finage" in receiver_command before the
subcommands appended by this program. The Finage wrapper fixes that profile
itself.

The source commit identifies the selected implementation, and each selected
source file is hashed independently. The two actual manifest hashes bind the
original received files and their source scope. Native receiving verifies the
complete processor inventory, original counts, mapped data, columns and report
binding.

An optional filter object can select an exact original output label and value:

~~~json
{"filter":{"column":"ACTUAL_ORIGINAL_LABEL","op":"eq","value":"ACTUAL_EXACT_TEXT","kind":"string"}}
~~~

If omitted, the program selects an actual nonempty original cell from the
second delivery, preferring an existing symbol/ticker/instrument label. The
chosen original label, exact text and JSON kind are saved before the query.
This chooses a local exact-text selection; it does not interpret prices, units,
timezones or symbol aliases.

## Operate and continue

~~~sh
python3 operate.py --config /customer/receiving.json
python3 operate.py --config /customer/receiving.json --resume
~~~

The operation holds one local owner lock. Its checkpoint pins the actual two
input manifests, receiver command, actor, and each customer decision. Completed
steps are reused on continuation. An incomplete export or restore directory is
retained and the continuation selects a new create-only destination.

For a necessary implementation correction after an interrupted run, select the
same original inputs and a new explicit source revision:

~~~sh
python3 operate.py --config /customer/receiving.json --resume \
  --accept-source-change "Describe the actual receiver correction"
~~~

This retains the prior source hashes, new hashes, selected commit and reason.
It does not change the original input or customer decision identities. A
different input manifest, actor, filter or receiver command belongs in a
separate receiving operation.

## Completed operating path

1. Read the exact original manifests and initialize one new customer warehouse.
2. Start the original receiver in an owned child process, observe a committed
   native batch through a separate read-only SQLite connection, then interrupt
   that child. The original receiver handles rollback/close and retains the
   committed prefix. If the first export completes before an interruption is
   observed, the second original export is the remaining intake candidate.
   An already retained importing prefix is adopted instead of starting another
   interrupted import.
3. Resume the same original delivery and finish receiving both source scopes.
   Repeat the completed first intake to observe native identical-delivery reuse.
4. Select the first scope with a named actor/reason and retained operation ID.
   Replay that same decision, inspect the original stale-head rejection, then
   select the second scope against the correct displayed head. Original
   assessments remain unchanged.
5. Page every original row from both scopes, preserving exact JSON text and
   JSON kinds. Add the original optional query index and receive the full
   filtered result. Selected original line bytes, including line endings,
   determine the expected exported stream.
6. Create complete customer exports for both scopes and a filtered export for
   the selected second scope. Original complete CSV and NDJSON must match their
   producer hashes. The filtered export retains the original provenance and
   names its actual selection.
7. Roll back to the previously selected first scope through the original
   guarded customer decision. A fresh receiver process reopens both retained
   deliveries and the three decisions.
8. Create the original complete native backup. Use its own bundled receiver.py
   with --profile finage to restore into a new warehouse, reopen it, read every
   exact saved row again, and export the restored active source. The bundled
   engine must match a selected original source; the backup remains unchanged.
9. Open the existing generated reading view at 1280px and 390px, and inspect the
   filtered reading view. The original table, source identity, exact download
   links and full/filtered counts remain visible. No replacement UI is generated.

If neither original input exposes an interrupted prefix before finishing,
the operation preserves both completed deliveries and records that actual
condition. It never rewrites staged records or manufactures an interrupted
source.

## Retained outputs

RECEIVING_RESULT.json is written only after the complete operated path.
receiving-checkpoint.json retains each completed/interrupted stage, source
revisions, actual command identity, and named decision request.

The operation directory also contains:

- warehouse/ — the original customer warehouse with both source scopes.
- commands/ — complete native stdout/stderr and actual exit metadata.
- exports/ — complete and filtered native customer handovers, plus the
  original export from the restored active source.
- backups/ — the original complete portable receiver/SQLite/README backup.
- restored-warehouse/ or its named continuation — the separate restored store.
- views/ — original exported HTML reading results and actual desktop,
  mobile and filtered-view images.

Open the generated receiving-overview.html in either complete export for
normal reading. Its NDJSON and CSV links expose the entire original selection,
while the table displays the first native page. Use the original receiver CLI
for later query, selection and exports; the operation remains an inspectable
receiving record.

There are no provider calls, payment attempts, new producer editions or changes
to the original acquisition workspace in this receiving operation.
