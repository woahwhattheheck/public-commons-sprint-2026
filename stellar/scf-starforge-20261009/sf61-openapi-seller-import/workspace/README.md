# API merchant workspace

A local merchant setup application connecting an OpenAPI-described backend to
the original SF61 compiler, SF30 native upstream seller, SF82 saved pilot and
SF96 operations dashboard. It supports configure → review → save → run → stop →
reopen. Supported GET, HEAD and JSON POST backends need no custom JavaScript.

## Start

Use Node 22+ and the full source checkout. Create a private project directory
outside the checkout, then launch:

~~~sh
mkdir -m 700 /tmp/my-merchant-projects
node stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/server.mjs \
  --out-parent /tmp/my-merchant-projects --port 0
~~~

Open the complete loopback URL printed by the command. Its fragment contains
the workspace's temporary access token. The interface uses exact local origin
checks and authenticated API calls. Seller and operations remain on loopback.
The operations link uses an explicitly configured workspace origin for a user
click to its HTML page; cross-origin API and export reads remain rejected.

For a walkthrough: **Load example**, **Validate configuration**, **Save new
package**, **Start challenge preview**, then open operations. The example
reuses the SF82 description with explicitly nonpayable demonstration terms.

## Configure a merchant

1. Load the merchant's original OpenAPI 3.0 or 3.1 JSON description.
2. Enter the public HTTPS seller server, including its path prefix, Stellar
   network, asset identifier, payment recipient and timeout.
3. Select operations, choose their declared backend servers, and enter positive
   prices in atomic units. The original payment compiler enforces its amount limit.
4. Map backend authentication headers to **environment-variable names**.
   Header API keys and HTTP bearer/basic are supported. Set the complete
   credential header value in the environment before launching the workspace.
   The browser never requests or saves credential values.
5. Review the public routes, original backend targets, prices and required
   environment names. Save under a new name.
6. Start a challenge preview, or supply the merchant's authorized HTTPS
   facilitator for the original native integration. Open operations; stop when
   finished. The project remains available to reopen.

An original server https://backend.example/v1 and operation
GET /records/{recordId}, offered at https://merchant.example/paid, becomes a paid
/paid/records/:recordId route calling the original /v1/records/:recordId.
Declared query parameters pass through the original upstream compiler. Buyer
credential headers are not implicitly copied to the backend.

## Explicit public facade

The original document is retained byte-for-byte as decoded UTF-8 source. A
separate generated document replaces the selected operations' server with the
merchant's public seller server. Origin-only URLs are normalized in generated
data; the original source stays intact.

A selected backend security alternative must have explicit environment mappings
for all required headers. Only then does the generated paid facade replace that
operation's additional backend authentication with native x402. The package
records the selected alternative, source server, public server and references.

Cookie/query authentication, OAuth/OIDC, custom header parameter schemas,
unsupported HTTP methods, unresolved server variables and unsupported schema
features use the original trusted-handler integration. The workspace reports
the source compiler's error.

## Private package

Each save creates a new directory; an existing name is never overwritten.

| Path | Purpose |
| --- | --- |
| original-openapi.json | Original imported description |
| merchant-plan.json | Explicit route, price and backend choices |
| facade-openapi.json | Generated public paid API description |
| selections.json | Original SF61 operation/payment inputs |
| route-bindings.json | Original route-to-handler bindings |
| upstreams.json | Original SF30 configuration with environment references |
| compiled/ | Actual original offers, seller service and compiler manifest |
| merchant-package.json | File hashes and explicit source transformations |
| support/ | Private original support-workflow output |
| RUN.md | Exact shell command and route summary |

Reopening verifies the prepared file hashes. Save changed input under a new
name. SF82 separately snapshots bindings, reloads environment credentials on
restart, and retains the compiled offer identity.

RUN.md supplies the SF96 command to run without this workspace. Adjust its
absolute paths when moving the package; use the full source checkout on the
destination. Stop an existing runtime before launching the same package again.

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

