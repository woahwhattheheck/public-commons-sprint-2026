# API merchant workspace

Configure per-operation host connections in the [backend transport profile guide](TRANSPORTS.md). The workspace retains the original upstream configuration through source reviews and seller releases.

Declared finite SSE and NDJSON routes use the same workspace, saved merchant package and native seller. The [streaming workflow](STREAMING.md) covers explicit payment flow, source limits, generated customer review, and opening the existing commerce console for approval and retained output.

A local merchant setup application connecting an OpenAPI-described backend to
the original SF61 compiler, SF30 native upstream seller, SF82 saved pilot and
SF96 operations dashboard. It supports configure → review → save → run → check →
stop → reopen. GET, HEAD, DELETE and JSON or multipart POST, PUT, PATCH backends use the
original native method support and need no custom JavaScript.
Optional GET/HEAD result sharing, declared response validation and backend
availability controls use the same native launcher and saved package. Durable
POST setup issues original merchant tickets and a ready private buyer review.

## Start

Use Node 22+ and the full source checkout. Create a private project directory
outside the checkout, then launch:

~~~sh
npm ci --prefix stellar-forge/payment-auto-catalog --ignore-scripts
npm ci --prefix stellar/scf-starforge-20261009/sf61-openapi-seller-import --ignore-scripts
mkdir -m 700 /tmp/my-merchant-projects
node stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/server.mjs \
  --out-parent /tmp/my-merchant-projects --port 0
~~~

The install supplies the pinned engine for API string patterns. Existing
descriptions without patterns can run without it; pattern-bearing schemas
require the engine and retain their original assertions. The second install
supplies exact `yaml@2.9.1` for OpenAPI YAML. JSON source needs no YAML engine.

Open the complete loopback URL printed by the command. Its fragment contains
the workspace's temporary access token. The interface uses exact local origin
checks and authenticated API calls. Seller and operations remain on loopback.
The operations link uses an explicitly configured workspace origin for a user
click to its HTML page; cross-origin API and export reads remain rejected.

For a walkthrough: **Load example**, **Validate configuration**, **Save new
package**, **Start challenge preview**, **Check unpaid routes**, then open operations. The example
reuses the SF82 description with explicitly nonpayable demonstration terms.

## Authorization-code providers

The same workspace now supports declared OpenAPI authorizationCode flows through
configured host aliases, PKCE, explicit returned-grant review and private durable
connections. Use the [authorization connection operator guide](AUTHORIZATION_CONNECTIONS.md)
for registration, source/profile checks, route binding, renewal, disconnect, retained
remote cleanup and the existing seller/release handoff. The original clientCredentials
provider and separate Google Sheets workflow retain their current interfaces.

## Configure a merchant

1. Load the merchant's original OpenAPI 3.0 or 3.1 JSON or YAML description.
2. Enter the public HTTPS seller server, including its path prefix, Stellar
   network, asset identifier, payment recipient and timeout.
3. Select operations, choose their declared backend servers, and enter positive
   prices in atomic units. The original payment compiler enforces its amount limit.
4. Select a declared backend security alternative and map header API keys or
   HTTP bearer/basic to **environment-variable names**. Set the complete header
   value in the launch environment. For a declared OAuth `clientCredentials`
   flow, open **Backend OAuth authorization**, select **Client credentials**, and review its resolved token endpoint
   and required scopes, then enter client ID/secret environment references and
   the provider's token authentication method. The original provider owns
   renewal and cache credential identity. Follow the complete
   [OAuth setup and saved-package guide](AUTHENTICATION.md). The browser accepts
   credential references only.
5. Enter a short public description and, where needed, a **public request example**
   containing `pathParams`, `query`, and a declared `body`. These are reusable values
   advertised to buyers, so use demonstration values. The original schemas check
   them; they do not replace the API's constraints. Explicit samples also prepare
   dynamic routes and mutations for the existing unpaid route checker.
6. Choose response validation. New JSON routes default to **Match declared OpenAPI
   response**: the original response compiler retains successful status, media type
   and JSON schema promises from the imported description. **Transport limits
   only** is explicit; bytes routes use it. Review the routes, backend targets,
   prices, response statuses, required environment names and route-check readiness.
   Save under a new name.
7. Start a challenge preview and select **Check unpaid routes** to run the original
   SF96 reviewer against that active seller. Its result and private review path
   appear in the workspace. Open operations; stop when finished and reopen the
   saved project to resume the same configuration.
8. Supply the merchant's authorized HTTPS
   facilitator for the original native integration. Open operations; stop when
   finished. The project remains available to reopen.

An original server https://backend.example/v1 and operation
GET /records/{recordId}, offered at https://merchant.example/paid, becomes a paid
/paid/records/:recordId route calling the original /v1/records/:recordId.
Declared query parameters pass through the original upstream compiler. Buyer
credential headers are not implicitly copied to the backend.

For a JSON PATCH operation with a required path identifier, a public example can
look like this (the names and values must match the imported operation):

~~~json
{
  "pathParams": {"recordId": "demo-record"},
  "query": {},
  "body": {"name": "Integration example"}
}
~~~

JSON POST, PUT and PATCH route checks need a body; DELETE needs an explicit example
but no body. A static GET or HEAD can use the description's own query examples.
Samples are limited to 8 KiB each and the combined saved cases to 64 KiB. If the
API supplies no required body/path example, enter one before validation. Only
the original challenge-only seller is called by **Check unpaid routes**.

Multipart routes use actual privately selected files in the running operation
form. The generic public-example checker marks them `PRIVATE_FILE_REQUEST`;
it does not manufacture file bytes from an advertised string example. Follow
the [complete file input workflow](FILE_INPUT.md) for source import, retained
file review, original ticket issuance, buyer preparation and restart/reopen.

The saved service enables the original request-schema admission before payment
verification. Declared response contracts are enforced by the original upstream
runtime before post-handler settlement. Existing v1 plans without a response
validation choice retain their transport-only policy when reopened; explicitly
select declared validation and save a new package to adopt it. Earlier cache
plans using the boolean `enforceResponseContract` field also remain readable;
new workspace saves use the single `responseValidation` choice.

## Shared read products and backend controls

For a GET or HEAD route, open **Shared read results** and explicitly select
**Share this read-only result across buyers with the same request**. This means
the merchant has decided that the result is suitable for different buyers.
Every delivery still goes through the original native verification and settlement.

Set a maximum freshness interval, retained-response count, total memory budget,
largest retained response, waiting-buyer count and shared-source timeout.
The backend's existing concurrent-request cap also bounds cache source work.
The total memory budget includes retained bodies and their response metadata.
An entry too large to retain can still be delivered if it fits the original
transport's response cap. Cache entries are private copies.

In **Backend credentials and response settings**, list any ordinary request
headers the source needs, such as `accept-language`. The original upstream
compiler validates the allow-list. Every forwarded header joins the cache key,
along with the original URL, query order, method and path parameters. Backend
credential values stay in the launch environment. Origin `private`, `no-store`,
`no-cache`, cookies, unusable `Vary` and stale responses prevent shared reuse.
Origin freshness can reduce the merchant interval; it cannot extend it.

The same panel can enable the original backend availability policy. Its failure
and recovery decisions observe actual source invocations before cache response
serialization. A cache hit does not reset a failure streak. Clearing the cache
does not reset the backend circuit. Original admission is evaluated for every
buyer; original source capacity and recovery are rechecked before a backend call.

Select **Match declared OpenAPI response** to import the selected
operation's original OpenAPI response contract. This uses the existing response
compiler, including source references and declared statuses. Unsupported schema
features produce the original compiler error; they are not silently omitted.
Response contracts require JSON format. The existing transport validates the
response before it can be retained or delivered by the native seller.

After startup, **Shared read operations** shows each cached binding, current
entries/bytes/hits/shared waiters, source-call totals and backend circuit state.
**Invalidate** clears only the chosen binding for that exact running seller.
Already admitted requests finish in their original generation; subsequent reads
cannot join it. A stale tab receives a conflict if the seller has restarted.
Cache writes require the workspace's existing private token and exact origin.

Settings are saved in the original `merchant-plan.json` and `upstreams.json`.
SF82 resumes those same bindings with fresh environment credentials. Cache bodies
remain in process memory and are not included in saved packages or support exports.
Stopping drains the original seller, then closes its cache controllers. Restart
starts with empty caches. Cache counters describe application reuse, not revenue.

For headless preparation, each selected read operation can include:

~~~json
{
  "method": "GET",
  "path": "/records/{recordId}",
  "amountAtomic": "20000",
  "requestHeaders": ["accept-language"],
  "responseValidation": "declared",
  "availability": {"failureThreshold": 3, "resetAfterMs": 30000, "maxResetAfterMs": 300000},
  "cache": {
    "shareAcrossBuyers": true,
    "ttlMs": 5000,
    "maxEntries": 256,
    "maxBytes": 16777216,
    "maxEntryBytes": 1048576,
    "maxWaiters": 128
  }
}
~~~

Optional `cache.maxSourceInFlight` cannot exceed that operation's `maxInFlight`.
The cache constructor owns all other numeric and header validation. Omit `cache`
to retain a fresh backend call per application invocation. Mutation methods
reject a cache policy instead of silently ignoring it.

## Durable POST setup and buyer handoff

For a selected POST route, open **Durable POST operations** and enable the
merchant-issued ticket requirement. Supply a stable operation scope, canonical
absolute state directory, and the **name** of the environment variable containing
the persistent 32-byte hexadecimal operation key. Configure the original buyer
ticket/backend operation-key headers and ledger count, byte, lifetime and wait
limits. The original upstream compiler validates all settings and requires a
distinct state directory and admission binding for each configured write route.
GET/HEAD sharing and POST idempotency remain separate policies on their routes.

Set the real key in the launch environment before starting this workspace.
Saving checks its reference and required shape without reading or saving a key.
At startup the workspace creates missing state directories with mode `0700`;
existing directories must already be private and have no symlink aliases. Keep
the same scope, directory and key when restarting or publishing another release.
The generated shell guide explains the same directory setup for direct launches.

In the running seller, choose an operation and enter a merchant operation ID,
opaque customer reference, ticket lifetime and exact public request. The form
starts with the original public path/query/body examples. Its request is checked
by the **active seller's original route selection and SF89 input schema** before
the bound original handler issues it. Ordinary headers must match the eventual
buyer request, including spelling of their values; surrounding whitespace is
rejected because browser and HTTP header processing would trim it.
The form lists the configured forwarded headers. Include the buyer's actual
`accept-language`, `x-region` or other listed values in the request JSON before
issuing its ticket. The merchant and original SF88 buyer share the same ordinary
header validation; private ticket, authentication and payment headers retain
their original separate assembly.

**Create private buyer ticket file** stores the original five-field
`stellar-forge.upstream-operation-ticket.v1` envelope, the exact JSON body and
ordinary headers, the original seller's concrete request offer, and a prepared
SF88 buyer review. These are create-only `0600` files in `operation-tickets/`.
The original seller materializes dynamic paths without changing its accepted
payment terms or schema; the original SF88 `prepareReview` builds the buyer
config and its private ticket loader checks the resulting file. No operation,
payment, signer or backend is invoked by preparation.

Run the displayed **complete buyer review command** on the same host. The review
is ready for the maintained [buyer workspace and inbox](../../sf88-operator-buyer-cli/OPERATION_TICKETS.md)
with its actual operator, budget and signer. Its stable buyer intent derives
from the original operation key, so issuing another ticket for the same merchant
operation does not silently invent another buyer intent.

For another host, choose **Download complete buyer request**. The one private
file retains the original ticket, exact body bytes, headers and concrete offer.
Run `chmod 600` on the download, then use the displayed original
`starforge buyer --import-operation --file ABS --dir NEW_PRIVATE_DIRECTORY --accept 0`
command. The buyer chooses the actual payment option; import creates local input
files and the original review config without carrying merchant machine paths or
operator/signing settings. Review, then use the existing buyer workspace, inbox
or Node `fromOperationHandoff` / Python `from_operation_handoff` application.
The original runbook accepts the resulting operator workspace's `operator.json`
under its configured local sources directory. All source ticket/input files may
then be archived without breaking the buyer's retained private copies.

**Download ticket only** preserves the smaller original envelope workflow.
On Linux or macOS, run `chmod 600` on that download before importing it; when
transferring hosts, move the matching body/headers/offer privately and prepare
with the destination's actual paths.
Pass the supplied ordinary JSON file as `--headers-file`, the exact body as
`--body-file`, and the separate ticket as `--ticket-file`. The original buyer
stores those header values in its prepared config, so later file changes do not
alter the reviewed request or an existing inbox job. The same private review
can also be imported by the original Node `Buyer.fromConfig` or Python
`Buyer.from_config` customer application.

Ticket bytes and key values never enter workspace status or DOM summaries.
Issuance/download calls require the workspace token, exact origin and current
runtime ID. Downloads pin the original private bytes by digest and cannot name
arbitrary paths. Stop/restart invalidates the old runtime controls while keeping
its files and original durable operation records. Use **Open operations
dashboard** for the already-delivered list, detail, audit and guarded recovery
flow. The original lifecycle's actual idle signal closes the same bound SQLite
controllers after dispatch and accepted console work finish, including late
work following a forced drain error.

## Explicit public facade

The original document is retained byte-for-byte as decoded UTF-8 source. A
separate generated document replaces the selected operations' server with the
merchant's public seller server. Origin-only URLs are normalized in generated
data; the original source stays intact.

A selected backend security alternative must have explicit environment mappings
for all required headers. Only then does the generated paid facade replace that
operation's additional backend authentication with native x402. The package
records the selected alternative, source server, public server and references.

The public description is a single-line summary; multiline source descriptions
are preserved in the original document. Request examples annotate only the
generated operation. OpenAPI 3.1 discriminator hints are removed from compiled
JSON Schema, with every `oneOf`, `anyOf`, `allOf` and assertion retained: the
[OpenAPI specification](https://spec.openapis.org/oas/v3.1.1.html#discriminator-object)
defines the discriminator as a hint that cannot change validation results. The
original source and generated facade keep it. Unsupported assertion keywords
still produce the original validator's error.

Cookie/query authentication, implicit/password OAuth and OpenID Connect login, custom header parameter schemas,
unsupported HTTP methods, unresolved server variables and unsupported schema
features use the original trusted-handler integration. The workspace reports
the source compiler's error.

## Private package

Each save creates a new directory; an existing name is never overwritten.

| Path | Purpose |
| --- | --- |
| original-openapi.json or original-openapi.yaml | Exact original imported description; selected by sourceFile in the package manifest |
| merchant-plan.json | Explicit route, price and backend choices |
| facade-openapi.json | Generated public paid API description |
| selections.json | Original SF61 operation/payment inputs |
| route-bindings.json | Original route-to-handler bindings |
| upstreams.json | Original SF30 configuration, environment references and selected response contracts |
| operator-cases.json | Explicit public samples in the original SF96 route-check format |
| compiled/ | Actual original offers, seller service and compiler manifest |
| merchant-package.json | File hashes and explicit source transformations |
| support/ | Private original support-workflow output |
| operation-tickets/ | Retained multipart requests, issued private tickets and exact original buyer handoff files |
| RUN.md | Exact shell command and route summary |

Reopening verifies the prepared file and route-case hashes. Save changed input under a new
name. SF82 separately snapshots bindings, reloads environment credentials on
restart, and retains the compiled offer identity.

RUN.md supplies the SF96 command to run without this workspace. Adjust its
absolute paths when moving the package; use the full source checkout on the
destination. Stop an existing runtime before launching the same package again.
It also supplies the original SF96 route-check command with the saved cases.
Earlier v1 packages without `operator-cases.json` remain readable.

### Importing a real described API

The first-party [Nansen Smart Alerts documentation](https://docs.nansen.ai/api/smart-alerts)
includes OpenAPI 3.1 descriptions for POST and PATCH `/api/v1/smart-alert`, with
local references, nested channel compositions, required body fields and JSON
responses. Use the retrieved JSON operation description as the source, select
its declared `https://api.nansen.ai` backend, and map `apikey` to an environment
name such as `NANSEN_API_KEY`. Supply public request examples matching that
operation's original schema. The workspace preserves the source, its API path,
backend header mapping and response contract through compilation and save/reopen.
Preparation is offline. A locally valid request sample does not establish that
the provider's business rules accept it or that its account is configured.

## Headless integration

~~~js
import { readFile } from 'node:fs/promises';
import { inspectOpenApi, prepareMerchant, savePackage }
  from './workspace/model.mjs';

const specText = await readFile('/private/openapi.json', 'utf8');
const plan = JSON.parse(await readFile('/private/merchant-plan.json', 'utf8'));
const operations = inspectOpenApi(specText);
const preview = prepareMerchant(specText, plan).preview;
const project = await savePackage({
  specText, plan, parent: '/private/merchant-projects', name: 'merchant-v1'
});
~~~

Preparation checks credential references with sentinels. It does not read actual
credentials, contact the backend or launch a seller. Actual environment values
are checked by the original upstream launcher at startup.

## Runtime boundaries

The workspace accepts a 4 MiB source and 1–64 selected routes. It checks prepared
input, manifest and serialized service limits before creating the project
directory. Files use 0600 and directories use 0700 on POSIX.

Saves and runtime changes are serialized. Editing is locked while an action is
in progress. Shutdown closes the managed seller and operations, including a
startup already in progress. A separately running saved seller is not duplicated.

Challenge preview returns the original HTTP 402 challenge. A challenge,
dashboard counter or backend response does not establish settlement or revenue.
Native payment verification remains in the original seller and facilitator.

