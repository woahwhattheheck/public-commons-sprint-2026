# Completed result delivery

Deliver the exact output of a completed paid job to a configured customer receiver. The sender borrows the original merchant model, settlement identity and retained result, adds a durable delivery queue, and records the receiver's acknowledgment against that same output.

The paired [result receiver](../result-receiver/README.md) accepts the signed result stream, stores it durably and exposes a separate private operator workspace for inspection and download.

## Run with the merchant

Copy [destinations.example.json](./destinations.example.json) to the merchant's private configuration directory and replace the example HTTPS endpoint with the customer's declared receiver URL. The sender and receiver must use the same destination ID, exact URL and shared secret.

Load a randomly generated secret of at least 32 bytes into the environment variable named by `secretEnv`. Configure the same secret in the receiver's environment. Configuration files and delivery records retain the environment variable name.

From the Starforge source root:

```bash
node sf30-seller-sdk/jobs/cli.mjs serve \
  --config /srv/starforge/merchant.json \
  --state /srv/starforge/merchant-state \
  --native-factory /srv/starforge/native-factory.mjs \
  --start-worker \
  --delivery-config /srv/starforge/destinations.json \
  --start-delivery
```

The service prints its existing seller, customer and private operator addresses, plus a complete `deliveries` address. Open that address to collect completed jobs, send due results, run or stop automatic delivery, inspect attempt history, requeue a failed delivery and export the retained ledger.

`--delivery-config` enables the delivery workspace. `--start-delivery` starts its dispatcher automatically. The existing merchant owns execution and settlement; the result-delivery queue sends the completed output.

The private delivery page is `/deliveries` on the original operator listener, using its existing fragment token, bearer authentication, loopback binding and same-origin policy. Stop interrupts active delivery requests. The next delivery attempt uses the same retained manifest and delivery ID.

## Destination configuration

```json
{
  "schema": "stellar-forge.job-result-destinations.v1",
  "destinations": [
    {
      "id": "customer-results",
      "url": "https://results.customer.example/starforge/results",
      "allowedHost": "results.customer.example",
      "secretEnv": "STARFORGE_JOB_DELIVERY_SECRET",
      "enabled": true
    }
  ],
  "concurrency": 2,
  "pollIntervalMs": 30000,
  "attemptLimit": 8,
  "timeoutMs": 15000
}
```

| Field | Behavior |
| --- | --- |
| `id` | Stable recipient identifier, unique within this configuration. |
| `url` | Exact public HTTPS receiver URL, including a non-root path. |
| `allowedHost` | Exact declared hostname. The original SF98 destination and DNS rules apply. |
| `secretEnv` | Name of the environment variable containing the shared secret. |
| `functionIds` | Optional list of existing merchant function IDs; omission selects all functions. |
| `completedAfter` | Optional ISO timestamp selecting completed jobs at or after that timestamp. |
| `enabled` | Defaults to true. A disabled destination pauses its retained deliveries. |
| `concurrency` | Concurrent delivery workers; default 2, range 1–16. |
| `pollIntervalMs` | Automatic collection interval; default 30,000, range 250–300,000. |
| `attemptLimit` | Attempts in the current retry budget; default 8, range 1–100. |
| `timeoutMs` | Whole-attempt deadline covering DNS and HTTPS; default 15,000, range 100–60,000. |

A configuration may contain 1–32 destinations. Secret values must contain 32–1,024 UTF-8 bytes. A missing or invalid secret appears in destination readiness and leaves its jobs queued.

Reload configuration by restarting the owning service. Disabled, removed or newly excluded destinations pause matching retained deliveries. A changed destination ID or URL produces a different delivery identity, so acknowledgment from the old endpoint cannot satisfy the new destination.

## Foreground and offline commands

The existing merchant state lease has one owner. Use the private delivery workspace while the service is running. To operate through the offline CLI, stop that service and open the same merchant configuration and state:

```bash
node sf30-seller-sdk/jobs/cli.mjs delivery status \
  --config /srv/starforge/merchant.json \
  --state /srv/starforge/merchant-state \
  --destinations /srv/starforge/destinations.json
```

| Command | Result |
| --- | --- |
| `status` | Retained queue, destination readiness, counters and last run. |
| `scan` | Queue selected completed paid-job results. |
| `drain` | Collect and send currently due deliveries, then exit. |
| `work` | Run collection and delivery until SIGINT or SIGTERM. |
| `show --id DELIVERY_SHA256` | One manifest, revision, receipt, retry budget and recent attempts. |
| `requeue --id DELIVERY_SHA256 --revision N --reason TEXT` | Renew the attempt budget for a RETRY or EXHAUSTED delivery. |

Each command accepts the same three required configuration/state arguments above. Requeue requires the exact current revision and a reason of 1–500 characters. A delivered result keeps its completed acknowledgment.

## Retention and retries

State is stored in the merchant's `result-delivery/` directory with a separate Linux flock lease. Its source record pins the original merchant's configuration digest, application digest and public origin. Records are private JSON files, written through create-new temporary files, file fsync, atomic rename and directory fsync.

Each destination receives one immutable manifest per completed result. The first enqueue freezes its completion metadata. Later job label updates leave that retained manifest intact. The sender checks the current job identity and verifies the original result's length, digest, media type and filename before transmission.

An attempt is retained as SENDING before opening the result. Reopening an interrupted sender converts that attempt to RETRY, preserving its original delivery identity. Attempt budgets are checked against the current persisted row in the same serialized operation that begins a send, including when an operator has just requeued it.

Ordinary failed deliveries retry after 30 seconds, doubling up to 30 minutes. A valid `Retry-After` moves that time later when the receiver asks for more time. A changed original job/result exhausts the delivery for operator inspection. A failed durable queue write stops further transmission and sets `reopenRequired`; restore writable storage and restart the owning service so the original state can recover.

The queue supports 100,000 retained delivery records and retains the most recent 64 attempts and operator history entries per delivery, together with lifetime attempt counts. It stores references and acknowledgment data; result bytes stay in the original completed job. Each result is limited to 64 MiB.

## Signed result contract

The request is a POST whose body is the exact original result. The default transport uses the original [SF98 HTTPS and public-DNS selection](../../../sf98-merchant-delivery/deliver.mjs), with an explicit hostname, pinned addresses, port 443 and no redirects.

| Header | Value |
| --- | --- |
| `Content-Type` | Original result media type. |
| `Content-Length` | Exact result byte count. |
| `Idempotency-Key` | Stable delivery SHA-256 identity. |
| `X-Content-SHA256` | Original result SHA-256. |
| `X-SFJobs-Manifest` | Unpadded base64url of the UTF-8 JSON manifest. |
| `X-SFJobs-Timestamp` | Whole Unix seconds at signing. |
| `X-SFJobs-Manifest-Signature` | `sha256=` plus the hexadecimal manifest HMAC. |
| `X-SFJobs-Signature` | `sha256=` plus the hexadecimal complete-body HMAC. |

The manifest contains schema, delivery ID, merchant source digests and origin, exact destination, job ID/function/input digest/completion time, original native settlement ID/time, and result digest/length/media type/filename. The delivery ID is SHA-256 over the ordered JSON array of schema, merchant configuration digest, application digest, origin, destination ID, destination URL, job ID and result digest.

The HMAC-SHA-256 inputs are:

```text
manifest authentication = "manifest." + timestamp + "." + manifestHeader
complete result         = timestamp + "." + manifestHeader + "." + rawResultBytes
```

The receiver checks manifest authentication before accepting result bytes, applies a 300-second timestamp window, then verifies the full stream and digest before durable storage. The manifest header is limited to 12 KiB. A repeated delivery verifies the complete retained manifest and result before returning its existing acknowledgment.

Successful delivery requires a 2xx JSON response matching every field below:

```json
{
  "schema": "stellar-forge.job-result-received.v1",
  "deliveryId": "<the exact delivery SHA-256>",
  "resultSha256": "<the exact result SHA-256>",
  "bytes": 279,
  "state": "STORED"
}
```

The sender accepts an acknowledgment body up to 16 KiB and retains the canonical matching fields. Additional receiver metadata may accompany them. A successful HTTP status alone leaves an unmatched or incomplete acknowledgment eligible for retry.

## Embedded use

```js
import { readDeliveryConfig } from './result-delivery/config.mjs';
import { openResultDelivery } from './result-delivery/dispatcher.mjs';
import { startJobsWorkspace } from './workspace/server.mjs';

const delivery = await openResultDelivery({
  model,
  config: await readDeliveryConfig('/srv/starforge/destinations.json'),
});
const workspace = await startJobsWorkspace({ model, delivery });
delivery.start();

// In the owning service's shutdown:
await delivery.close();
await workspace.close();
await model.close();
```

The dispatcher exports `snapshot/get/scan/drain/start/stop/requeue/close`. Wire helpers are exported separately from `wire.mjs` for compatible receivers. The embedding owns the merchant lifetime; close delivery before its workspace and model so interrupted network operations can finish retaining their attempt state.
