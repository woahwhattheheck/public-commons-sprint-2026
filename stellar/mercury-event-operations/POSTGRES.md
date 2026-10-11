# PostgreSQL customer delivery

The PostgreSQL destination commits each canonical Mercury event into a customer-owned table. It uses the same event envelope, retained delivery task, worker, retries and operator interface as the SQLite and HTTP destinations.

An event's key binds the configured network, provider account label, provider API base and original Mercury row ID. Two rows in the same transaction remain two events. The destination stores the original nullable event index and XDR strings, a queryable canonical JSON document, and the exact UTF-8 bytes produced by the application's shared envelope encoder.

## Install and provision

Use Python 3.11 or later and install the optional driver in the environment that runs the service. SQLite and HTTP operation do not import this dependency.

```sh
python3 -m pip install 'psycopg[binary]==3.3.6'
```

Create the customer schema through the normal database migration process. From the application directory, generate the exact table migration for that schema:

```sh
python3 -m mercury_ops.delivery_postgres --schema public --table mercury_events > mercury-events.sql
PGSERVICE=customer_migration psql --set=ON_ERROR_STOP=1 --file=mercury-events.sql
```

`--help` and migration generation do not open a database connection. Schema and table names are case-sensitive simple identifiers with at most 63 characters. The generated migration uses quoted identifiers. It intentionally reports an existing table as an error so a different schema cannot be accepted silently. Review and apply it once with the customer's migration identity.

The table contains:

| Column | PostgreSQL type | Purpose |
| --- | --- | --- |
| `event_key` | `TEXT PRIMARY KEY` | Original application event ID and destination idempotency key |
| `payload_sha256` | `TEXT` | SHA-256 of the encoded envelope bytes |
| `network`, `provider_scope`, `provider_base` | `TEXT` | Original source scope |
| `provider_row_id` | `INTEGER` | Mercury's opaque signed 32-bit canonical row ID |
| `contract_id`, `tx_hash` | `TEXT` | Original canonical contract and transaction |
| `event_index` | nullable `INTEGER` | Provider value, including an original `null` |
| `canonical_json` | `JSONB` | Complete canonical row for customer queries |
| `envelope_bytes` | `BYTEA` | Exact encoded envelope, including original canonical values |
| `received_at` | `TIMESTAMPTZ` | First destination insert time; retained on replay |

Grant the service role only the access its delivery transaction uses. Substitute the customer's actual role and selected schema/table:

```sql
GRANT USAGE ON SCHEMA "public" TO "mercury_delivery";
GRANT INSERT, SELECT ON TABLE "public"."mercury_events" TO "mercury_delivery";
```

The migration identity owns the table. Delivery does not issue `CREATE`, `UPDATE`, `DELETE`, or `TRUNCATE`. Keep the destination table append-only, with normal customer database backup and retention procedures. Add business-specific indexes through the customer's migrations when the consuming query needs them.

## Configure the original workspace

Before starting a new workspace's worker, set its existing configuration's destination:

```json
{
  "kind": "postgres",
  "dsn_env": "MERCURY_CUSTOMER_DATABASE_URL",
  "schema": "public",
  "table": "mercury_events"
}
```

Keep this object under `destination` in the full `config.json`. Leave the actual provider network, account label, API base, contracts and workspace attached to their original source. The application retains this source and destination configuration with its operations database.

Set `MERCURY_CUSTOMER_DATABASE_URL` in the service environment or the explicitly selected private `NAME=value` file. A libpq service name keeps connection details outside application configuration:

```text
MERCURY_CUSTOMER_DATABASE_URL=service=customer_mercury_delivery
```

Configure that service through the customer's normal PostgreSQL connection setup, including host, database, delivery role, certificate validation and credential custody. A network connection can use `sslmode=verify-full` with the customer's trusted root certificate. The adapter passes the selected DSN directly to Psycopg and preserves its TLS settings. It never prints the DSN, password, server error text or event values in a connection error. The regular operator configuration shows only the destination kind, schema and table.

Start the existing service, including its original operator UI and worker:

```sh
python3 -m mercury_ops --config /srv/mercury/config.json --env-file /srv/mercury/secrets.env serve
```

The selected environment file must be a regular private file with mode `600`. It is parsed as `NAME=value`; it is never evaluated as shell code. The provider JWT, webhook HMAC secret and operator token keep their existing separate configuration. Rotating credentials should retain the same logical customer database. A different customer destination belongs to a separately configured workspace and its deliberate catch-up operation.

## Commit, replay and recovery

The adapter uses one PostgreSQL transaction at `READ COMMITTED` isolation. `INSERT ... ON CONFLICT (event_key) DO NOTHING` arbitrates concurrent deliveries of one key. If another transaction wins, the following statement reads its committed row and compares both the retained digest and the complete envelope bytes. Matching bytes return the first row's receipt and `received_at`; different bytes return a conflict without modifying the row.

A delivered result leaves the adapter only after the connection context has committed. The adapter enables synchronous commit if the connection was configured with it off and preserves stronger customer settings. PostgreSQL server durability, backups and failover remain part of the customer's database configuration. `request_timeout_seconds` bounds connection attempts and individual SQL/lock waits; libpq rounds a connection timeout up to at least two seconds. The worker's existing backoff and maximum-attempt settings govern subsequent attempts.

If the database commits but the process or connection ends before the application retains its acknowledgement, the original delivery task can run again. It receives the stored event's receipt instead of inserting another row. PostgreSQL therefore participates in the application's existing automatic recovery of interrupted retry-safe deliveries.

Use the same operator delivery detail or CLI to inspect a retained event and its attempt history:

```sh
python3 -m mercury_ops --config /srv/mercury/config.json --env-file /srv/mercury/secrets.env show delivery EVENT_ID
```

Receipts include `event_id`, `payload_sha256`, `schema`, `table`, `received_at` and `reused`. For a conflict they retain the original destination digest separately as `retained_payload_sha256`. For a native database error they include its `sqlstate` when PostgreSQL supplies one.

| Outcome | Worker behavior | Operator action |
| --- | --- | --- |
| Committed event or identical retained bytes | `delivered` with the stored receipt | Continue consuming the destination row |
| Connection loss, database restart, serialization/deadlock, resource pressure or timed-out wait | Retry the same retained key using normal backoff | Restore the database or capacity; inspect attempts if the configured limit is exhausted |
| Authentication, missing table/column, insufficient permission, read-only target or rejected data | Retain a failed delivery and SQLSTATE | Correct the selected credential, migration, target or source issue, then retry the retained delivery |
| Same key with different bytes | Retain a failed conflict and the first row | Compare the original provider event, application envelope and destination row; preserve the accepted event while resolving the discrepancy |

After resolving a failed destination operation, queue its original delivery again:

```sh
python3 -m mercury_ops --config /srv/mercury/config.json --env-file /srv/mercury/secrets.env retry delivery EVENT_ID
```

The running worker consumes that retained task. For an intentionally separate command-line worker, `run-once --max-operations 100` processes queued work through the same engine. Worker locking and restart recovery continue to belong to the original application.

## Customer consumption

An application can look up the accepted event by key, inspect `canonical_json`, or read the full encoded envelope:

```sql
SELECT event_key, provider_row_id, contract_id, tx_hash, event_index,
       canonical_json, convert_from(envelope_bytes, 'UTF8') AS envelope_json,
       payload_sha256, received_at
FROM "public"."mercury_events"
WHERE event_key = $1;
```

`canonical_json` supports PostgreSQL JSON queries; `envelope_bytes` preserves the application's exact encoded bytes for comparison and export. Original provider HTTP response bytes remain in the application's retained observations. `received_at` is a destination timestamp, while Mercury catch-up continues to use the original provider row ID and saved query scope.

The transactional delivery guarantee covers the event table insert. A customer handler can extend it to its business changes by recording the consumed `event_key` and those changes in one customer database transaction. Independent external side effects need the customer's own idempotent operation contract.

## Source contracts

- [Mercury Classic canonical contract events](https://docs.mercurydata.app/mercury-classic/queries/1.-contract-events)
- [Mercury Classic raw-body webhook authentication](https://docs.mercurydata.app/mercury-classic/webhooks)
- [PostgreSQL INSERT and ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html)
- [Psycopg transaction contexts](https://www.psycopg.org/psycopg3/docs/basic/transactions.html)
- [Optional Psycopg installation](https://pypi.org/project/psycopg/)
