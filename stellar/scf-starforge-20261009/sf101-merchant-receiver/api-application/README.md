# Purchased application access

Run the original source-pinned SF30 application functions through an existing
SF101 API pass. A customer buys the pass through the original payment path and
uses its existing claim token to call a function. The original API allowance
reserves the route's units, and the native job store retains the corresponding
execution and exact response.

The complete customer purchase flow is in
[API pass purchase](../api-access/PURCHASE.md). Allowance and access controls are
in [API access](../api-access/README.md). The compiler, worker and durable result
store are the existing [application jobs](../../sf30-seller-sdk/jobs/) implementation.

## Configure the original merchant and application

The merchant needs its original private SF101 state, enrolled API-plan file,
receiver and signed settlement delivery, and an existing API gateway config for
that plan. The purchased plan defines each method, path and unit cost.

The application needs an original jobs merchant JSON and its trusted `.mjs`
application. Its original input schema, function exports, environment allowlist,
worker count, memory limit and function deadline are reused.

For example, an existing plan can offer this route:

```json
{"id":"slow","method":"POST","path":"/slow","units":2}
```

Provision a new private application version from the original files:

```sh
node stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/cli.mjs configure \
  --merchant /absolute/private/jobs-merchant.json \
  --gateway /absolute/private/api-gateway.json \
  --out /absolute/private/application-v1 \
  --worker-port 43111 \
  --route slow analyze \
  --bind-routes
```

The cumulative installer exposes the same command as `api-application`.

`--bind-routes` writes `application-v1/merchant.json` with the selected original
function bound to the purchased path. It retains the original application,
input schema and execution settings, and caps the function's output to the
existing route response limit, at most 4 MiB. The original merchant configuration
identity is retained alongside this new pinned configuration.

Without `--bind-routes`, the function's original path must already match the
purchased route and its output limit must fit the route. Multiple
`--route PASS_ROUTE FUNCTION` pairs provision multiple distinct functions.

| File or directory | Purpose |
| --- | --- |
| `application.json` | Exact profile, route/function bindings and original source identity |
| `gateway.json` | Existing gateway config with selected routes pointing to this private worker |
| `application.key` | Private worker capability used by the gateway |
| `merchant.json` | Derived jobs config when `--bind-routes` is selected |
| `executions/` | Original durable job records, immutable results and original source snapshots |

The original pass manifest stays the purchase contract. Unselected gateway
routes retain their existing configuration. Selected application routes accept
a JSON body and no query parameters.

Use a fixed available loopback worker port. The origin is part of the original
request fingerprint and stays fixed across restarts.

## Run the service

```sh
api-application serve \
  --config /absolute/private/application-v1/application.json \
  --api-port 43112 \
  --console-port 43113
```

This starts the private native worker, injects its capability into the original
gateway process, and starts the existing customer API and operator console.
The gateway prints its API address and private console URL. Its browser console
keeps the existing access-policy and allowance controls.

`worker --config ...` starts the backend alone for a separately managed gateway.
In that deployment, the gateway's `SF101_APPLICATION_KEY` environment value must
come from the profile's private capability file. The generated route names that
variable through the original gateway's `headerEnv` option.

Only configured environment names reach the application worker. It verifies the
original application source before import and enforces the original schema,
function deadline, output cap and memory setting. Application modules execute
trusted merchant code, including deliberately configured network or filesystem
work.

The runtime uses local Node and Python processes. Its execution root uses the
original Linux fleet lease so a second writer cannot operate the same root.

## Purchase and call

Use `api-purchase` for the original Buyer/Inbox purchase lifecycle in
[the purchase guide](../api-access/PURCHASE.md), or use an already entitled pass.
The same original claim token authorizes API access.

Write this original numeric-series input to a local file:

```json
{"values":[2,4,6,8],"window":2}
```

Call it with the existing customer client:

```sh
api-pass-client call \
  --base-url http://127.0.0.1:43112 \
  --order YOUR_EXISTING_API_ORDER \
  --claim-env YOUR_CLAIM_ENV \
  --route slow \
  --request-id report-001 \
  --method POST \
  --body /absolute/private/report-input.json \
  --content-type application/json \
  --out /absolute/private/report-result.json
```

The result is the original application's numeric-series report. A successful
execution consumes the route's declared units. Replaying the same request ID
with the same request returns the original cached bytes. Changed input conflicts
with the existing request fingerprint.

Use a new customer request ID for different work. The native operation ID is the
existing gateway's forwarded key:

```text
sf101- + SHA256(canonical JSON [orderRef, requestId])
```

The original application receives it as `context.jobId`. Application code can
reuse this stable value when calling a downstream system with idempotency support.

## Execution and allowance lifecycle

Immediately before retaining an operation and again before claiming execution,
the adapter reads the original merchant reservation. The same read snapshot
checks the exact route, method, path, request fingerprint, units, unexpired
execution lease, current entitlement/access policy and unchanged manifest/plan.

The native job's immutable `payment` metadata records that actual purchased
allowance: original order, customer request ID, route, fingerprint, units, plan
hashes, function and source/profile bindings. Its `settlement` remains null
because its payment authority is the existing SF101 pass.

The native store makes one attempt per admitted operation. It writes the actual
result to the original immutable result store and marks the same attempt complete
only after the original worker has retired. Bytes, SHA-256, content type and
filename remain linked to that execution.

Response content types pass through the original API validator at admission,
using its application/octet-stream fallback. That same normalized type is
retained with the result and used for normal delivery and later recovery.

| Native state | Existing allowance behavior |
| --- | --- |
| `QUEUED` | Units remain reserved while the original request waits. Admission is rechecked before execution. |
| `RUNNING` | The native function owns the execution. A disconnected caller does not start another attempt. |
| `COMPLETED` | A connected caller receives the result. After a connection timeout, `recover` attaches the retained bytes to the original API call. |
| `CANCELLED` with zero attempts | The operation became terminal before execution. `release` reconciles its confirmed unperformed units. |
| `FAILED`, `INTERRUPTED`, or `CANCELLED` after an attempt | The original attempt and safe error remain available for the merchant's observed-outcome recovery decision. |

A gateway deadline can be shorter than the function's deadline. If its connection
closes after execution starts, the native worker continues to its original
deadline and retains any actual result. The API gateway retains the allowance
reservation for recovery.

If the connection disappears while still queued, the operation becomes terminal
with zero attempts. A restart makes formerly queued operations terminal and
records formerly running operations as interrupted. Restarting, reconnecting or
reusing an operation never starts another native attempt.

Malformed requests receive completed HTTP errors. The existing API policy
charges completed upstream HTTP responses, including error responses.
Interrupted native execution and uncertain transport outcomes retain their
reservation for the original recovery controls.

## Inspect and recover

Inspect an execution and its original allowance record:

```sh
api-application inspect \
  --config /absolute/private/application-v1/application.json \
  --order YOUR_EXISTING_API_ORDER \
  --request-id report-001
```

The response includes native attempts, source/request lineage, result metadata,
and the original call's current revision and action history. It fetches the
private worker while running. If the worker is offline, it acquires the original
store lease for the read. `--offline` explicitly selects that path.

For a native `COMPLETED` result whose original call needs recovery, use the call
revision from `inspect`:

```sh
api-application recover \
  --config /absolute/private/application-v1/application.json \
  --order YOUR_EXISTING_API_ORDER \
  --request-id report-001 \
  --revision CURRENT_CALL_REVISION \
  --operation-id recover-report-001 \
  --actor merchant-operator \
  --reason "Attach the completed original application response after the gateway timeout."
```

The adapter reads the immutable bytes, checks their SHA and length, joins the
exact original order/request/route/fingerprint, and invokes the existing
API-pass operator transaction. A reserved call consumes its units and receives
its result atomically. A previously consumed call gets the result through the
original attachment operation. An already completed matching response is
returned as completed.

Repeat the same command, including its original revision, operation ID, actor
and reason, after a lost CLI response. The original action replay returns its
recorded outcome.

The customer retrieves the recovered bytes with the existing client:

```sh
api-pass-client recover \
  --base-url http://127.0.0.1:43112 \
  --order YOUR_EXISTING_API_ORDER \
  --claim-env YOUR_CLAIM_ENV \
  --request-id report-001 \
  --out /absolute/private/report-result.json
```

Original token rotation, suspension, expiry and manifest binding are checked by
the existing API result endpoint on every customer retrieval.

For an execution that has not started, use `release` with its own retained
operator operation ID and reason. The private worker first makes the zero-attempt
execution terminal under its original store lease. The existing pass transaction
then releases the reservation. A native operation that already has an attempt
uses the original operator console's observed-outcome decision.

## Observe capacity

```sh
api-application status --config /absolute/private/application-v1/application.json
api-application list --config /absolute/private/application-v1/application.json --limit 50
```

Status includes source identity, native state counts, active workers and queue
occupancy, retained result bytes, configured limits and the latest safe fault
code. `list` returns `nextAfter`; pass that value as `--after` for the next page.
Commands and the existing customer/operator surfaces refresh on request.

The original worker, pending and retained-job limits govern throughput and
retention. The API response cap is at most 4 MiB. Configuration checks the
original output contract against the purchased route's response capacity.

## Stop, back up and restore

The portable recovery commands preserve a complete application deployment with
the original SF101 merchant snapshot. The existing encrypted merchant recovery
engine protects and transports the resulting image.

### Capture one coherent stopped application

Stop the application service normally. It closes new gateway admissions, makes
unstarted queued work terminal, retires active native workers, records their
outcomes and drains the original store before releasing its lease. Also stop
external writers to any application source or data directories selected for
capture.

The snapshot command acquires that same original job-store lease and retains it
through the complete capture. A running application already owns the lease.
The native rows stay fixed while C94's original merchant snapshot takes its
SQLite cutoff. The adapter joins every captured execution to the order, pass,
route, request fingerprint and allowance record at that cutoff. Every source
file, directory membership and link is checked for changes across capture.

Choose an application root that contains the entry module, every relative or
dynamically loaded module, package metadata and its installed dependencies.
The directory layout is retained in full. Internal relative links are carried
as manifest entries and recreated after their targets; links that escape the
selected root require a larger deployment root.

For the original self-contained numeric application, the original jobs example
directory is a suitable application root:

```sh
api-application snapshot \
  --config /absolute/private/application-v1/application.json \
  --application-root /absolute/source/stellar/scf-starforge-20261009/sf30-seller-sdk/jobs \
  --out /absolute/private/snapshots/application-001

api-application inspect-snapshot \
  --snapshot /absolute/private/snapshots/application-001
```

A completed image contains the original profile, private gateway capability,
exact gateway/configuration bytes, original native source records, every
retained execution and immutable result, the complete selected application tree,
named data roots, and C94's original merchant database and paid-file image.
Snapshot metadata reports native states, the actual original allowance join,
retained responses and byte counts. Interrupted execution states and reserved
units carry their existing meaning into restoration.

The image uses private regular objects and an explicit logical path manifest.
That preserves deep dependency layouts and internal links while remaining an
ordinary input to the existing encrypted engine. Executable file bits are
restored from the manifest; files and directories remain private. The complete
image must fit the original engine's 10,000-entry, 4 GiB total and 2 GiB per-file
limits.

### Preserve application data paths

Add each application-owned data directory by name. Use an explicit mapping for
an environment variable already declared by the original jobs configuration:

```sh
api-application snapshot \
  --config /absolute/private/application-v1/application.json \
  --application-root /absolute/deployment/application \
  --data records /absolute/private/application-data \
  --path-env APP_DATA records . \
  --out /absolute/private/snapshots/application-with-data-001
```

The mapping above supplies the restored `APP_DATA` variable from the restored
`records` data directory. A relative suffix can select a file or subdirectory.
The variable must appear in the original merchant's environment allowlist.
Applications can locate their code through `import.meta.url` and their mutable
data through these configured paths. Include every dynamic module and data
dependency in the selected deployment roots.

Other environment values continue to come from the operator's existing secret
store. Snapshot metadata retains environment names and path mappings. Restored
data is writable application state; the initial snapshot retains its original
bytes, while the restored source tree remains checked against its captured
hashes when the runtime opens.

### Encrypt and transport with the existing recovery engine

Supply the existing private recovery passphrase through the named environment
variable, then encrypt the completed image:

```sh
api-application encrypt \
  --snapshot /absolute/private/snapshots/application-001 \
  --out /absolute/private/backups/application-001 \
  --pass-env SF101_RECOVERY_PASSPHRASE
```

This invokes the original `merchant-recovery` snapshot implementation with an
explicit plan bound to the image's current location. The generated
`encryption-plan.json` also supports direct original-engine use at the image's
capture location. Its input is the completed immutable image. The original AES-GCM, scrypt, manifest authentication and create-only
destination behavior remain authoritative.

Use the existing `merchant-recovery verify` and
[remote recovery workflow](../../sf101-merchant-recovery/REMOTE.md) for verification,
resumable off-host transfer and retrieval. The plaintext image and encrypted
bundle stay in operator-private storage.

### Restore at a new location and reopen the same operations

Install the cumulative toolkit release and restore into a new private directory:

```sh
api-application restore \
  --bundle /absolute/private/backups/application-001 \
  --out /absolute/private/recovered-application \
  --pass-env SF101_RECOVERY_PASSPHRASE

api-application inspect \
  --config /absolute/private/recovered-application/application.json \
  --order YOUR_EXISTING_API_ORDER \
  --request-id report-001 \
  --offline

api-application serve \
  --config /absolute/private/recovered-application/application.json \
  --api-port 43112 --console-port 43113
```

For an already decrypted or directly retained image, use
`restore --snapshot /absolute/image --out /absolute/new-runtime`.
The encrypted path first authenticates and decrypts through the original
recovery engine, then installs the application from that verified image.

C94's original restore rebinds the paid-file paths in the original SQLite
database. The application adapter copies native rows and results byte for byte
and writes an explicit restoration descriptor. The shared logical validator
opens the captured profile/configuration, while a separate physical entry
binding points the original executor at the restored application tree.

| Preserved identity or state | Restored location |
| --- | --- |
| Original order, token hash, access policy, events, plan, calls and result BLOBs | C94's restored merchant directory |
| Original profile and gateway hashes, capability bytes, request fingerprint and job source identity | Captured original files plus the explicit restoration descriptor |
| Original execution rows, attempts and result files | The restored native execution directory |
| Original application bytes and dependency layout | The restored application root |
| Original selected data bytes | Named data directories, with explicit allowlisted environment-path mappings |

The derived gateway changes its merchant state directory. Its original backend
origin, port, routes, query policy and private capability remain the same, so a
saved request keeps its exact fingerprint. Release the original service's port
before starting its restored counterpart. The new customer-facing API and
operator console ports may be selected normally.

Existing completed requests return their saved original bytes. Existing
`recover` and `release` commands work with the restored descriptor, preserving
the original operator operation ID, revision, actor and reason on replay.
The original worker owns interruption normalization when it starts. Future
native attempts record their physical restoration binding alongside the
unchanged logical source identity.

Every customer result retrieval and replay still passes the original
entitlement, token, suspension, expiry and plan checks. New execution still
requires an actual original allowance reservation. Reopening an old operation
preserves its native attempt and its existing allowance charge.

A restored runtime retains its application/data root mappings. Its next
`snapshot --config RESTORED_APPLICATION_JSON --out NEW_IMAGE` can use those
same mappings directly.

## Integration interfaces

| Module | Exports |
| --- | --- |
| `configuration.mjs` | `configureApplication`, `readApplication`, `applicationFromSources`, `requestIdentity` |
| `worker.mjs` | `startApplication`, `validateExecution`, `executionView`, `executionExport`, `cancelUnstartedExecution` |
| `allowance-client.mjs` | `allowance(runtime, action, value, options)` |
| `recovery.mjs` | `readApplicationRuntime`, `snapshotApplication`, `inspectApplicationSnapshot`, `restoreApplication`, `encryptApplicationSnapshot`, `restoreEncryptedApplication` |
| `cli.mjs` | `main`, `applicationOperation` |
| `allowance.py` | Private `admit`, `describe`, `recover` and `release` commands |

The private control origin requires the configured application capability. It
exposes status, paginated execution metadata, exact recovery export and
zero-attempt cancellation.
