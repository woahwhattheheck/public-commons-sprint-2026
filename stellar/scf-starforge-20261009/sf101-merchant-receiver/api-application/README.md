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

Terminate the service normally. It stops new admissions, makes queued work
terminal, retires active workers, records their final state and drains the
original store before releasing its lease.

```sh
api-application backup-inputs \
  --config /absolute/private/application-v1/application.json
```

This supplies the existing merchant backup workflow with the additional closure:
the complete private application directory and execution root, original or
derived jobs merchant JSON, original application file and original merchant
state directory. Retain the original installed source version and any application
module dependencies. Environment names are listed for restoration; external
credentials stay in their existing secret store.

Take the stopped application's closure together with the original encrypted
merchant snapshot. Its private files contain application inputs, results and the
gateway capability. Restore the listed absolute paths, original source/config
bytes, result files and merchant snapshot together, preserving permissions, then
start with the same `application.json`.

The original store checks its retained source identity and immutable result
descriptors. A completed operation can serve saved bytes after restart. An
interrupted operation remains available for the original recovery decision.

## Integration interfaces

| Module | Exports |
| --- | --- |
| `configuration.mjs` | `configureApplication`, `readApplication`, `requestIdentity` |
| `worker.mjs` | `startApplication`, `validateExecution`, `executionView`, `executionExport`, `cancelUnstartedExecution` |
| `allowance-client.mjs` | `allowance(runtime, action, value, options)` |
| `cli.mjs` | `main`, `applicationOperation` |
| `allowance.py` | Private `admit`, `describe`, `recover` and `release` commands |

The private control origin requires the configured application capability. It
exposes status, paginated execution metadata, exact recovery export and
zero-attempt cancellation.
