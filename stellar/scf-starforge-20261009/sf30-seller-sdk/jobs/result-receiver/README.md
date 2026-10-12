# Customer job result receiver

Run a customer-owned receiving service for completed Starforge paid-job output. The merchant pushes the original result bytes; the receiver stores the file, delivery manifest and acknowledgment together before acknowledging delivery. The private customer desk lists output, verifies stored bytes, previews text and downloads the original file.

## Start receiving

From `sf30-seller-sdk`, use Node 24 and the same Linux `flock` support as the existing merchant delivery worker.

1. Copy `jobs/result-receiver/receiver.example.json` into your deployment configuration. Set the exact HTTPS destination URL, destination ID, accepted merchant origin and result size limit. The destination ID and URL must also appear in the merchant's result-delivery configuration.
2. Provision a shared signing secret of 32–1024 UTF-8 bytes to the receiver and merchant through the environment variable named by `secretEnv`. A random 32-byte value encoded as base64url is suitable. Keep the value in your service secret manager or private process environment.
3. Initialize a new absolute directory whose parent already exists. The receiver creates private directories and files and uses a lifetime lease while serving.
4. Run the service behind your HTTPS reverse proxy, forwarding the configured receiving path to its public intake listener. Use a fixed `--port` for deployment. Open the separately printed private operator URL on the receiver machine or through an SSH tunnel.

```sh
node jobs/result-receiver/cli.mjs init \
  --root /srv/starforge/customer-results \
  --config /etc/starforge/result-receiver.json

node jobs/result-receiver/cli.mjs serve \
  --root /srv/starforge/customer-results \
  --port 8788 \
  --operator-port 8789
```

The same commands are available under `starforge jobs receiver`. `serve` reads the signing secret from the configured environment. It prints the local intake URL and an operator URL containing a separate generated access token. `--operator-token-env ENV_NAME` can supply a stable private operator token of 32–512 bytes. The customer desk consumes that token from the URL fragment, clears the fragment and retains access for the browser tab.

The intake listener defaults to `127.0.0.1`; `--host` selects another bind address when the deployment requires it. The operator listener always binds to `127.0.0.1` and checks its own Host, Origin and bearer token. Route only the intake port through the public proxy. Configure the proxy to preserve the signed headers and exact body, with a request size limit at least as large as the receiver's selected maximum. Forward the exact configured path without a query string.

## Customer desk

Open the operator URL printed by `serve`. The desk shows the destination, accepted merchant identities, total stored results, active uploads and configured size limit. Results are paginated in groups of 50; the filter applies to the current page.

Selecting an output shows the original job and function, merchant origin, filename, content type, completion and receipt times, byte count, delivery ID and SHA-256. The preview verifies the stored file first and displays at most 32 KiB as plain text. The download action verifies the same open file before streaming the original bytes as an attachment. Manifest and receiver receipt downloads retain their complete JSON records.

`Verify stored bytes` recomputes the result hash and reports the verification time. `Lock workspace` clears the tab's access token and loaded result data.

## Inspect, recover and export

All paths are absolute. Use the original receiver directory for every command.

```sh
node jobs/result-receiver/cli.mjs list --root /srv/starforge/customer-results
node jobs/result-receiver/cli.mjs show --root /srv/starforge/customer-results --id DELIVERY_ID
node jobs/result-receiver/cli.mjs verify --root /srv/starforge/customer-results --id DELIVERY_ID
node jobs/result-receiver/cli.mjs export --root /srv/starforge/customer-results \
  --id DELIVERY_ID --out /srv/starforge/exports/NEW_DIRECTORY
```

Export creates a new destination, preserving the original filename beneath `result/` alongside `delivery-manifest.json` and `receiver-receipt.json`. It writes `export.json` with `state: COMPLETE` last. An existing destination is preserved; choose a new path for each export.

Startup recovers completed incoming directories under the original worker lease. A completed staged file with matching manifest and receipt is published to the stored results directory. Interrupted uploads without complete metadata are cleared. Unknown entries or conflicting complete data remain available for inspection and are listed in the startup recovery result and customer desk.

For a manual recovery report, stop the receiver and run:

```sh
node jobs/result-receiver/cli.mjs recover-incoming --root /srv/starforge/customer-results
```

SIGINT and SIGTERM stop accepting new work, finish active operations and then release the lease. Uploads and operator downloads have inactivity timeouts. At most four uploads run concurrently by default; `--max-concurrent` accepts 1–16.

## Storage and identity

The receiver's `receiver.json` selects one destination and one or more accepted merchant origins. An accepted merchant can additionally pin `configSha256`, `applicationSha256`, or both. Each pin is the complete lowercase 64-character hash from the original merchant/application identity. The manifest must match the selected destination and at least one complete merchant selector.

Results are stored under `results/DELIVERY_ID/` as `body`, `manifest.json` and `receipt.json`. Incoming bytes are written beneath `incoming/` with exclusive private files. The file and metadata are synchronized before directory publication; the results directory is synchronized before acknowledgment. A duplicate must match the full original manifest and verified stored bytes and returns the original receipt.

The source manifest carries the original job ID, function, input hash, completion time, native settlement reference, result hash, byte count, content type and filename. Its stable delivery ID joins the selected merchant, destination, job and result. Retrying delivery preserves that identity and output.

## Receiver protocol for integrations

The sender sends one HTTPS POST containing the raw result bytes. Request redirects are rejected. The destination is selected by the merchant's configured route and checked by its existing public HTTPS transport policy.

| Header | Value |
| --- | --- |
| `content-type` | Exact `manifest.result.contentType` |
| `content-length` | Exact decimal `manifest.result.bytes` |
| `idempotency-key` | `manifest.deliveryId` |
| `x-content-sha256` | `manifest.result.sha256` |
| `x-sfjobs-manifest` | Canonical base64url encoding of the UTF-8 manifest JSON, without padding |
| `x-sfjobs-timestamp` | Current integer Unix time in seconds |
| `x-sfjobs-manifest-signature` | `sha256=` followed by HMAC-SHA256 of `manifest.` + timestamp + `.` + manifest header |
| `x-sfjobs-signature` | `sha256=` followed by HMAC-SHA256 of timestamp + `.` + manifest header + `.` + the exact raw body bytes |

Use `../result-delivery/wire.mjs` to validate and encode manifests and calculate signatures. The receiver authenticates the manifest before staging a body, accepts timestamps within 300 seconds of its clock, then streams and checks the full body signature, SHA-256 and byte count. Keep the sender and receiver clocks synchronized. The receiver returns 201 for a newly stored result and 200 for an identical duplicate.

The successful JSON response contains:

```json
{
  "schema": "stellar-forge.job-result-received.v1",
  "deliveryId": "<same delivery ID>",
  "resultSha256": "<same result SHA-256>",
  "bytes": 123,
  "state": "STORED",
  "receivedAt": "<receiver UTC timestamp>"
}
```

The sender accepts an acknowledgment only when its schema, state, delivery ID, result hash and byte count match the recorded manifest. Lost acknowledgments are safe to retry: the receiver returns the same original receipt after verifying the duplicate. The merchant's operator delivery workspace exposes the persisted attempt history and explicit retry controls.

See the [merchant delivery guide](../result-delivery/README.md) for route configuration, automatic dispatch and original job-workspace controls.
