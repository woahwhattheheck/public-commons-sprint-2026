# Original ClickHouse reference environment

This reference environment connects the complete Altinity migration application to the original Stellar Forge ClickHouse demonstration source. It owns a new private ClickHouse data directory and runs the application's complete receiving programme against the real **26.8.24.9** engine.

The source is the original three-row **starforge_example.transfers** table. The target is a new MergeTree table, **altinity_acceptance.commission_transfers_v1**, in a separate Atomic database. The application performs the RowBinary transfer, native table/UUID observations, full typed comparison, consumer selection, rollback, export and independent receiving.

## Source and runtime

The original source is woahwhattheheck/public-commons-sprint-2026 at ce4fd5b79c7d098305a00567cf2c3cb983d4065d, path:

    stellar/scf-starforge-20261009/sf30-seller-sdk/clickhouse/examples/seed.sql

This directory's seed.sql is the exact original file: **779 bytes**, SHA256:

    443b0c3b4add59aa60a5d97b296e3721f5192562b9684399da9f7b155074661e

Git blob: 6f3174f20e9fd35cd078ffb36180369d28b5b7cb.

The reference owner loads those original statements and verifies all three rows and all seven native column types. The record_id column alone is not unique: the maximum UInt64 occurs in two different ledgers. The logical and sorting key is **ledger, record_id**.

| Column | Original native type | Meaningful reference values |
|---|---|---|
| record_id | UInt64 | 18446744073709551615 and 18446744073709551614 |
| ledger | UInt64 | 9007199254740993 and 9007199254740994 |
| account | String | merchant-demo |
| amount | Decimal(38, 7) | 123456789012345678901234567890.1234567; 0.0000001; 12.3400000 |
| memo | Nullable(String) | SQL null; literal backslash-N; Example — 東京 |
| successful | Bool | Both true and false |
| observed_at | DateTime64(6, 'UTC') | Original UTC timestamps with microseconds |

The executable is the same official **799,107,680-byte ClickHouse 26.8.24.9** selection used by the completed original merchant/fleet exercise. Supply its existing absolute path. The launcher records the actual executable SHA256 and checks its reported version and size; continuation requires the exact same retained identity.

The historical archive is:

https://github.com/ClickHouse/ClickHouse/releases/download/v26.8.24.9-lts/clickhouse-common-static-26.8.24.9-amd64.tgz

- Archive bytes: 237155702
- Archive SHA256: 4750d3b117571d32c0b8942cf21db77951b2245598466474faf7b306b24fa30c

The original receiving host was /home/hatch/workspace/sim-work/scf-clickhouse-6f7c/ on Muse's Bryce Hatch VM, with Node 24.20.0. Its source, saved workspace and completed outputs were retained under repo/, ws-state/, results-core-journey.json and fleet-out-e49/receipt.json. These are historical custody locations; the existing host owner selects the actual currently retained executable and runtime paths.

The full original run and its exact source selection are recorded in:

https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791753959591409

That completed exercise used core632017d0830d395444b55f45ff158de14cb8051f, companion40b50d9e58d6eedf639e17acf25a9846cd639333, and the corrected experiments/clickhouse-fleet-acceptance/journey.mjs from8429496963529f692f093f59aa23780c94bfe1bf (38,293 bytes, SHA256e8439e100e11d599306c0804d94ac4594cf57328d7c4e5f411d44bb10482d0bf). Its reported complete result included all18 core steps, six HTTP200 local-facilitator deliveries, original in-flight draining, price changes, rollback and relocated reopening. Preserve those completed results when adding the migration programme.

## Run the complete migration receiving programme

Use the actual installed Node, Python, Playwright and Chromium paths from the selected existing host. The original operation owner provides the complete final source manifest. Keep the fixture and application output in distinct directories under the same private operation root.

The fixture owner imports the application worker's existing file/HTTP helpers. It expects the complete application source with commissioning/worker.py and the receiving driver present.

    python3 COMPONENT/reference/fixture.py \
      --directory PRIVATE_OPERATION/reference \
      --clickhouse EXISTING_CLICKHOUSE \
      -- \
      NODE COMPONENT/receiving/receive.mjs \
      --source COMPONENT \
      --directory PRIVATE_OPERATION/programme \
      --config COMPONENT/reference/fixture-input.json \
      --source-manifest ACTUAL_SOURCE_MANIFEST \
      --python PYTHON \
      --playwright ACTUAL_PLAYWRIGHT_MODULE \
      --chromium ACTUAL_CHROMIUM_EXECUTABLE

Replace every uppercase path token with its actual absolute value. The Node command is passed as arguments, without a shell. The fixture adds its selected connection values only to the receiving child's environment:

- ALTINITY_SOURCE_URL, ALTINITY_SOURCE_USER, ALTINITY_SOURCE_PASSWORD
- ALTINITY_TARGET_URL, ALTINITY_TARGET_USER, ALTINITY_TARGET_PASSWORD

Both endpoints use the owned loopback instance. The source and target have distinct native accounts. The source account can select the original source and metadata. The target can select, create tables and insert only within the private altinity_acceptance database, plus read the required native metadata. The target account cannot mutate the original source.

The fixture-input.json contains environment variable names and the explicit source/target table schema. Its selection preserves the original example source and requires full-row acceptance. The three source rows are quiescent while the receiving programme owns the instance.

Use the existing whole-programme resource allocation. The historical engine/browser run declared2GiB peak plus512MiB reserve and used one database/browser phase at a time. This launcher supplies no scheduler or extra worker. The existing host owner accounts for its ClickHouse process, receiving application, native HTTP worker and browser together.

## Continuation and closure

After an interrupted programme, keep the complete private operation directory and repeat the same command with --resume before the fixture's -- separator:

    python3 COMPONENT/reference/fixture.py \
      --directory PRIVATE_OPERATION/reference \
      --clickhouse EXISTING_CLICKHOUSE \
      --resume \
      -- \
      NODE COMPONENT/receiving/receive.mjs \
      --source COMPONENT \
      --directory PRIVATE_OPERATION/programme \
      --config COMPONENT/reference/fixture-input.json \
      --source-manifest ACTUAL_SOURCE_MANIFEST \
      --python PYTHON \
      --playwright ACTUAL_PLAYWRIGHT_MODULE \
      --chromium ACTUAL_CHROMIUM_EXECUTABLE

The launcher forwards --resume to the original receiving driver. It compares the original source manifest selection, seed, executable identity and complete command before starting anything. Preserve the original receiving request IDs and native journals; the worker reconciles uncertain native writes through its existing saved-operation workflow.

The reference directory has one nonblocking filesystem lease. Its owned database and receiving child inherit that same lease descriptor. A live owner retains its directory; another invocation cannot start a duplicate. The loopback port must also be free before the reference starts its own server.

The source table uses the original Memory engine. After the owned database restarts, its source data is empty. The reference reloads the exact original source only when it is empty, then compares every row and native column. It also compares the retained source UUID and source observation. A changed source, unexpected partial seed or different table identity requires reconciliation of that original state.

The candidate database and its MergeTree tables stay on disk. The launcher never clears, drops, truncates, reimports or renames a candidate. A resume therefore leaves completed transfer effects available to the same application operation.

The receiving programme closes its application/server/browser through its own original lifecycle. The fixture then closes only the database process it launched, waits for its exit and retains the private data directory. On interruption it first ends its receiving child, then its owned database. The source seed and candidate data remain available for the original continuation.

## Retained output

The fixture directory retains:

| File or directory | Purpose |
|---|---|
| fixture.json | Original executable identity, seed identity, selected reference input and receiving command |
| reference-observation.json | Actual native version, source UUID and engine, exact three-row identity and Atomic target database |
| fixture-result.json | Receiving exit, database exit, completion/interruption and actual timestamps |
| native.log | Private native server diagnostics |
| data/, access/, tmp/ | Original private database state and native account configuration |
| credentials.json, server.xml | Private loopback credentials and native server configuration |
| lifetime.lock | Original process lifetime ownership |

The receiving programme separately retains its full application outputs, native HTTP requests/responses, typed source/target exports, comparison, consumer selection history, receiving archives and browser captures. Deliver those files through the original case's source and receiving workflow. Share the public result summary and selected programme artifacts; keep the fixture's credential and database directory with its private host owner.

## Applying the workflow to a customer source

The reference configuration is a complete demonstration input. A customer edition selects the customer's approved source snapshot, exact native version, table/column mapping, data volume and target database through the application's existing plan review. Keep the original commercial case and its agreed scope. The existing Altinity read-service offer and a migration implementation are separate scope selections within that same relationship.

For a customer run, use its approved connection environment and the complete receiving programme directly. The fixture launcher is reserved for the original public demonstration dataset. The customer target, source boundary and expected native identities belong in that customer's saved plan.

The resulting deliverable is the same complete migration application: retained input, native transfer, complete comparison, explicit consumer cutover, reversible saved selection and independent receiving of its full operating history.
