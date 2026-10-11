# Native buyer workspace for the existing MCP agent

The original **sf43_discover_review_and_pay** MCP tool can now operate the existing
SF88 buyer workspace and durable inbox. It discovers an actual HTTP offer, saves
the selected request, invokes the original terminal approval and spending
reservation, uses the native Stellar signer, and retains the returned file and
original checkout result. The same intent remains available after restart.

The connection uses the existing MCP 2025-11-25 single-response Streamable HTTP
server. Its merchant leg is the original x402 HTTP buyer. The server, SF88 inbox,
SF36 ledger, SF103 signer and SF31 response writer remain the original modules.

## Prepare the operator host

Use the complete source checkout, Node 22.13+ or Node 24, Python 3.11+, and an
existing native **testnet** SF88 operator workspace. Install its pinned packages
and initialize the original workspace using
[the buyer guide](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/README.md#set-up-a-complete-native-testnet-operator-workspace).

The existing workspace provides the actual payer, chosen token and recipient,
per-operation cap, cumulative budget, signer module, evidence directory and
SQLite ledger. The MCP adapter uses those same files. Keep them at their original
absolute paths and run from the operator's controlling terminal so the original
SF62 approval can open /dev/tty.

A workspace supports one operator-selected merchant origin, pathname and HTTP
method. Query values and an explicit UTF-8 body can vary between requests.
GET, HEAD, POST, PUT, PATCH and DELETE use their original SF88/SF31 behavior.
For a body-bearing route, set its trusted Content-Type in the original workspace
configuration and pass each request body explicitly in the tool call.
Initialize this adapter from a source review configuration without a hidden
bodyFile or orderReference.

Create a private parent directory and an operator-owned catalog configuration.
Replace the URL below with the actual trusted catalog and save the JSON as
/private/commerce/catalog.json:

~~~json
{"origin":"https://your-trusted-catalog.example","limit":100}
~~~

The original SF88 discovery options also accept its existing explicit HTTPS proxy
and gateway configuration. The native adapter fetches one matching search page
with up to 100 original rows; a missing selected resource is reported as missing
from that page. Use the original catalog session for a complete acquisition.

Initialize a new MCP directory around the **existing** operator workspace:

~~~sh
node stellar-forge/mcp-paid-agent/native-workspace-cli.mjs init \
  --dir /private/commerce/native-mcp \
  --workspace /private/commerce/original-buyer \
  --catalog /private/commerce/catalog.json \
  --max-response-bytes 67108864 \
  --response-timeout-ms 30000
~~~

The parent must exist with private permissions. The command refuses an existing
destination. It creates private request/download directories, the original empty
SF88 inbox, a trusted operator.mjs, and a final completion manifest. It creates
no wallet key, token account or replacement spending ledger. Generated files
use mode 0600; directories use 0700.

The catalog may be omitted when the original operator configuration already
contains its valid catalog object. The adapter binds to the original operator,
payer, policy, ledger, signer and evidence directory. Lowering the original spend
cap is respected during subsequent preparation and original execution.

## Start the original MCP server

Provide the operator's local MCP_ACCESS_TOKEN in the environment, then run:

~~~sh
node stellar-forge/mcp-paid-agent/native-workspace-cli.mjs serve \
  --dir /private/commerce/native-mcp --port 3210
~~~

For a newly created local endpoint, generate a token in the operator terminal
with the following command and keep its value in the client's protected connection
configuration:

~~~sh
export MCP_ACCESS_TOKEN="$(openssl rand -hex 32)"
~~~

The command starts the original server at http://127.0.0.1:3210/mcp. It selects
the generated trusted module, original catalog and approved merchant origin,
and the original durable quote store under native-mcp/quotes. The existing
bearer-token and Origin checks apply. Port zero prints the assigned local URL.

An operator already using serve.mjs can use the four nonsecret environment
settings printed by init, together with the existing access token. The generated
module supplies agentCommerce(args, context) and cleanup. Its standalone
bazaar_execute_approved hooks remain denied; use sf43_discover_review_and_pay
for this native workflow.

The server forwards its shutdown signal to the trusted commerce hook.
SIGINT/SIGTERM abort the original buyer child, retain its attempt, and drain
cleanup. The original CLI runs in a child process so its exit codes, approval
terminal and signer loading have their normal direct-execution behavior.
An in-progress unsigned discovery request may finish before shutdown returns;
this adapter accepts discovery timeouts up to 30 seconds.

## Discover, prepare and review

The original bazaar_search and bazaar_describe remain available for inspecting
catalog resources and declared inputs. For the selected native HTTP route, send
these tools/call parameters with a stable intent:

~~~json
{
  "name":"sf43_discover_review_and_pay",
  "arguments":{
    "action":"prepare",
    "intentId":"weather-lagos-20261011-001",
    "search":"weather",
    "targetResourceURL":"https://your-selected-merchant.example/weather?city=Lagos",
    "targetMethod":"GET",
    "maxAtomic":"1000"
  }
}
~~~

The actual URL, search term and atomic-unit ceiling must match the chosen
operator workspace and original offer. Preparation reads the current original
workspace without reading its wallet key, then uses the original SF88 unsigned
catalog reader. It requires one matching resource pathname/method and one
compatible original option within the caller's ceiling and current workspace caps.
Fixed query values from the advertised URL must remain present and unchanged.

The original prepareReview preserves the complete selected listing, option index,
source URL and input digest. The adapter publishes a private request snapshot and
enqueues it through the original inbox. No seller example or default becomes
a request value.

For several eligible payment alternatives, supply the original zero-based
acceptIndex. An ineligible index is rejected. The fresh original challenge,
approval and signer still control actual execution.

The response contains the queued URL, method, selected requirements and body
digest. Preparation makes no merchant call, approval, reservation or signature.

For a configured POST, PUT, PATCH or DELETE route, add body containing the exact
UTF-8 request text. SF88 snapshots those bytes and the original approval includes
their digest. The tool accepts no local file paths, wallet key, signer path or
operator settings.

The existing MCP HTTP handler accepts up to 128 KiB for the entire encoded JSON
request. Keep body text within that transport limit, including JSON escaping.
The local call command can carry explicit body bytes up to the original 1 MiB
SF88 limit.

## Execute the same intent

After preparation, send:

~~~json
{
  "name":"sf43_discover_review_and_pay",
  "arguments":{"action":"execute","intentId":"weather-lagos-20261011-001"}
}
~~~

For a single request flow, execute can include all preparation fields. Omitting
action also means execute, preserving the original callback interface.
The native module always requires a stable intentId.

Execution invokes the original queue-cli.mjs execute command with the selected
workspace. It checks the workspace, signer prerequisites and pinned dependencies
before creating a permanent attempt. Original SF81/SF62 terminal review and SF36
reservation run before native signing. A model-provided approval value is not
an input to the tool.

The response separates durable inbox state from originalBuyer, retaining the
original buyer/HTTP status, seller-reported settlement, outcome report,
reservation and response-file summary. Execution records the original child's
exit status and any constant error code. A missing wallet prerequisite can leave
an intent queued; a recorded attempt remains inspectable.

Concurrent calls for the same intent share one active execution. Another intent
returns OPERATOR_BUSY while that execution owns the approval terminal, and can
be explicitly executed later. Repeating an attempted intent returns its existing
state without a new purchase. Changed request fields for the same intent return
MCP_NATIVE_INTENT_CONFLICT.

The selected catalog amount becomes the saved SF88 operation ceiling, bounded
by the caller and workspace limits. The fresh challenge may offer a lower
compatible amount under the original buyer's policy. Source preparation is not
an exact-price approval or confirmation of a transfer.

## Read the purchased result through MCP

The original SF31 response writer saves the resource under a generated private
download path. Read those saved bytes without contacting the merchant again:

~~~json
{
  "name":"sf43_discover_review_and_pay",
  "arguments":{
    "action":"read","intentId":"weather-lagos-20261011-001",
    "byteOffset":0,"maxBytes":32768
  }
}
~~~

The result includes content type, total byte count, original SHA-256, base64 data
for the requested byte range and nextByteOffset. A complete valid UTF-8 result
also has text. Ranges are limited to 65,536 bytes; follow nextByteOffset until it
is null for larger or binary output.

The first read verifies the saved file against its original size and digest.
Later range reads reuse that result only while device, inode, size and nanosecond
modification/change timestamps remain identical. A new process or changed file
state requires a full digest check again. Each range uses one descriptor and
checks metadata before and after reading; symlinks and changed bytes are rejected.
Memory and returned chunks stay bounded. Reads never sign, call a merchant or
change budget. Missing, modified or unconfirmed output is reported instead of
being downloaded again.

## Inspect, cancel, recover and hand over

Use the same tool with:

| Action | Arguments | Behavior |
| --- | --- | --- |
| status | intentId | Returns original inbox state and retained outcome |
| history | optional limit, cursor | Returns a page of original inbox records |
| cancel | intentId | Cancels an unattempted intent or requests cancellation of this adapter's active child |
| recover | intentId | Invokes original SF88 recovery using existing checkout evidence |
| read | intentId, optional byteOffset, maxBytes | Returns verified saved output bytes |

A recovered file delivery still needs the original saved-download summary.
Recovery preserves the evidence module's actual binding and financial
classification. It does not release a reservation or infer a chain transfer.
For financial finalization, use the original
[SF36 finalization command](../../stellar/scf-starforge-20261009/sf36-spend-governor/FINALIZATION.md)
against the same ledger, intent and receipt.

Operator CLI commands use the same module:

~~~sh
node stellar-forge/mcp-paid-agent/native-workspace-cli.mjs inspect \
  --dir /private/commerce/native-mcp

node stellar-forge/mcp-paid-agent/native-workspace-cli.mjs call \
  --dir /private/commerce/native-mcp --input /private/commerce/request.json

node stellar-forge/mcp-paid-agent/native-workspace-cli.mjs report \
  --dir /private/commerce/native-mcp --out /private/commerce/native-history.html
~~~

The request file contains the arguments object alone. The report uses the original
SF88 industrial HTML history renderer. It is private, create-only and usable
offline. Keep this directory, original workspace and ledger together through
restart; changing an intent or creating a new ledger is not recovery.

Legacy agentCommerce callbacks continue to receive their original arguments.
They may ignore the additive lifecycle fields and optional shutdown context.
The native adapter implements this lifecycle. Remote discovered MCP-server
tool execution remains outside this HTTP merchant connection.

