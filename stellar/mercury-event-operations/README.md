# Mercury event operations

A retained Mercury Classic intake, reconciliation and customer-delivery workspace. It accepts authenticated webhook notifications, retrieves canonical transaction events, catches up explicit ledger ranges and delivers each scoped event to SQLite, PostgreSQL or an HTTP customer endpoint. The grayscale operator application shows source receipts, canonical events, page checkpoints, delivery attempts and recovery actions.

**Runtime:** Linux and Python 3.11 or later. SQLite, HTTP, the worker and the operator application use the Python standard library; the static interface needs no build step. PostgreSQL uses the optional driver and customer migration in [POSTGRES.md](POSTGRES.md).

## Start the original application

Run these commands from this source directory. Keep the private operating workspace beside the source:

```sh
python3 -B -m mercury_ops init ../mercury-customer --network mainnet
```

The command creates `config.json` and `secrets.env` with private file permissions and prints the operator token. Edit those existing files before starting the worker:

- Set `provider_scope` to the stable label for the actual Mercury account or subscription.
- Put the actual contract addresses in `contracts`. Each address begins with `C` and contains 56 characters.
- Select the customer `destination` before opening the operating database. The default is a separate SQLite customer event table inside this private workspace.
- Set `MERCURY_JWT` to the Mercury account's JWT and `MERCURY_WEBHOOK_SECRET` to the subscription's exact shared secret. Keep the generated `MERCURY_OPS_TOKEN`.

The environment file uses literal `NAME=value` lines without shell quoting or `export`. Keep it mode `600`. Existing process environment values take precedence over entries loaded from this file.

A complete configuration has this shape; replace the contract placeholder and account label with the actual operating selection:

```json
{
  "schema": "mercury-event-operations/v1",
  "workspace": ".",
  "network": "mainnet",
  "provider_scope": "customer-primary",
  "api_base": "https://mainnet.mercurydata.app/rest",
  "contracts": ["YOUR_56_CHARACTER_CONTRACT_ADDRESS"],
  "topic_filters": {},
  "destination": {
    "kind": "sqlite",
    "path": "customer-events.sqlite",
    "table": "mercury_events"
  },
  "page_size": 100,
  "request_timeout_seconds": 10,
  "retry_base_seconds": 5,
  "retry_max_seconds": 300,
  "max_attempts": 10,
  "worker_poll_seconds": 1,
  "max_body_bytes": 1048576
}
```

`topic_filters` optionally maps `topic1` through `topic10` to exact XDR-base64 values; all selected predicates must match. Each admitted transaction operation and catch-up job freezes its contracts and topic filters. New work can use later configuration after restarting the service; existing jobs retain their original scope. A different network, provider account, API base or customer destination uses a separate workspace.

Start the operator application and its owned worker:

```sh
python3 -B -m mercury_ops --config ../mercury-customer/config.json --env-file ../mercury-customer/secrets.env serve
```

Open `http://127.0.0.1:8787` and enter the generated operator token. The token remains in page memory until reload or disconnect. Overview shows provider/webhook readiness and worker state. Notifications, Canonical events, Catch-up ranges, Customer delivery and Worker tasks retain their original identifiers and paginated histories. Record detail can download the exact JSON response. Export and recovery exposes the complete operations download and recovery controls.

The webhook ingress is `/webhooks/mercury`. Configure the Mercury subscription's public HTTPS endpoint to reach that path, preserving the exact original request bytes and `X-Mercury-Signature` header. Intake commits its authenticated notification and canonical transaction task before acknowledging acceptance.

## Operate and inspect

The following shell function keeps the same explicit private configuration attached to each command:

```sh
mercury_customer() {
  python3 -B -m mercury_ops --config ../mercury-customer/config.json --env-file ../mercury-customer/secrets.env "$@"
}

mercury_customer status
mercury_customer catchup opening-range --ledger-from 400000 --ledger-to 400100 --page-size 100
mercury_customer list catchups
mercury_customer list deliveries --state failed
```

Choose the actual inclusive ledger range for the customer. A catch-up command retains the job; the running worker processes its pages. The canonical cursor is Mercury's event row ID, and the engine retains the requested ledger range separately. It walks to an empty provider page even when an earlier page contains fewer than the requested number of rows.

| Operation | Command |
| --- | --- |
| Reconcile a known transaction | `mercury_customer reconcile TX_HASH --operation-id source-transaction-1` |
| Read a catch-up and its frozen predicates | `mercury_customer show catchup opening-range` |
| Read an event and source digests | `mercury_customer show event EVENT_ID` |
| Read delivery attempts and destination receipt | `mercury_customer show delivery EVENT_ID` |
| Retry an inspected failed or uncertain delivery | `mercury_customer retry delivery EVENT_ID` |
| Retry an inspected task or catch-up | `mercury_customer retry task TASK_ID` or `mercury_customer retry catchup JOB_ID` |
| Cancel a catch-up, retaining its committed pages | `mercury_customer cancel JOB_ID` |
| Reconcile interrupted attempts | `mercury_customer recover` |
| Run a worker without the HTTP application | `mercury_customer worker` |

Use each returned `next_cursor` with `list ... --after CURSOR` for later pages. `list` permits up to 500 rows per page; task details show the latest 100 attempts. The complete export includes every retained attempt.

The worker uses a workspace kernel lock throughout its current operation. A second worker reports busy while the original runs. After a process interruption, the original task and delivery key guide recovery. [ENGINE-OPERATIONS.md](ENGINE-OPERATIONS.md) explains automatic retries, uncertain customer outcomes, webhook arrival races, canonical conflicts and complete source provenance.

## Customer destinations

The default SQLite destination creates a separate customer database and table. Canonical row IDs distinguish multiple events inside one transaction. Each delivery inserts or retrieves one event key and verifies the complete envelope digest before acknowledging it.

For HTTP, replace `destination` before opening the workspace database:

```json
{
  "kind": "http",
  "url": "https://customer.example.com/events",
  "token_env": "MERCURY_CUSTOMER_TOKEN",
  "hmac_secret_env": "MERCURY_CUSTOMER_HMAC",
  "idempotency_supported": true
}
```

Set the selected customer credential variables in the private service environment. Outgoing JSON includes the stable canonical envelope; headers carry `Idempotency-Key`, `X-Mercury-Ops-Payload-SHA256` and, when configured, the body HMAC in `X-Mercury-Ops-Signature`. Optional bearer authorization uses `token_env`. Set `idempotency_supported` to true when the customer commits its event key and effect together and recognizes repeat deliveries. This permits recovery after a customer commit whose HTTP acknowledgement was lost. The default false setting retains ambiguous delivery outcomes for explicit operator reconciliation.

[POSTGRES.md](POSTGRES.md) provides the complete optional driver, table migration, service role, configuration, native transaction behavior and customer consumption guide. All three destinations share the original engine, retained task history and operator interface.

## Export and portable recovery

Create an output directory, then retain a complete operations export or portable workspace archive:

```sh
mkdir -m 700 ../mercury-exports
mercury_customer export --out ../mercury-exports/operations.ndjson
mercury_customer export --events-only --out ../mercury-exports/events.ndjson
mercury_customer backup --out ../mercury-exports/workspace.zip
python3 -B -m mercury_ops restore --from ../mercury-exports/workspace.zip --into ../mercury-restored
```

Outputs use new filenames and return their byte count and SHA-256. The complete NDJSON export comes from one database snapshot and includes original webhook/provider bodies, all attempts, canonical rows, deliveries, source links and a final count record. The archive retains the operating database, configuration and an internal SQLite customer database when present. It holds the same worker lock while taking the joined snapshots.

Restore verifies the complete archive inventory and hashes, preserves an existing target directory, and publishes the recovered workspace atomically. An internal SQLite customer database is restored as `customer.sqlite3` and its workspace binding is updated consistently. External customer databases keep their configured endpoint and their own backup procedures. Retain the private credential file separately and pass it with `--env-file` when opening the restored configuration. These archives and exports contain the actual source and customer data.

## Deployment

Run the application under the existing service supervisor with its source directory as the working directory and a dedicated private data directory. For a public HTTPS hostname behind a trusted reverse proxy, use:

```sh
python3 -B -m mercury_ops --config /srv/mercury/config.json --env-file /srv/mercury/secrets.env serve --host 127.0.0.1 --port 8787 --allowed-host mercury-ops.example.com --behind-https-proxy
```

Replace the hostname and paths with the deployment values. The reverse proxy terminates HTTPS, forwards the configured `Host`, preserves webhook bodies and signature headers, and forwards operator bearer authorization. Keep the application listener reachable through that trusted proxy. The application checks the configured host and browser origin; the server-side provider and customer credentials stay with the service process. A non-loopback bind requires both explicit proxy flags.

`serve` reports worker status in Overview and through the status API. The configured operator token protects `/api/*`; webhook intake uses its Mercury HMAC secret. All API downloads carry `Cache-Control: no-store`. Configure process restart and persistent workspace storage through the host's normal supervisor.

## Recorded operating outcome

The joined native HTTP/CLI workflow completed on **2026-10-11 at 18:29:52 UTC**, using a local provider that implements the published Mercury Classic wire contract and the application's actual HTTP, SQLite, worker, export and recovery components.

- Four original provider rows produced three matching canonical customer events; the cursor advanced past the excluded fourth row to `4204`.
- Two equal-looking events in one transaction retained distinct row IDs and event indices.
- Four customer HTTP attempts produced three customer inserts. One destination commit followed by HTTP 500 reused its original event key on retry.
- Three catch-up pages completed after a restart from acknowledged intake.
- The complete HTTP export contained 38 records and 23,865 bytes; the actual CLI export retained the same full record inventory.
- The actual CLI archive restore preserved byte-identical canonical event envelopes. The focused internal SQLite recovery also retained its customer database and replayed its accepted event with one destination row.

The joined run took 0.597 seconds and used a measured 23,130,112-byte process peak. Its result SHA-256 is `a3cc4a4393a8685b7a086d1e1ff74f3522a3afd2ca3e8242917a2e4a36f44a31`. The reusable source is [native_journey.py](native_journey.py); operating behavior and acquisition sources are documented in [ENGINE-OPERATIONS.md](ENGINE-OPERATIONS.md).

## Primary provider sources

- [Mercury Classic endpoints](https://docs.mercurydata.app/genaral-info/endpoints)
- [Mercury Classic bearer-token queries](https://docs.mercurydata.app/mercury-classic/queries)
- [Canonical contract events and cursor queries](https://docs.mercurydata.app/mercury-classic/queries/1.-contract-events)
- [Mercury raw-body webhooks](https://docs.mercurydata.app/mercury-classic/webhooks)
