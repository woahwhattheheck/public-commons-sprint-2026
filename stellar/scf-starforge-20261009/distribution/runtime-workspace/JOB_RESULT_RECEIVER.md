# Installed paid-job result receiving

Use the maintained Starforge installation to receive completed application-job files into a private customer directory. The merchant sends the exact retained output, source and payment identity. The receiver stores the original bytes and acknowledgment, then opens its separate operator desk through the existing Applications lifecycle.

The original paid-job checkout remains available as **Paid application jobs**. This receiving application is **Paid-job result receiver**: it keeps a customer's completed outputs available after the original merchant has closed or moved on to later jobs.

## Select the original installation

Use Linux, Node 22.16 or newer and the existing util-linux `flock` command. The receiving CLI, durable store and browser desk use Node built-ins and the original delivery lease. Select the base runtime with `--operator`; receiving does not need an additional npm feature. The original merchant continues to use its existing native payment and schema runtime.

Choose a maintained archive containing the result receiver, the installed helper and the Applications catalog join. Keep its original SHA-256 digest. The [runtime installation guide](../RUNTIME_INSTALL.md) describes preparation, installation and recovery:

~~~sh
starforge runtime-install prepare \
  --dir /srv/starforge/runtimes/results-01 \
  --archive /srv/starforge/downloads/starforge-original.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --operator

starforge runtime-install install --dir /srv/starforge/runtimes/results-01

starforge runtime-install inspect --dir /srv/starforge/runtimes/results-01

starforge runtime-install run \
  --dir /srv/starforge/runtimes/results-01 -- jobs receiver --help
~~~

Use the actual archive path and digest. An already READY installation can be selected directly. Receiver state and exported customer files belong in private directories outside the installation, so the same state can be reopened from a later reviewed source release.

All commands below use the installed entry point. The equivalent original source is `sf30-seller-sdk/jobs/cli.mjs receiver`.

## Configure the customer destination once

Start with an existing private parent, such as `/srv/starforge/customers`. Create one private configuration directory owned by the operator:

~~~sh
mkdir -m 700 /srv/starforge/customers/job-results
umask 077
~~~

Save this as `/srv/starforge/customers/job-results/receiver-config.json`, replacing the HTTPS destination and merchant origin with the actual selected values:

~~~json
{
  "schema": "stellar-forge.job-result-receiver.v1",
  "destination": {
    "id": "customer-results",
    "url": "https://results.customer.example/starforge/results"
  },
  "merchants": [
    {
      "publicOrigin": "https://merchant.example"
    }
  ],
  "maxResultBytes": 67108864,
  "secretEnv": "STARFORGE_JOB_DELIVERY_SECRET"
}
~~~

The destination ID and full canonical HTTPS URL must equal the merchant's destination configuration. The merchant origin is its actual original public origin. To accept only a specific merchant configuration or application version, add its actual `configSha256` or `applicationSha256` to that merchant entry. Those hashes come from the merchant's existing source identity.

Create the original receiver state once:

~~~sh
starforge runtime-install run \
  --dir /srv/starforge/runtimes/results-01 -- \
  jobs receiver init \
  --root /srv/starforge/customers/job-results/received \
  --config /srv/starforge/customers/job-results/receiver-config.json
~~~

Initialization creates the private `received` directory, `receiver.json`, and its `results` and `incoming` directories. Later starts reopen this same directory. The stored configuration is the receiving contract; changing the input file passed to `init` does not change an already initialized receiver.

## Install the shared secret in the private environment

The sender and receiver use the same random HMAC secret. Its length is 32–1024 UTF-8 bytes. The configuration stores its environment-variable name. Applications can load its value from a private environment JSON file owned by the same operator.

Generate that file once; this command creates a new private file and prints no secret:

~~~sh
node --input-type=module - \
  /srv/starforge/customers/job-results/receiver-environment.json <<'NODE'
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
writeFileSync(process.argv[2], JSON.stringify({
  STARFORGE_JOB_DELIVERY_SECRET: randomBytes(48).toString('base64url'),
}) + '\n', { flag: 'wx', mode: 0o600 });
NODE
~~~

Install the same value under `STARFORGE_JOB_DELIVERY_SECRET` in the merchant's existing private environment. Use the deployment's normal private configuration transfer. Applications verifies the environment file's ownership, permissions, content digest and current value before the managed child starts.

## Save and start the customer in Applications

Open the existing runtime workspace and select the READY runtime containing this feature. In **Applications**, choose **Paid-job result receiver**.

| Field | Selection |
| --- | --- |
| Initialized private receiver directory | `/srv/starforge/customers/job-results/received` |
| Receiving port | A fixed local HTTP port used by the existing HTTPS proxy, such as `8470`; `0` chooses an available port. |
| Private operator port | `0` for an available loopback port, or a fixed private port such as `8471`. |
| Private environment JSON | `/srv/starforge/customers/job-results/receiver-environment.json` |
| Label | A useful customer or delivery label. |

Choose **Review**, inspect the selected runtime, receiver directory, configuration and command, then **Save**. Choose **Review start** and **Start** on that same saved application. The maintained worker owns the original process and receiver lease.

The helper reopens the selected installation's original receiver reader. Its startup is accepted only when the actual opened receiver reports the selected canonical directory, normalized configuration SHA-256, destination and listening ports. The original receiver's public intake and private operator desk must be distinct listeners. **Open** points to the private desk.

The shared Applications controller retains the original runtime/source binding, input-file identities, private environment digest, process operation and application URL. Reopening the runtime browser returns to that operation. Its existing output view contains the receiver's startup announcement and concrete process failures.

### Connect the destination

Configure the deployment's HTTPS endpoint at the exact destination URL to forward the POST path to the receiving listener. For the example above, forward `/starforge/results` to `http://127.0.0.1:8470/starforge/results` on the receiver host. Preserve the request headers and body exactly and pass the receiver's status, response headers and acknowledgment body back to the sender.

The private operator listener is a separate localhost service. **Open** carries its session token in the URL fragment and the browser sends bearer authentication only to that private origin.

For a foreground deployment, load the same selected secret through the normal environment and run the original command:

~~~sh
starforge runtime-install run \
  --dir /srv/starforge/runtimes/results-01 -- \
  jobs receiver serve \
  --root /srv/starforge/customers/job-results/received \
  --host 127.0.0.1 --port 8470 --operator-port 8471
~~~

The single-line ready announcement contains `root`, `configSha256`, `pid`, `destination`, `receiverUrl` and `operatorUrl`. The root and configuration fingerprint come from the server's actual opened store. The fingerprint is SHA-256 of JSON serialization of the original reader's normalized configuration.

## Enable delivery on the original merchant

Save the paired merchant destination configuration, using the same destination and secret name:

~~~json
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
~~~

Add `--delivery-config /srv/starforge/merchant/destinations.json --start-delivery` to the original `jobs serve` invocation. Keep the same merchant configuration, state, native factory, ports and worker selections used by that merchant. Its existing jobs page gains **Result delivery**, and startup prints the complete private delivery URL.

In the delivery desk, collect completed results, run or stop automatic sending, inspect delivery attempts and open the retained receiver receipt. Optional `functionIds` and `completedAfter` on a destination select the original completed jobs that belong to that recipient.

The completed job and its result remain the source of execution and payment identity. The delivery dispatcher freezes the complete manifest when first enqueued. Later job labels or timestamps do not rewrite that delivery. Restarting delivery continues the same receiver identity and original output.

### Operate a closed merchant from the installed CLI

While the original merchant service owns its state, use its delivery desk. When the service is closed, the installed commands reopen that same original state:

~~~sh
starforge jobs delivery status \
  --config /srv/starforge/merchant/merchant.json \
  --state /srv/starforge/merchant/state \
  --destinations /srv/starforge/merchant/destinations.json

starforge jobs delivery scan \
  --config /srv/starforge/merchant/merchant.json \
  --state /srv/starforge/merchant/state \
  --destinations /srv/starforge/merchant/destinations.json

starforge jobs delivery drain \
  --config /srv/starforge/merchant/merchant.json \
  --state /srv/starforge/merchant/state \
  --destinations /srv/starforge/merchant/destinations.json
~~~

Use `work` for foreground automatic delivery. `drain` sends currently due retained deliveries. A future retry keeps its persisted due time.

If an operator wants another retry budget, inspect the delivery's current revision and requeue it with a reason:

~~~sh
starforge jobs delivery show \
  --config /srv/starforge/merchant/merchant.json \
  --state /srv/starforge/merchant/state \
  --destinations /srv/starforge/merchant/destinations.json \
  --id DELIVERY_SHA256

starforge jobs delivery requeue \
  --config /srv/starforge/merchant/merchant.json \
  --state /srv/starforge/merchant/state \
  --destinations /srv/starforge/merchant/destinations.json \
  --id DELIVERY_SHA256 --revision CURRENT_REVISION \
  --reason "Customer endpoint configuration repaired"
~~~

This preserves the manifest, lifetime attempt history and completed output. The next attempt uses the current retry budget and the original delivery ID.

## Receive, inspect and hand over the complete result

The receiver desk shows the destination, accepted merchants and saved outputs. Select an output to inspect its original job/function, merchant source, settlement identity, result type, byte count and SHA-256. The text preview reads a limited view of the verified original file. **Verify** checks the complete saved file; **Download** returns its original bytes.

The installed receiver commands can inspect retained results while the service is running:

~~~sh
starforge runtime-install run \
  --dir /srv/starforge/runtimes/results-01 -- \
  jobs receiver list --root /srv/starforge/customers/job-results/received

starforge runtime-install run \
  --dir /srv/starforge/runtimes/results-01 -- \
  jobs receiver show --root /srv/starforge/customers/job-results/received \
  --id DELIVERY_SHA256

starforge runtime-install run \
  --dir /srv/starforge/runtimes/results-01 -- \
  jobs receiver verify --root /srv/starforge/customers/job-results/received \
  --id DELIVERY_SHA256
~~~

Create a complete handover in a new absolute directory outside the receiver state:

~~~sh
starforge runtime-install run \
  --dir /srv/starforge/runtimes/results-01 -- \
  jobs receiver export \
  --root /srv/starforge/customers/job-results/received \
  --id DELIVERY_SHA256 \
  --out /srv/starforge/customers/job-results/customer-delivery-01
~~~

| Exported path | Content |
| --- | --- |
| `result/ORIGINAL_FILENAME` | Complete original output file. |
| `delivery-manifest.json` | Exact validated merchant, job, settlement, recipient and result metadata. |
| `receiver-receipt.json` | Original durable STORED acknowledgment. |
| `export.json` | COMPLETE marker, delivery ID, byte count, result SHA-256 and relative result filename. |

Use the actual saved delivery ID returned by the receiver. The export verifies the body as it copies it, creates the target directory without replacing an existing target and writes the completion marker last. If an interrupted export left a target without its completion marker, retain that partial directory and export the same original delivery into a new directory.

## Stop, recover and reopen

Use **Stop** on the saved Applications operation. The original receiver stops accepting new requests, drains its active intake and downloads, closes both listeners and releases its original lease. Foreground `SIGINT` or `SIGTERM` follows the same close path. A later **Review start** and **Start** reopens the same receiver directory and stored results.

An interrupted upload cannot become a received result. At the next owned server start, the original lease protects recovery of abandoned incoming stages before new receiving begins. The standalone `recover-incoming --root DIRECTORY` command uses that same lease.

If the customer stored a result but the merchant lost the acknowledgment, the merchant retries the same frozen manifest and exact bytes. The receiver verifies that retry, compares the complete retained manifest and original body, then returns the same stored receipt. The sender accepts the exact receipt schema, delivery ID, result digest, byte count and STORED state before recording delivery.

The original wire authenticates the timestamp and manifest before staging a body, then authenticates the complete stream. It enforces the selected merchant/destination, a 300-second timestamp window, the configured result limit up to 64 MiB and the 12-KiB manifest-header limit. The sender uses the original declared-host/public-DNS/HTTPS transport and does not follow redirects.

Configuration errors and delivery failures remain in the original CLI output, retained attempt records and private workspaces. After a sender storage failure, reopen the same sender store before continuing so an interrupted attempt is recovered from its actual persisted state.

## Stable installed imports

The maintained package exports the original implementation modules:

| Package subpath | Main exported API |
| --- | --- |
| `seller/jobs/result-delivery` | `openResultDelivery` dispatcher over the original merchant model. |
| `seller/jobs/result-delivery/config` | Destination configuration validation and file reading. |
| `seller/jobs/result-delivery/store` | Durable delivery state and exact attempt/requeue operations. |
| `seller/jobs/result-delivery/transport` | Original signed HTTPS sending and receipt handling. |
| `seller/jobs/result-delivery/wire` | Manifest, signing and acknowledgment contract. |
| `buyer/jobs/result-receiver` | `initializeReceiver`, `openResultReceiver` and configuration validation. |
| `buyer/jobs/result-receiver/server` | `startResultReceiver` with public intake and private operator listeners. |
| `runtime-workspace/job-result-receiver` | Original Applications catalog, preparation and startup helpers. |

For an initialized customer store:

~~~js
import { openResultReceiver } from
  '@tokenjunkielabs/starforge-merchant/buyer/jobs/result-receiver';

const receiver = await openResultReceiver('/srv/starforge/customers/job-results/received');
const page = await receiver.list({ limit: 50 });
for (const result of page.rows) {
  console.log(result);
}
~~~

The [original receiver guide](../../sf30-seller-sdk/jobs/result-receiver/README.md) documents the complete store, HTTP and operator API. The [original sender guide](../../sf30-seller-sdk/jobs/result-delivery/README.md) documents destination selection, retained retries and signed delivery.

## Maintained Applications composition

The additive helper is `distribution/runtime-workspace/application-job-result-receiver.mjs`. The shared catalog and managed observer use these original hooks:

- `jobResultReceiverApplication(common)` returns the single receiver catalog entry.
- `prepareJobResultReceiverApplication(settings, {inputPath, runtimeDirectory, applicationEnvironment})` returns native arguments, retained inputs and the selected receiver identity.
- The prepared command and managed-run request retain that identity under `jobResultReceiver`.
- `jobResultReceiverStartup(request, text)` returns the verified private URL and original startup metadata.

The existing shared command builder appends `--port` for the selected receiving port. The helper supplies `--operator-port` separately. Its state-directory field uses the existing application resource-key and lease semantics.

The ordinary distribution source selection already includes the complete SF30, SF98, fleet and distribution components. Sender assets are `sf30-seller-sdk/jobs/result-delivery/workspace/**`; receiver assets are `sf30-seller-sdk/jobs/result-receiver/public/**`. Their JavaScript has no relative browser-module imports, so these standalone desks use the existing physical-source selection without another browser URL mapping.
