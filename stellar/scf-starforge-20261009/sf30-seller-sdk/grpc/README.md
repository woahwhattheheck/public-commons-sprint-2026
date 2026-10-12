# Native gRPC merchant and operator workspace

Turn selected unary methods from a private protobuf service into the original
Stellar Forge seller's paid JSON routes. Capture the actual protobuf import
closure, review exact request and response types, retain a plan with complete
payment terms, and operate the merchant through the original SF30 and SF82
lifecycles.

The workspace provides source and plan revisions, typed request editing, channel
review, explicit upstream calls with retained outcomes, merchant preparation,
customer downloads and the original release control. The upstream target, local
protobuf files, certificate material and credential values stay on the merchant
side. Buyers select an advertised HTTP route and send its JSON request.

## Start from source

Use Node 22.16 or later. Install the optional native transport in this folder:

~~~sh
npm ci --prefix stellar/scf-starforge-20261009/sf30-seller-sdk/grpc \
  --ignore-scripts --no-audit --no-fund
~~~

The committed transport closure pins @grpc/grpc-js 1.13.4, @grpc/proto-loader 0.8.1
and protobufjs 7.6.6. The same resolved protobufjs module must serve the original
loader and this source compiler. Compilation verifies the actual loader's
64-bit, boolean and string-map behavior, including legitimate own keys named
__proto__, constructor and the empty string. Public JSON stays canonical; the
adapter applies only the measured native serializer's representation internally.

The original native payment SDK is optional. With no facilitator selected, the
seller runs in CHALLENGE_ONLY mode and never executes a paid application route.
The workspace's explicit **Run upstream request** action directly calls the
merchant's own upstream; its button makes that action distinct and retains an
operation ID.

Launch a new empty private workspace:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/workspace/server.mjs \
  --state /private/merchant/grpc-workspace --port 8453
~~~

Open the complete private URL printed by the server. Its capability remains in
the browser session. The HTTP listener binds to 127.0.0.1 and requires the
original capability on API requests. Keep the state directory outside the
source checkout and installed software directory.

## Operate the included native example

The included example is a real gRPC server with three clearly labelled local
demonstration rows. It exposes Summary and a visible streaming Watch method.
Only Summary can become a paid unary route.

In one terminal, choose an example-only authorization value and start the server:

~~~sh
export GRPC_DEMO_AUTHORIZATION='local-example-only'
node stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/examples/server.mjs \
  --port 50051
~~~

Start the workspace from a second terminal with the same environment value.
Select **Load included example**, then **Capture and save source**. The example's
merchant terms contain nonpayable asset and recipient markers. Replace those
with the merchant's actual approved terms before using a real payment network.

The response includes the exact record identifier 18446744073709551615, a decimal
amount stored as a string, base64 evidence bytes and a signed 64-bit sequence.
Those values travel through the real protobuf serializer and original gRPC
transport. The example's rows are documentation data, not a claim about an
external account.

## Capture and revise the merchant

1. On **Source**, select the exact upstream host:port and TLS or plaintext
   transport. Supply environment variable names for metadata and optional TLS
   credentials. Set the merchant-host protobuf directory and one or more entry
   files, then capture. Imported local files and required standard descriptors
   are retained with their source identities.
2. On **Methods & terms**, choose a captured unary method. Streaming methods
   remain visible but cannot be selected for these request/response HTTP routes.
3. Edit the exact request JSON or the generated fields. Inclusion checkboxes
   distinguish absent fields from explicit false, zero and empty values. Nested
   messages, maps and repeated values use JSON. The complete request and response
   schemas remain available beside the editor.
4. Define its route ID, public POST path, service name, description and complete
   ordered payment options. Amounts are quoted atomic-unit strings. Preserve
   scheme, network, asset, recipient, timeout and extra data for every option.
   Apply the route to the draft, then save the revision.
5. **Review channel and terms** compiles the retained contract and waits for
   native channel readiness. It sends no application RPC and does not claim that
   an upstream business operation succeeded.
6. **Run upstream request** intentionally calls the selected approved method with
   the merchant's credentials. The workspace persists its input, operation ID
   and attempt before invoking the original transport.

Saving uses the exact revision opened in the editor as its comparison base.
Refreshing inventory never advances that base. If another window saved a newer
revision, Save returns a conflict. Open the new current revision to inspect and
compose the intended changes, or explicitly make an older saved revision current.
The server serializes writes under the original merchant state lease.

A captured contract is immutable for that revision. Editing the former .proto
files does not change a saved merchant. Capture again to propose a new revision.

## Native value contract

| Protobuf field | Public JSON |
| --- | --- |
| int64, uint64, sint64, fixed64, sfixed64 | Exact decimal string, within the field's signed or unsigned range |
| 32-bit integer | Exact JSON integer in the field's range |
| bytes | Canonical standard base64 string |
| enum | Declared name, or an int32 numeric value for an unknown enum value |
| boolean | JSON true or false |
| repeated field | JSON array |
| map | JSON object with exact protobuf key representation; 64-bit keys are decimal strings |
| message | Object using exact descriptor field names |
| absent field | Omitted; no defaults are fabricated |
| oneof | At most one member included |
| nonfinite float | Explicit string token Infinity, -Infinity or NaN |
| negative-zero float | Explicit string token -0 |

Standard protobuf types keep their message fields. Timestamp is not silently
converted to a JavaScript Date, and Any is not automatically unpacked. Unknown
message fields and unknown enum names are rejected with a correction location.

## Connection and limits

source.json records the target, transport mode, environment references and limits.
It contains no credential values. TLS uses the normal gRPC trust configuration,
with optional CA, client certificate and private-key PEM values read from named
environment variables. A client certificate and key must be supplied together.
An optional certificate server name belongs to this merchant configuration.

Metadata names are fixed by the merchant. Text values must be printable ASCII;
binary -bin metadata reads canonical base64. Metadata is never copied from buyer
headers. The caller does not accept buyer-selected targets, credentials, method
names or deadlines.

| Limit | Default | Maximum |
| --- | ---: | ---: |
| Native RPC timeout | 30,000 ms | 300,000 ms |
| Channel readiness timeout | 10,000 ms | 60,000 ms |
| Concurrent native calls | 64 | 1,024 |
| Protobuf request bytes | 1 MiB | 8 MiB |
| Protobuf response bytes | 1 MiB | 8 MiB |
| JSON request bytes | 2 MiB | 16 MiB |
| JSON response bytes | 2 MiB | 16 MiB |
| Complete captured proto-source JSON | 8 MiB | 8 MiB |
| Selected merchant routes | — | 64 |

The compiled original seller receives the same JSON request/response limits and
handler timeout. Its complete HTTP request lifetime includes another 120 seconds
for the original body, admission and payment work. An HTTP disconnect or original
handler cancellation cancels the native call. Capacity stays occupied until the
native callback finishes, and shutdown waits for those callbacks.

The original seller still applies its own route, schema and payment-envelope
limits. A valid large protobuf closure may need a smaller selected public method
set to fit the advertised buyer contract. The compiler reports that concrete
limit before publishing a prepared merchant.

## Retained operations and recovery

Every intentional workspace RPC has a unique operation ID. The input and attempt
are durable before the call. A completed output is published as a compact
create-only snapshot before the completion receipt. Reading an operation after
a lost response recovers that same retained output. Reusing an operation ID with
different input is rejected.

ATTEMPTED and OUTCOME_UNCONFIRMED are visible because a lost transport reply does
not identify the upstream business outcome. Read the original operation and
inspect the upstream's actual state; a new intentional request gets a new ID.
The workspace never automatically repeats an uncertain application operation.
This does not add an upstream idempotency mechanism or change that service's
own mutation semantics.

Preparing a merchant is source compilation. It retains an intent, writes an
unpublished folder, then atomically publishes the finished original output.
Resume reuses the same preparation ID. If the folder was already published
before interruption, the workspace verifies it and consumes the remaining
intent. It does not execute an application RPC.

The original state lease prevents two workspace processes from writing the same
private state concurrently. Close the existing process normally before reopening.
Run state from a prior ended process is displayed explicitly; startup does not
silently launch another seller.

## Prepare, run and hand over

Choose **Prepare merchant** on a saved current revision. The private result
contains twelve original product files plus prepared.json:

- Connection, captured protobuf source and merchant plan.
- Original compiled service and method bindings.
- Public request/response method schemas and OpenAPI.
- Original generated JavaScript client, declarations, OpenAPI, package metadata
  and client guide.

**Run merchant** checks the retained files and native channel, then starts the
original seller and its operations console. Open merchant documentation,
OpenAPI, operations and availability from **Running merchant**. **Drain and stop**
uses the original seller's lifecycle before closing the gRPC channel.

**Customer client archive** contains exactly seven public files: methods.json,
openapi.json and the five generated client files. It excludes source.json,
proto-source.json, merchant-plan.json, retained calls and private state. Individual
downloads are checked against their retained file identities.

The response type is advertised through the original Bazaar output-example
schema. The live seller's OpenAPI and its generated customer download project
that same schema; prepared and live documentation do not rely on separate schema
generation.

## Stage, activate and roll back through SF82

Stop the workspace's direct merchant before release control. Enter a release
name on a prepared folder and select **Stage in release control**. The adapter
captures the complete twelve-file package and original manifest into the
existing SF82 store. **Open release control** opens the original application.

Use its ordinary compare, activate, run, drain, stop and rollback controls. Each
release retains the exact proto closure, selected method schemas, complete
payment options, environment variable names, limits and original customer files.
The former prepared directory can be moved after staging. Starting or rolling
back the retained release uses its captured package and the host environment
snapshot passed through the original child manager.

The original manager owns child startup and shutdown. The gRPC adapter adds a
source family; it does not create another release store or payment engine.
Closing the workspace closes its owned release console and uses its original
shutdown path.

Command-line source preparation is available for operators who already maintain
their source and plan:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/cli.mjs capture \
  --directory /private/proto --entry analytics.proto \
  --out /private/captured-proto.json

node stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/cli.mjs inspect \
  --proto /private/captured-proto.json \
  --method /stellarforge.analytics.v1.Analytics/Summary

node stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/cli.mjs prepare \
  --source /private/source.json --proto /private/captured-proto.json \
  --plan /private/merchant-plan.json --out /private/prepared-v1

node stellar/scf-starforge-20261009/sf30-seller-sdk/grpc/start.mjs \
  --directory /private/prepared-v1 --port 8423 --operations-port 8424
~~~

Add the original facilitator URL with --facilitator when selecting native
payments. The explicit --allow-local-facilitator flag applies only to a loopback
HTTP facilitator. Configure actual network and recipient terms before using a
real facilitator. No signer is stored by this merchant workspace.

## Installed product

The original distribution catalog adds grpc, grpc-contract, grpc-workspace and
grpc-example, plus the grpc optional runtime feature. Its dependencies come from
this exact package.json, and its source archive includes the original .proto
example and browser asset manifest. API exports include merchant, source, config,
proto, values, prepare, workspace and retained-release entry points.

A selected portable release exposes the commands through its original launcher:

~~~sh
node /installation/forge.mjs run grpc-workspace -- \
  --state /private/merchant/grpc-workspace --port 8453
node /installation/forge.mjs doctor --feature grpc
~~~

Use the maintained release's optional runtime installation procedure. In a
portable release directory, npm install --ignore-scripts --omit=dev installs its
declared optional closure. Configuration and data remain outside the release,
so software activation and rollback retain merchant work.

The source package has no test runner or hosted Actions entrypoint. The included
server and operator commands are usable product examples. Native operating
results identify their actual source/runtime selection separately.

### Working editor changes

Typed request fields and the exact JSON editor share the same request. Invalid visible input prevents a call or route application. A working request can be called without adding it to the saved merchant plan; Apply route retains it as the route example. Complete plan JSON is explicitly applied or discarded before Save, channel review or Prepare. Opening another method, route, revision or the included example asks before discarding current work. A later inventory refresh keeps the exact opened revision as the editor's save base.
