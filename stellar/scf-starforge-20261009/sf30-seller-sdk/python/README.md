# Python functions in the original Stellar seller

Run an existing local Python data function as an SF30 merchant resource with one
configuration file. The original seller still owns HTTP, Bazaar metadata,
request admission, native x402 verification, settlement, content release,
developer documentation, request capacity, and graceful shutdown. Python owns
the useful application result. No additional HTTP backend is required.

This integration is useful for a merchant with an approved data transform,
statistical calculation, report, or model already written in Python. Functions
can return JSON or an explicit bytes result such as CSV. An operator chooses
exactly which local functions and inputs are exposed. The caller cannot choose
the module, interpreter, function name, environment variables, or output path.

## Local walkthrough

Use the complete public repository checkout, Node 22+, and Python 3.11+ on Linux
or another POSIX host. Standard-library examples need no pip packages. Commands
below run from the repository root.

First inspect the example's real compiled seller offers and limits. Inspection
does not import the Python application or contact a facilitator:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/python/merchant.mjs inspect \
  --config stellar/scf-starforge-20261009/sf30-seller-sdk/python/example-merchant.json
```

The example supplies a distribution/rolling-mean JSON endpoint and an
amortization-calculation CSV endpoint. Their payment identifiers are deliberately
nonpayable placeholders. The CSV example is a mathematical export; choose your
own financial rounding, disclosures and calculation conventions for any actual
financial product.

Preview the actual Python function and save the returned result to a new private
file. Its parent directory must already exist; use your own chosen path:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/python/merchant.mjs preview \
  --config stellar/scf-starforge-20261009/sf30-seller-sdk/python/example-merchant.json \
  --function summarize \
  --input stellar/scf-starforge-20261009/sf30-seller-sdk/python/example-input.json \
  --out /tmp/sf30-python-summary.json
```

The summary has count 4, mean 5, median 5, and rolling means `[2,3,5,7]`. The
preview executes local application code without payment and writes the returned
bytes with mode `0600`. The CLI prints a path, content type, byte count, digest
and pool counters, not the result contents. An existing output path is rejected
before importing or executing Python. A failed preview removes its new output;
it never retries the function automatically.

Start the original seller and its existing industrial operations interface:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/python/merchant.mjs serve \
  --config stellar/scf-starforge-20261009/sf30-seller-sdk/python/example-merchant.json \
  --port 8423 --operations-port 8424
```

Open `http://127.0.0.1:8423/_seller/docs` for the existing request explorer,
`/_seller/openapi.json` for its OpenAPI description, and
`http://127.0.0.1:8424/` for original SF30 traffic and operator views. The original
`/_seller/health`, `/_seller/ready` and `/_seller/offers` endpoints also work.

Without `--facilitator`, service mode is `CHALLENGE_ONLY`: both real resource
routes return original SF30 HTTP 402 challenges, and **no Python workers start**.
The configured HTTPS resource origin remains authoritative even though the
operator's listener is on loopback. Request Host/forwarding headers do not
change it. The existing challenge-only mode displays offers without executing
application admission; actual validation runs before the native payment path.

## Bind your application

Copy the example merchant config and change:

| Configuration | Meaning |
| --- | --- |
| `application` | Operator-trusted `.py` file, resolved beside the configuration |
| `python` | Optional interpreter executable; use your venv's absolute executable path |
| `publicOrigin` | Your real public HTTPS origin, served by your existing reverse proxy |
| `environment` | Names of the environment variables the application needs, never values |
| `lifecycle` | Optional `startup` and `shutdown` names for private, zero-argument application hooks |
| `functions` | 1–64 explicitly named public Python callables |
| Function `path` and `method` | Fixed resource path and `GET`, `HEAD`, or JSON `POST` |
| Function `inputSchema` | Explicit object schema, properties and `additionalProperties:false` |
| Function `example` | Actual valid example of that schema, published as Bazaar metadata |
| Function `payment` | Original SF30 exact Stellar network/asset/recipient/atomic-unit terms |
| Function `output` | `format:"json"` or `format:"bytes"`, plus an optional fixed `contentType` |

Keep examples public and harmless because they appear in offers and developer
documentation. The actual buyer's payload goes only to the selected function.
No request headers, payment proof, cookies, URL, or environment values are
forwarded to Python. A query function receives exactly its declared query
object; a POST function receives exactly its validated JSON object.

A merchant module defines ordinary functions with one positional input object:

```python
def my_report(input):
    return {"result": input["value"] * 2}

async def my_async_report(input):
    return {"result": input["value"] * 3}
```

Imports run once per worker. Synchronous and async callables are supported.
Each worker now retains one event loop across initialization, requests, idle
time and shutdown. An initialized async database/API client, queue or connection
pool can be reused by consecutive requests. Synchronous callables still run
outside a running event loop; an existing synchronous function that runs its
own short `asyncio.run` operation keeps working. Use your installed venv for
third-party dependencies. Each worker gets its own module globals and initialized
resources, so shared mutable business state requires the application's own
explicit storage design.

### Initialize and close application resources

Add explicit hooks to the same merchant configuration:

```json
{
  "lifecycle": { "startup": "startup", "shutdown": "shutdown" },
  "startupTimeoutMs": 10000,
  "shutdownTimeoutMs": 5000
}
```

These fields are added alongside the existing `application`, `functions` and
merchant settings. Either hook may be omitted; configurations without hooks
remain valid. Hook names must be public Python identifiers, take no arguments
and be separate from callable names under `functions`. They are private worker
lifecycle operations, never merchant HTTP routes. Both synchronous hooks and
hooks returning awaitables are supported. Initialize async resources inside an
async startup hook so they bind to the worker's persistent loop.

The original pool validates every callable, executes startup and waits for it
to finish **before** marking that worker ready. Native merchant startup waits
for all configured workers before opening its original seller listener. A
replacement worker loads the original pinned application bytes, imports the
module again and runs startup again. A startup failure closes the pool and
prevents the merchant from listening; an available shutdown hook is attempted
to release partially initialized resources. The existing parent startup
deadline still terminates a stuck import or hook.

The runnable standard-library example owns an async queue and processing task
from startup through shutdown. It can serve repeated summaries without creating
another event loop:

```sh
# Imports the application, initializes every worker and closes it; no purchase
# or public function is performed. Configuration-only inspection remains inspect.
node stellar/scf-starforge-20261009/sf30-seller-sdk/python/merchant.mjs diagnose \
  --config stellar/scf-starforge-20261009/sf30-seller-sdk/python/example-lifecycle.json

# Executes the original private preview path using that initialized service.
node stellar/scf-starforge-20261009/sf30-seller-sdk/python/merchant.mjs preview \
  --config stellar/scf-starforge-20261009/sf30-seller-sdk/python/example-lifecycle.json \
  --function summarize \
  --input stellar/scf-starforge-20261009/sf30-seller-sdk/python/example-input.json \
  --out /tmp/sf30-initialized-summary.json
```

The sample's source is `lifecycle-example.py`; it returns the real summary of the
provided series and creates no network service or financial operation. Replace
its initialized queue with the application's own client or data resource. Its
example asset and recipient remain nonpayable placeholders.

Each request receives a fresh copy of the initialized `contextvars.Context`.
Context variables set by one buyer do not become the next buyer's request
context. Startup-owned tasks retain their own context, and shutdown runs in the
startup context. Module globals and shared clients still belong to the worker;
use them deliberately for resource state rather than retaining a buyer's
identity. Await request work before returning a result, and manage any intended
long-lived background tasks through startup/shutdown.

During normal merchant shutdown, the original SF30 seller drains accepted work
before the pool closes. Each idle worker receives protocol EOF, calls shutdown
once, cancels remaining tasks, closes async generators and its loop, and then
acknowledges completion. The parent also waits for the actual process exit.
`shutdownTimeoutMs` covers the complete cleanup, including synchronous hooks,
async hooks and executor/task teardown. A failed hook or a deadline-forced stop
is reported as incomplete cleanup. It does not invalidate a result already
saved successfully, and it never authorizes a repeated payment.

Call timeout, explicit cancellation, a protocol failure, or directly closing a
pool with an active function retains the existing forced process termination.
Shutdown hooks cannot be guaranteed in those paths. Application resources must
tolerate a disconnected worker and the existing explicitly initialized
replacement; a cleanup hook is not an external-transaction rollback.

### Operator diagnosis and stop results

`inspect` only compiles configuration and shows the selected hooks/deadlines.
`diagnose` deliberately imports and initializes trusted application code with
the selected environment, then closes all workers. It prints one private JSON
summary containing readiness, zero public functions invoked, the pool counters
and the shutdown result. Successful initialization and cleanup yield
`PYTHON_LIFECYCLE_READY`. Incomplete cleanup yields
`PYTHON_SHUTDOWN_INCOMPLETE` and exit code 1. Import/startup failure also exits
nonzero without exposing the application's exception text or environment values.

The existing `source.stats()` schema adds lifecycle and deadline metadata plus
`startupFailures`, `gracefulStops`, `forcedStops`, `shutdownFailures` and
`shutdownTimeouts`. These are local process counters, not merchant revenue or
Stellar outcomes. `source.close()` returns the same idempotent promise and a
`stellar-forge.python-shutdown.v1` summary: `clean`, the four stop counters for
that close, and remaining `processes`. Lifetime counters remain in `stats()`;
a previously recovered call timeout stays visible there even when the final
shutdown is clean.

`startPythonMerchant(...).close()` returns the original seller shutdown and the
Python summary. The CLI prints `MERCHANT_STOPPED` or
`MERCHANT_STOP_INCOMPLETE` after SIGINT/SIGTERM; incomplete cleanup exits with
code 1. Preview output retains its saved file details and now includes its
completed cleanup summary. Embedding applications can use these same return
values without another telemetry service.

For GET/HEAD, declare scalar `string`, `integer`, `number`, or `boolean`
properties. The original SF89 admission converts URL scalar values for schema
validation; this adapter supplies the same resulting types to Python. Repeated
query fields, unexpected fields, invalid booleans, nonfinite numbers and unsafe
JavaScript integers are rejected. `required`, `enum`, numeric ranges, string
limits and the original validator's supported assertions apply. For POST, nested
objects and arrays use the original SF25 validator, including their actual
required fields and limits. Schema defaults and examples do not fill missing
buyer inputs.

The integration builds original SF30 offers and retains the explicit typed
input schema within the actual Bazaar extension. The first-party
[Bazaar specification](https://github.com/x402-foundation/x402/blob/main/specs/extensions/bazaar.md)
defines `info`/`schema` and output format metadata. The original
SF89 `createLiveRequestAdmission` and SF25 `validateBazaarExtension` remain the
schema authorities; this directory does not implement another JSON Schema or
payment validator.

JSON results may be dictionaries, lists, strings, booleans, null, or finite
numbers. Python integers outside `[-9007199254740991,9007199254740991]` are
rejected; return explicit decimal strings for exact larger integers. Unsupported
Python types and nonfinite numbers are rejected before native settlement.
For bytes output, return `bytes` or `bytearray`; the configured content type is
fixed at startup. Bytes are transported privately and passed as a Buffer through
the original SF30 response encoder, preserving the exact content.

## Enable the existing native payment service

Replace every example asset/recipient with actual verified merchant values,
set your chosen atomic amount and network, and configure your existing
facilitator. Install the same optional original packages used by SF30:

```sh
npm install --no-save --ignore-scripts \
  @x402/core@2.28.0 @x402/stellar@2.28.0 @x402/extensions@2.28.0

node stellar/scf-starforge-20261009/sf30-seller-sdk/python/merchant.mjs serve \
  --config /private/merchant/python.json \
  --facilitator https://your-facilitator.example/facilitator \
  --port 8423 --operations-port 8424
```

The adapter imports the **original** `createNativeSellerServer`, which installs
the official ExactStellarScheme and Bazaar extension. It does not sign, hold
buyer keys, choose a facilitator, or make a purchase. An explicitly local
facilitator is available through the existing-style `--allow-local-facilitator`
option with an `http://127.0.0.1:PORT` URL. Hosted GitHub Actions are unnecessary.

In native mode the sequence is original schema admission, Python input/capacity
admission, native verification, the chosen Python function, original buffered
response validation, native settlement, and content release. Invalid inputs
produce 422 before verification. A full worker budget produces 429 at admission.
If concurrent verified requests race for the last slot, the handler returns 503
and takes the original native failure/cancellation path.

Python errors, oversized output, timeouts and worker failures produce a 503
application failure through that same path. A later settlement failure withholds
the Python result. Application code must be read-only or explicitly idempotent:
it may have already run when a subsequent settlement or HTTP delivery fails.
This adapter neither retries a merchant function automatically nor compensates
external side effects. Real paid acceptance remains the merchant's original
operator-led SF88/native buyer procedure; local previews are not paid requests.

The two original listeners stay on `127.0.0.1`. Expose only the intended merchant
routes through your existing HTTPS proxy and keep the operations interface
private. Use the same original support capture against the operations session
if diagnosis is needed; no separate telemetry or support service is introduced.

## Capacity, failure recovery and shutdown

| Setting | Default | Range/behavior |
| --- | --- | --- |
| `workerCount` | 1 | 1–8 persistent Python processes |
| `maxPending` | 32 | 1–256 running plus queued calls in one FIFO queue |
| `startupTimeoutMs` | 10000 | 100–30000 ms per worker import and application startup |
| `shutdownTimeoutMs` | 5000 | 100–30000 ms for each idle worker's complete shutdown |
| Function `timeoutMs` | 10000 | 50–120000 ms, including queue time |
| Function `maxInputBytes` | 262144 | 1–524288 UTF-8 bytes after input normalization |
| Function `maxOutputBytes` | 524288 | 1–1048576 bytes, also within original SF30's 1 MiB response budget |
| `--max-in-flight` | 64 | Original SF30 HTTP capacity, 1–1024 |
| `--drain-grace-ms` | 60000 | Original SF30 graceful drain, 1000–300000 ms |

Slow work occupies one worker rather than Node's HTTP event loop. Timeout or an
explicit embedding AbortSignal terminates that worker and waits for process
exit before replacing it. Queued calls remain FIFO; completion order may differ.
One worker's failure does not terminate its peers. A replacement import failure
does not loop forever; a later explicit call may try recovery.

The primary application file is hashed when the source opens. Replacement
workers must load those same bytes; a changed primary file is rejected rather
than silently changing a running deployment after timeout. Restart the whole
merchant to install a changed application. Imported dependencies are the
operator's pinned environment, not included in that primary-file digest.

Python starts in isolated import mode, with the application directory added for
its local imports. Only ordinary PATH/locale variables and explicitly named
environment entries are copied at startup. Application stdout/stderr are
discarded; the worker protocol uses a separate private descriptor. This avoids
putting application prints or exception values in buyer responses and logs.
The code is operator-trusted and runs with that OS account's access; the process
boundary is a concurrency/failure boundary, not an untrusted-code sandbox.

SIGINT/SIGTERM drain the original seller first, keep its operations observer alive
through response completion, then close operations and gracefully close idle Python workers. An
expired original drain deadline closes outstanding HTTP connections and still
closes the worker pool. The current original SF30 HTTP handler does not propagate
client disconnect signals into application handlers; those Python calls end at
their configured deadline or merchant shutdown. Embedding calls can use an
AbortSignal directly. No timeout, disconnect or shutdown authorizes another
purchase or releases a recorded payment reservation.

The persistent runtime uses the standard-library
[Python 3.11 `asyncio.Runner`](https://docs.python.org/3.11/library/asyncio-runner.html#runner-context-manager)
with the existing POSIX private-pipe protocol. No new Python or Node dependency
is required. Its read wait runs in the same loop so initialized async resources
continue to make progress while the merchant is idle.

## Embed in an existing operator runtime

```js
import { readPythonMerchant } from './python/config.mjs';
import { createPythonSource } from './python/source.mjs';
import { startPythonMerchant } from './python/merchant.mjs';

const compiled = await readPythonMerchant('/private/merchant/python.json');
const session = await startPythonMerchant(compiled, {
  port: 8423,
  nativeFactory: existingOriginalNativeFactory,
  operationsPort: 8424,
});
// session.seller is the original SF30 service; session.operations is its original observer.
// session.source.stats() exposes aggregate process/queue counters and the primary source digest.
await session.close();
```

For direct operator previews, `createPythonSource(compiled)` exposes `call(name,
context,{signal})`, `validate(name,context)`, `route(name)`, `stats()` and
`close()`. Its route supplies original SF30 `admit`/`handler` callbacks. Direct
operator calls do not require or assert payment. Always close the source to end
its workers. The launched merchant uses only these same callbacks and source.

## Recorded focused integration

`merchant.journey.mjs` exercises real Python processes, typed JSON and exact CSV,
concurrent progress while another function is slow, queue capacity, timeout and
abort replacement, result rejection, original SF30 challenge-only behavior,
original x402 2.28.0 verification/handler/settlement orchestration, original
developer and operations pages, and the actual private create-only preview CLI.
It uses a controlled in-process facilitator client; it does not create a wallet,
sign a transaction, contact a chain, or represent a paid merchant.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/python/merchant.journey.mjs
```

This is one focused integration journey for this capability, not a repository
suite or a hosted workflow. The merchant source remains in the original SF30
directory so existing distribution and integration owners can include it without
another numbered product or replacement service.
