# Purchased API access on original SF101 merchant orders

A merchant can sell a defined allowance of API work through the existing SF101 checkout. The customer uses the original order reference and claim token to call approved routes, see remaining units, and recover a previously completed response. A private merchant console shows usage, access policy, and calls that need a decision.

The enrolled plan is the purchased contract. Payment entitlement, token rotation, suspension, and expiry continue to come from the original merchant order and access implementation. The allowance ledger and saved responses live in the same merchant.sqlite3 database.

## Quick start

Run the commands below from this directory. Node.js launches the included Python implementation; Python 3.11 or later and the Python standard library are sufficient. Set STARFORGE_PYTHON to a Python executable when python3 is not the desired interpreter.

Use the private state directory and checkout configuration of an initialized original SF101 merchant. The example uses /srv/starforge/merchant for state and /srv/starforge/private for private inputs and output files. Create the latter with owner-only permissions. Output paths must be absolute, their parent must exist, and each new output filename must be unused.

### 1. Define what the customer purchases

~~~sh
node cli.mjs plan \
  --out /srv/starforge/private/research-plan.json \
  --title "Research API: 100 units" \
  --allowance 100 \
  --route search GET /v1/search 1 \
  --route report POST /v1/report 5
~~~

The resulting plan has this shape:

~~~json
{
  "schema": "stellar-forge.sf101.api-pass.v1",
  "title": "Research API: 100 units",
  "allowanceUnits": 100,
  "routes": [
    {"id": "search", "method": "GET", "path": "/v1/search", "units": 1},
    {"id": "report", "method": "POST", "path": "/v1/report", "units": 5}
  ]
}
~~~

Each route has a fixed ID, HTTP method, absolute path, and integer unit cost. A request is admitted only when that exact route is also present in the merchant's gateway configuration. Prices and payment details remain in the original checkout configuration.

The plan file becomes immutable when enrolled. Its saved file hash, size, and current bytes are checked on customer access. To sell a different allowance or route contract, enroll a new order with a new plan file. An existing customer keeps the contract they purchased.

### 2. Enroll and attach the original order

Use the existing original checkout command:

~~~sh
node ../checkout.mjs enroll \
  --config /srv/starforge/private/checkout.json \
  --ref research-order-001 \
  --file /srv/starforge/private/research-plan.json \
  --out /srv/starforge/private/research-order-001-handoff.json

node cli.mjs attach \
  --state /srv/starforge/merchant \
  --order research-order-001
~~~

The original enrollment command creates the claim token and private handoff according to the existing checkout workflow. To supply an existing private token, use its supported --claim-env option with an environment-variable name.

Attachment recognizes the enrolled plan and prepares its ledger. A pending order becomes usable after the existing SF98 payment delivery entitles that order. Attachment itself leaves the native payment state in charge.

Send the customer the original private handoff through the merchant's established delivery process, plus the API origin and allowed route IDs. Keep upstream provider credentials with the merchant.

### 3. Configure the approved upstream

~~~sh
node cli.mjs configure \
  --state /srv/starforge/merchant \
  --plan /srv/starforge/private/research-plan.json \
  --upstream https://research.example.com \
  --query q \
  --query page \
  --header-env Authorization RESEARCH_UPSTREAM_AUTH \
  --actor merchant-operator \
  --timeout 30 \
  --out /srv/starforge/private/api-gateway.json
~~~

RESEARCH_UPSTREAM_AUTH must contain the complete provider header value in the process environment, such as the provider's required authorization scheme and credential. The configuration stores the environment-variable name. Values are loaded when the gateway starts.

The configure command creates one route configuration for each plan route, using the same origin, allowed query keys, and named upstream headers. Edit the private configuration before starting if routes require different origins, query sets, request sizes, response sizes, or timeouts.

Gateway configuration uses schema stellar-forge.sf101.api-gateway.v1 and contains state, actor, and routes. Each route contains:

| Field | Meaning |
|---|---|
| id, method, path | Exact route contract also present in the enrolled plan |
| upstream | HTTPS origin; local HTTP is allowed only for loopback development |
| query | Allowed query-parameter names; other names are rejected |
| headerEnv | Upstream header names mapped to environment-variable names |
| maxRequestBytes | Request-body cap, from 0 to 1,048,576 bytes |
| maxResponseBytes | Retained response cap, from 1 to 4,194,304 bytes |
| timeoutSeconds | Upstream deadline, from 1 to 120 seconds |

The gateway sets its own host, connection framing, identity encoding, content negotiation, and idempotency headers. Header configuration cannot replace those controls. The upstream origin cannot contain a path, credentials, query, or fragment. HTTP redirects are returned as the upstream response; the gateway does not follow them.

### 4. Start the service and console

~~~sh
node cli.mjs serve \
  --config /srv/starforge/private/api-gateway.json \
  --api-port 8450 \
  --console-port 8451
~~~

The command prints an API origin and a separate private console URL. Both listeners bind to 127.0.0.1. Put only the API listener behind the deployment's existing HTTPS reverse proxy. Preserve the Authorization and Idempotency-Key request headers, query string, body, and response bytes.

The console URL carries an ephemeral capability in its fragment. Open it on the merchant host or through a private tunnel preserving the exact printed host and port. The page removes the fragment from browser history and keeps the capability in memory. The console endpoint requires the exact local Host and same-origin requests.

The grayscale console includes paginated passes and calls, purchased routes, consumed/reserved/available units, attachment, original access controls, and interrupted-call resolution. It retains the same operation ID and exact request body when retrying a failed operator send. A revision conflict refreshes the selected state before the operator makes a new decision.

A clean shutdown drains active request threads. If a process is killed while upstream work is uncertain, its persisted reservation remains available for recovery.

## Customer use

Put the original claim token in SF101_CLAIM_TOKEN in the customer's environment. The token is used for both new work and saved-result retrieval. The examples use the API listener directly on the same machine; remote customers use the merchant's HTTPS API origin.

Inspect the purchased plan and remaining units:

~~~sh
node customer.mjs inspect \
  --base-url http://127.0.0.1:8450 \
  --order research-order-001
~~~

Execute a search, choosing a stable ID for this logical request:

~~~sh
node customer.mjs call \
  --base-url http://127.0.0.1:8450 \
  --order research-order-001 \
  --route search \
  --request-id search-20261011-001 \
  --method GET \
  --query q stellar \
  --out /srv/starforge/private/search-001.json
~~~

For a route accepting a body, add --body with a local input filename and --content-type with its media type. GET and HEAD routes do not accept request bodies.

A completed response is saved with owner-only file permissions. The client verifies the response digest before creating the output file and prints its status, state, byte count, digest, replay flag, and charged units. Upstream application error responses are still saved as completed responses.

If the connection is interrupted, use the same ID to retrieve the saved result:

~~~sh
node customer.mjs recover \
  --base-url http://127.0.0.1:8450 \
  --order research-order-001 \
  --request-id search-20261011-001 \
  --out /srv/starforge/private/search-001-recovered.json
~~~

Repeating the original call with the same ID and identical bound request also returns the retained result. Changing its route, method, path, query, content type, accepted type, body, upstream origin, or configured credential values produces a conflict. Choose a new ID only when requesting new work.

The calls command lists the customer's saved call state. It supports --after and --limit pagination. Recovery and inspection require the currently valid original claim token and access policy.

## Accounting and uncertain outcomes

Admission authenticates the current native order, checks the enrolled plan, reserves the route's unit cost, and grants one caller execution ownership in a single SQLite write transaction. Concurrent requests for the same ID cannot both receive that ownership.

| State | Accounting and customer behavior |
|---|---|
| IN_FLIGHT | Units reserved; another request with the same ID observes the existing call |
| RECOVERY_REQUIRED | Units remain reserved until the merchant resolves the original execution |
| COMPLETED | Units consumed and original response retained for exact retrieval |
| CONSUMED | Merchant confirmed performed work; units consumed, response still awaiting attachment |
| RELEASED | Merchant confirmed units should be released; the same ID remains terminal |

Every fully received upstream HTTP response from 200 through 599 completes and consumes the route cost, including an application error. This makes the purchased unit a performed API request. A disconnect, timeout, truncated or oversized response, or unsupported content encoding leaves the outcome uncertain and retains the reservation. Elapsed executions become visible as requiring recovery.

The gateway does not automatically send uncertain work again. It forwards a stable upstream Idempotency-Key derived from the original order and request ID to providers that support their own deduplication.

### Resolve an interrupted call

Inspect the original call in the console or through the calls command. Use its current revision and the upstream's record to decide whether the work was performed. Record a useful reason and a stable operation ID.

~~~sh
node cli.mjs resolve \
  --state /srv/starforge/merchant \
  --order research-order-001 \
  --request-id search-20261011-001 \
  --revision 2 \
  --operation-id recover-search-001 \
  --actor merchant-operator \
  --reason "Provider request record confirms the request was not executed" \
  --decision release
~~~

Choose consume when the work occurred. If the original result is available, include --status, --body with an absolute private file path, and --content-type. If the performed request's response is recovered later, use attach-result with the call's current revision and a new stable operation ID. Repeating an operator operation with the same ID and exact body returns its existing outcome; changing the body conflicts.

Use history to inspect the saved operator actions. Keep original provider response bytes when attaching a result.

### Access changes

The console supports suspension, resumption, expiry, and clearing expiry. The access command also supports original claim-token rotation. It requires the current native access revision, an operation ID, actor, and reason. Expiry uses the original access implementation's --expires-at format. Token rotation takes --claim-env naming the environment variable containing the new private token.

Original suspension or expiry prevents both new calls and saved-result retrieval. Rotation invalidates the old token; the current token can retrieve the customer's existing saved response.

## Storage and recovery

The implementation adds four tables to the original merchant.sqlite3 database: sf101_api_passes, sf101_api_calls, sf101_api_results, and sf101_api_actions. The original orders and access tables remain authoritative.

A recoverable merchant snapshot includes the complete SQLite database, its enrolled plan files at their recorded paths, private gateway and checkout configuration, and the required process-environment credentials. Drain all writers and close them before taking a filesystem copy, or use a SQLite-aware backup that produces a consistent snapshot of the whole database while writers are active. Copying a live main SQLite file alone can omit committed WAL state.

Use the existing encrypted merchant recovery workflow only when its bundle includes the complete database and these required inputs. Restore plan paths and owner-only permissions before restarting. The operator can inspect the saved plan and accounting while a manifest is missing or damaged; customer use resumes after its exact enrolled bytes are restored.

The export command writes a private JSON inventory of the purchased plan, usage, calls, and action history from one SQLite read snapshot. Its snapshot section records the durable state identity and the number of calls and actions. It is useful for operator review; the retained response bodies and complete SQLite transaction state are part of the full database backup.

## Entry points and integration

- cli.mjs launches the merchant CLI; cli.py is the Python entry point.
- customer.mjs launches the customer CLI; customer.py is the Python entry point.
- gateway.py hosts the separated API and operator listeners.
- pass_store.py owns the purchased contract, accounting, saved results, and recovery transactions.
- index.html, console.js, and style.css provide the private merchant console.

The cumulative distribution can register api-pass and api-pass-client against the two Node entry points. Its existing SF101 directory inclusion carries the Python modules and console assets together. Original checkout, access, and recovery source should travel with the same release.

The targeted native integration journey is kept outside the production package. It exercises the original signed SF98 receiver, real local HTTP requests, customer and operator commands, concurrent request ownership, retained responses, original access changes, and uncertain-call recovery.
