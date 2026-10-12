# Receive complete PostgreSQL period reports from the original dataset

This programme continues the completed original 32-row PostgreSQL receiving operation. It opens that operation's existing warehouse, three immutable editions, original dictionaries, reviewed SQL mappings and selected application view. It produces two complete period reports, receives their full contents, operates the browser and CLI, restarts the same owned development database, and reopens the original report requests.

The two comparisons use the editions already named **original**, **alternate-alias** and **quoted-identifiers** in the original receiving record. Both compare the same 32 original source rows. The alternate mappings exercise a changed SQL alias and the distinct quoted identifiers **Reading** and **reading**. Their expected native result is 32 unchanged rows; the complete source-meaning comparison still shows the mapping changes.

The executable source is [postgres_period_receiving.py](postgres_period_receiving.py), with [postgres_period_receiving_browser.mjs](postgres_period_receiving_browser.mjs). Both compose the existing [PostgreSQL receiving product](../POSTGRESQL.md). The Python programme reuses the original semantic receiving example's private HTTP listener, request lookup, exact file writer and owned-process launcher.

## Open the existing receiving operation

Use the directory produced by the complete original 32-row PostgreSQL source-meanings operation. It contains:

| Existing input | Role in this continuation |
|---|---|
| released-editions.json | The original warehouse, three edition IDs, full mappings, relation identities and source row/dictionary hashes. |
| receiving.json | The completed original API, browser and CLI receiving, including the selected application view revision. |
| upgrade-receiving.json | The completed source-meaning upgrade and quoted-identifier receiving. |
| operation.json | The completed original native operation. |
| operator/ | The existing private operator, original reviews, imports and request journal. |
| database/ | The same owned development PostgreSQL data directory used by the original native operation. |

The continuation reads these records. Its new operating files go into **period-receiving/**, and its two report requests use the existing **operator/** journal. It opens the warehouse with the exact retained warehouse identity and **create=False**.

Select the current complete Python product containing postgres_reports.py, postgres_operator.py, postgres_http.py, the current browser assets and CLI. Keep the original source capture and its pinned runtime available. In a repository checkout the Python product root is **stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python**.

## Run the complete operation

Use the receiving host's existing Node, Playwright and Chromium. The supplied owned streaming runtime uses Linux x86-64 and Python 3.12; its original operating guide describes the pinned PostgreSQL/Psycopg dependencies.

~~~bash
python3 -B /path/current/python/examples/postgres_period_receiving.py \
  --source /path/current/python \
  --directory /private/original32-receiving \
  --runtime /private/original32-source/runtime \
  --transport tcp \
  --node /path/to/node \
  --node-modules /path/to/node_modules \
  --chromium /path/to/chrome-headless-shell \
  --temporary-parent /private/runtime-temporary
~~~

Replace the paths with the actual existing receiving operation and installed executables. Create the selected temporary parent as a private directory before running. The portable original source capture keeps its three runtime files in **runtime/**; a repository runtime checkout may expose those same files under **sf88-operator-buyer-cli/runtime/postgres/**.

**--transport tcp** selects the original runtime's private loopback transport. The default **unix** selects its existing private Unix socket. Both reopen the same database directory; the programme holds the original native operation lock throughout its native run.

The operation proceeds through these concrete customer actions:

1. Open all three retained editions, their complete row pages and original dictionaries. Match every full mapping, source hash and relation identity to the original receiving records.
2. Download each edition's original dictionary, manifest, mapping and edition metadata through the private HTTP application.
3. Send the alternate-alias period report with a saved request ID. On its first dispatch, close the real HTTP response at its headers. Resume that exact request through the existing request API and receive its complete ZIP.
4. Invoke the installed **period-report** CLI against that same request and operator. The existing completed report is reused with the same bytes and identity.
5. Open the actual browser, select the original and quoted-identifier editions, fill the complete period-report form and submit it. Preserve the browser's actual generated request before allowing its dispatch.
6. Download the complete browser report, reopen it through **Operations → Open saved result**, and receive the same full ZIP at desktop and 390px widths.
7. Close the HTTP operator, restart the same owned PostgreSQL engine, reopen both original requests through HTTP and CLI, and receive their exact existing report bytes.
8. Close the browser, listener and engine. Retain the complete native operation, both reports, all received files and the actual browser views.

The browser uses Chromium's standard download path for unattended receiving. Its launch disables the native operating-system file picker through the documented Blink runtime-feature switch, **--disable-blink-features=FileSystemAccessLocal**. The application's JavaScript and HTTP/report responses remain the installed product source. The full report ZIP travels through the application's existing **Download complete report** control. Chromium's [runtime feature declaration](https://chromium.googlesource.com/chromium/src/+/e6e557d6a88b63743f33c8365f0879b2f266c07b/third_party/blink/renderer/platform/runtime_enabled_features.json5) and [runtime feature guide](https://chromium.googlesource.com/chromium/src/+/refs/tags/142.0.7392.0/third_party/blink/renderer/platform/RuntimeEnabledFeatures.md) describe that launch mechanism.

## Use the complete received files

The new **period-receiving/** directory contains:

| Output | Contents |
|---|---|
| operation.json | The full owned native run, exact source/input bindings, phase logs and orderly database restart/closure. |
| receiving.json | The original warehouse/operator identities, two retained report IDs, downloads, CLI results and browser outcome. |
| editions/label/ | Complete original HTTP downloads for all three retained editions. |
| reports/alternate-alias/report.zip | The complete original-to-alternate-alias report. |
| reports/quoted-identifiers/report.zip | The complete original-to-quoted-identifiers report submitted through the browser. |
| reports/label/files/ | Every member of that report, received and retained in its original relative layout. |
| browser/receiving.json | The durable actual browser request, source identity, saved downloads, views and closure. |
| browser/attempts/ | Desktop and 390px views and complete downloaded report ZIPs from each original browser attempt. |
| cli/ | Complete command output from the installed CLI using the same original requests. |

Each report ZIP includes both full original **dataset.jsonl** files, both typed **columns.csv** files, the two complete original dictionaries and manifests, the exact reviewed mappings and editions, every row change, the complete meaning comparison, actual SQL, readable HTML, a receiving guide and the complete hash inventory.

Open **reports/label/files/report.html** to read a report. **report.json** carries its native totals and selection; **comparison.sql** carries the exact queries over the original immutable tables. **meaning-changes.json** retains both full mappings and the original field definitions.

For these existing aliases, **changes.jsonl** is empty and **changes.csv** contains its header. Both periods still contain all 32 original rows. That combination expresses an unchanged dataset with a reviewed mapping change.

### Read typed CSV without losing values

Each CSV cell is a JSON value, including the header. Parse CSV first and then JSON per cell. This preserves database NULL, empty strings, the literal string "null", exact numbers, dates and case-sensitive column names.

~~~python
import csv
import json
from decimal import Decimal

with open("reports/quoted-identifiers/files/current/columns.csv",
          encoding="utf-8", newline="") as source:
    reader = csv.reader(source)
    columns = [json.loads(cell) for cell in next(reader)]
    records = [
        dict(zip(columns, [json.loads(cell, parse_float=Decimal) for cell in row]))
        for row in reader
    ]

print(columns)  # Includes the separate original aliases Reading and reading.
print(len(records))
~~~

The receiving programme compares every decoded cell with the values read from the original PostgreSQL edition. Its original JSONL comparison uses the full retained source bytes, including row order.

## Continue an interrupted operation

Run the same full command with the same original directory. The programme reuses the retained edition and report request IDs. Completed native report archives are reopened; an interrupted browser continues its exact stored request. The browser's pre-dispatch checkpoint distinguishes an unsent request from a request whose response was lost.

A saved **COMPLETE** native operation is reopened from its exact local results and complete files without another engine allocation. If the current receiving sources changed, the source binding causes the updated programme to receive the same original requests again.

The original operator owns report durability. It stores the complete selected report intent before running SQL, publishes the complete archive, and restores the same result after a lost response. The receiving programme preserves the original body and compares every resumed ZIP with the first received bytes.

The final **operation.json** distinguishes the owned two-start database run from standalone receive/reopen phases. Its teardown records the actual runtime's starts, orderly stops and exit codes.

## Use an already running PostgreSQL host

The two phases also operate against an existing authorised PostgreSQL listener. Put its libpq connection settings in the existing environment variable selected by **--connection-env**; the default is **SF_BUYER_POSTGRES_DSN**.

Receive through that original listener:

~~~bash
python3 -B /path/current/python/examples/postgres_period_receiving.py \
  --phase receive \
  --source /path/current/python \
  --directory /private/original32-receiving \
  --node /path/to/node \
  --node-modules /path/to/node_modules \
  --chromium /path/to/chrome-headless-shell
~~~

After the existing database operator restarts the same database, reopen its reports:

~~~bash
python3 -B /path/current/python/examples/postgres_period_receiving.py \
  --phase reopen \
  --source /path/current/python \
  --directory /private/original32-receiving
~~~

The standalone phases preserve the same operator and request journals. Their result records the actual HTTP/CLI receiving and reopen. The default full **run** phase owns and records the database restart itself.

## Open the original reports directly with the CLI

Read **period-receiving/receiving.json** for the exact report request IDs and warehouse identity. The original alternate selection is also retained in **period-receiving/alternate-alias-selection.json**.

~~~bash
python3 -B -m stellar_forge_buyer.postgres_cli \
  --schema sf_semantic_receiving \
  --expect-warehouse ORIGINAL_WAREHOUSE_ID \
  period-report \
  --workspace /private/original32-receiving/operator \
  --request-id ORIGINAL_REPORT_REQUEST_ID \
  --selection /private/original32-receiving/period-receiving/alternate-alias-selection.json
~~~

Open or resume the same request:

~~~bash
python3 -B -m stellar_forge_buyer.postgres_cli \
  --schema sf_semantic_receiving \
  --expect-warehouse ORIGINAL_WAREHOUSE_ID \
  operation \
  --workspace /private/original32-receiving/operator \
  --request-id ORIGINAL_REPORT_REQUEST_ID

python3 -B -m stellar_forge_buyer.postgres_cli \
  --schema sf_semantic_receiving \
  --expect-warehouse ORIGINAL_WAREHOUSE_ID \
  resume \
  --workspace /private/original32-receiving/operator \
  --request-id ORIGINAL_REPORT_REQUEST_ID
~~~

Close the private HTTP operator before using the CLI with that operator directory; both use its original exclusive ownership lock. The receiving programme already performs this handover between its HTTP, browser and CLI phases.

The returned object is the original request. Its **result.artifact** contains the complete archive path, filename, byte count and SHA-256. The private browser serves that same artifact at **/api/period-reports/request_id/archive**.
