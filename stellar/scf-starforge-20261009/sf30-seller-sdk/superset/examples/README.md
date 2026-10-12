# Native Superset customer

This example starts one retained Apache Superset 6.1.0 application, Redis and a
single Celery worker, then uses the installed Superset workspace and original
merchant/buyer engines. It consumes the exact public 2023 and 2024 US Census
JAM workbooks already used by the installed Census customer.

Use an existing Python 3.11 or 3.12 environment containing
`apache-superset==6.1.0`, an installed Redis server version 5 or later, Node 24,
and the existing Playwright/Chromium installation. The official source contract
is Apache Superset commit
`c83fb2bb1dcfac41ac51bcebd82471f4a7180d18`. Dependency installation belongs to
the selected host's existing package/runtime custody. The example keeps its
metadata database, actual datasource, secrets, source receipts, request journal,
logs and exports in its one private directory.

```sh
node SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/superset/examples/native-customer.mjs \
  --directory /absolute/private/superset-customer \
  --operation-id SCF-SUPERSET-CUSTOMER-A238-20261012 \
  --python /absolute/installed-superset/bin/python \
  --redis /absolute/installed/redis-server \
  --before /absolute/2023_Jam_Values.xlsx \
  --after /absolute/2024_Jam_Values.xlsx \
  --playwright /absolute/installed/node_modules/playwright \
  --chromium /absolute/installed/chromium
```

Use the same command and private directory after an interruption. The original
input, selected ports, worksheet/source hashes, chart definition, dataset
editions, reviewed publication intent and buyer session remain retained. A
completed result is returned directly. A receiving retry reuses the same
downloaded project; later native activity in its restored version store remains
current.

## Original workbook selection

| Workbook | Bytes | SHA-256 |
| --- | ---: | --- |
| 2023_Jam_Values.xlsx | 13,138 | c884b6c56f0951b8fbc28217b00577fbc22e2372dc375686d024e507c4e8d807 |
| 2024_Jam_Values.xlsx | 13,432 | 14a61938cff58166ef265af9a324b8a6f4cf6040f8630634e5711cb5b07e2cf5 |

The complete public workbook pair is included in the existing
[installed Census customer data package](https://tokenjunkielabs.slack.com/files/U0BR9670G2H/F0C8K059K5X/starforge-census-customer-data-20261012.zip).
Its ZIP is 28,980 bytes with SHA-256
`0b770c9885143d1595b8ca1554cd2257e01fb294299479aca513d368afc65c52`.
That package's source map retains the original public workbook URLs and the
completed Census receiving result.

The native datasource uses `JamValues!A20:G36`, rows 21 through 36, selecting
columns A, B, D, E and G. `source_row` is the original worksheet row number.
Text whitespace and zero integer values are preserved. The fixture retains
each original cell type, saved value token and formula text separately.
Superset introspects the resulting native SQLite table with its original
`SqlaTable.fetch_metadata()` and executes the saved query context itself.

The chart has two native queries: the complete ordered 16-row result and a
separate three-row result. The product captures both, and its reviewed edition
explicitly selects query ordinal zero. Native asynchronous jobs run through
Redis/Celery and the original session-bound event stream. The before/after
comparison contains 15 unchanged rows and the one original `upper_value`
change.

## Customer workflow

The executable drives the actual source and project APIs in this order:

1. Retain the original source cells, native datasource/chart/dashboard and
   authenticated inventory; capture the actual asynchronous query results.
2. Create and approve an immutable typed edition with adjacent value/state
   columns. Apply the second source workbook to the same native datasource,
   capture again, and review the exact edition comparison.
3. Start the original merchant version store, acquire its first original page,
   publish the reviewed successor through the original native version
   controller, and finish the original four-page acquisition.
4. Retain original response headers and wire history, construct the original
   SF100 delivery, reopen it, and operate the actual browser at desktop and
   390-pixel widths.
5. Download the complete project through the browser. Close the original
   Superset/Redis/Celery services, receive the project into a different private
   root, and inspect the same completed buyer session and retained delivery.
6. Start the restored merchant, verify its complete A-to-B version history,
   activate both retained editions through the original controller, and receive
   the same project again to verify that the newer version activity stays
   current.
7. Deliver again from the relocated original acquisition, export the advanced
   project, reopen the original incoming project without resetting its later
   publisher or session, and receive that advanced project in a further private
   directory. Resolve saved logical response paths through the original SF88
   location API and retain their original byte digests.

The local merchant response is the original free HTTP dataset path.
`NO_PAYMENT_REQUIRED`, all four actual response statuses and the unchanged
first-page digest are retained in the result. Public Stellar testnet payment
terms use the original SDK's XLM Stellar Asset Contract derivation; this
receiving exercise does not request a signature. It demonstrates native
source, publication, acquisition, semantic delivery and complete project
portability.

The private `CUSTOMER_RESULT.json`, retained phase journal, two browser images
and `received-project.sqlite3` are the resulting handoff. The application
password and Flask signing secrets stay in `superset/secrets.json`; they are
environment inputs to the source client and are excluded from the portable
project.

## Source and lifetime

The fixture isolates its actual SQLite datasource and Superset metadata.
`PREVENT_UNSAFE_DB_CONNECTIONS=False` is scoped to that owned local example so
Superset can query its SQLite file. The service binds to numeric loopback and
keeps its native authentication and CSRF controls. Its Redis port and Celery
worker belong to the same retained operation.

The Node parent owns and drains its server, browser and original child
processes, then releases its workspace lease. The example uses one Celery
worker with the original `solo` pool and one Chromium instance. Declare the
whole Python/Redis/Node/browser process-tree memory and installation footprint
through the host's maintained admission service before launching it.
