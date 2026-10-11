# GraphQL merchant onboarding

Turn a provider's served GraphQL schema and approved query products into the
existing SF105 merchant application. The workflow captures or imports the schema,
checks every fixed operation and buyer variable, compiles the original SF30
offers, and produces a launchable private package with the original generated
JavaScript/TypeScript buyer client.

The existing [SF105 adapter](../adapter.mjs), [launcher](../launch.mjs), original
SF30 upstream transport, seller and buyer retain their runtime responsibilities.
Preparation is offline. Schema capture performs one explicit introspection POST.

## Install

Node 22+ and the public source checkout are required. From the repository root,
install its pinned GraphQL reference dependency:

```sh
npm --prefix stellar/scf-starforge-20261009/sf105-subquery-graphql-merchant \
  install --ignore-scripts --no-audit --no-fund
```

This package declares `graphql@16.14.2`. The original launcher requires the same
native x402 packages and facilitator configuration described in the
[original seller guide](../../sf30-seller-sdk/README.md) for a native paid runtime.
Schema validation does not need a facilitator, wallet or buyer signer.

## 1. Obtain the actual query-service schema

Use a served SDL export, a successful GraphQL introspection JSON response, or the
capture command below. A raw introspection data object containing `__schema` is
also accepted.

SubQuery's [Stellar quick start](https://subquery.network/doc/indexer/quickstart/quickstart_chains/stellar.html)
defines indexer entities and then queries the running query service. Its
`schema.graphql` entity file, including `@entity` and `@derivedFrom`, is not the
complete served Query/connection/filter schema. This onboarding tool requires
that actual API schema and gives a specific error when the Query root is absent.
It does not invent generated fields or treat the entity file as a successful
connection to a provider.

For an explicit authorized capture, create a private endpoint JSON file:

```json
{
  "schema": "stellar-forge.subquery-schema-endpoint.v1",
  "origin": "https://indexer.example",
  "path": "/graphql",
  "authorizationEnv": "SUBQUERY_GRAPHQL_AUTH",
  "timeoutMs": 15000,
  "maxResponseBytes": 1048576
}
```

Replace the origin/path with the actual query service. Omit `authorizationEnv`
when the schema endpoint needs no authorization. If present, the named runtime
environment variable supplies the full Authorization value to the original
transport. The value is never saved in the capture or generated merchant files.

```sh
S=stellar/scf-starforge-20261009/sf105-subquery-graphql-merchant
node "$S/onboarding/cli.mjs" capture \
  --endpoint /private/graphql-endpoint.json \
  --directory /private/query-schema-001

node "$S/onboarding/cli.mjs" inspect \
  --schema /private/query-schema-001/schema-source.json

node "$S/onboarding/cli.mjs" inspect \
  --schema /private/query-schema-001/schema-source.json --type Query
```

The existing parent directory must exist. Capture creates a new private directory
containing the source envelope, exact original introspection response, printed
served SDL and a type/argument inventory. It uses the original SF30 public DNS,
HTTPS, timeout, byte and redirect rules. A same-host development service can use
`http://127.0.0.1:PORT` only with the explicit `--allow-loopback-upstream` flag.
The path must be fixed; caller path variables and arbitrary query parameters are
not accepted. Each invocation performs one request, without retries.

The response and capture files are at most 1 MiB. An API whose introspection is
disabled can supply a complete served SDL export instead. Captured envelopes
retain the exact source origin and path; preparation requires the approved
queries to target that same endpoint. A supplied SDL/introspection file retains
its source hash and is identified as supplied source, without an endpoint claim.

## 2. Select and validate the fixed products

Use the original `stellar-forge.subquery-merchant.v1` format in
[approved-queries.json](../examples/approved-queries.json). Copy it privately and
replace the templates with operations validated against the actual served schema.
The same configuration retains the backend endpoint, environment variable name,
timeouts, capacity, response limit, operation/handler/admission identities and
native input bounds.

```sh
node "$S/onboarding/cli.mjs" validate \
  --schema /private/query-schema-001/schema-source.json \
  --queries /private/approved-queries.json
```

Each product contains exactly one read-only query and its fragments. Its selected
root is unconditional, object-valued, and matches the original adapter's `root`
field, including an explicit root alias. Every document variable must have one
matching native variable declaration. Unknown fields, invalid arguments,
fragment errors, mutations, subscriptions, introspection products, incompatible
variable types, missing required declarations and invalid defaults are rejected.
GraphQL's reference parser and schema validator perform the language validation.

| Native variable | Served GraphQL variable | Original runtime behavior |
| --- | --- | --- |
| `integer` | `Int` or `Int!` | JSON safe integer within original inclusive `min`/`max`. |
| `boolean` | `Boolean` or `Boolean!` | JSON `true` or `false`. |
| `string` | `String`/`ID`, optionally non-null | Original UTF-16 length bounds and control-character rejection. |
| `stellar-account` | `String`/`ID`, optionally non-null | Existing G-address syntax check, without an account ownership claim. |

Keep enum values and nested filter structure in the fixed query text; primitive
variables can appear inside those fixed filter literals. The original adapter
does not accept arbitrary input-object, list or custom-scalar buyer variables.
Variable defaults belong in the native `variables` declaration, so the native
admission and GraphQL request cannot use different hidden defaults. A non-null
variable must be required or have a valid native default.

The tool prints a canonical query document, preserving selections, fixed
literals, aliases, fragments and variable semantics. An anonymous query receives
its product name for compatibility with the existing adapter. The source query
file is preserved separately in the package.

## 3. Declare merchant routes and native terms

The private plan uses `stellar-forge.subquery-merchant-plan.v1`. It maps every
approved operation to exactly one fixed native POST route. Its fields are:

| Scope | Required fields | Optional fields |
| --- | --- | --- |
| Plan | `schema`, canonical HTTPS `publicOrigin`, `routes` | Shared `payment` **or** ordered `paymentOptions`. |
| Route | `id`, `path`, `operation`, `serviceName`, `description`, `variables`, `variableDescriptions` | `tags`, route-specific `payment` **or** `paymentOptions`. |

`variables` is an explicit **public** sample object, such as `{"first":10}`.
`variableDescriptions` names and describes every declared buyer variable.
The route's `operation` names the existing approved operation, not a handler or
arbitrary GraphQL string. Routes inherit the plan's terms unless they declare
complete route-specific terms. All payment choices retain their declared order.

Use the merchant's complete existing native payment fields: `scheme`, `network`,
exact atomic `amount` string, `asset`, `payTo`, `maxTimeoutSeconds`, and optional
`extra`. Supply either one payment or the original `paymentOptions` array. The
original SF30 compiler validates these exact terms and option identities. The
onboarding tool does not infer asset precision, an exchange rate, payout address,
or authority to make a purchase.

Native defaults stay in private queries.json; they are not copied into the
advertised schema. Public samples and descriptions are intentionally published
in the offer. Integer bounds and type shape appear in the original Bazaar schema;
SF105's original variable admission retains its exact string/account constraints.

## 4. Prepare, review and run the original seller

```sh
node "$S/onboarding/cli.mjs" prepare \
  --schema /private/query-schema-001/schema-source.json \
  --queries /private/approved-queries.json \
  --plan /private/merchant-plan.json \
  --directory /private/merchant-release-001

node "$S/launch.mjs" --seller /private/merchant-release-001/service.json \
  --queries /private/merchant-release-001/queries.json --check

node "$S/launch.mjs" --seller /private/merchant-release-001/service.json \
  --queries /private/merchant-release-001/queries.json --port 8423
```

Open `review.html` to inspect the products, exact ordered payment choices and
public buyer inputs. The package also contains the original source schema,
original queries and merchant plan, normalized launchable queries, the native
seller service, full schema review, buyer client, request samples and hashes.
Generated directories use 0700 and files use 0600. Existing destinations are
never overwritten. Prepare a new package after a source or terms change. A disk
failure leaves private partial files for inspection; it does not erase another
package or silently report a complete export.

For the merchant's configured native service, use the **same** launcher with its
existing `--facilitator` option and native operator settings. The named upstream
credential is required at launch when configured. A declared loopback development
backend still needs the launcher's explicit `--allow-loopback-upstream` option.
The local seller advertises the plan's public origin; HTTPS exposure and actual
provider access use the merchant's existing deployment.

## Buyer application

The `buyer/` folder is produced by the **original SF30 client generator** from
the exact original OpenAPI export. It contains JavaScript execution, TypeScript
declarations, its original guide/package metadata, and `requests.json` with each
operation's explicit public `inputs.body.variables` sample. It can build the
request offline or delegate once to an existing configured SF31 buyer.

```js
import { buildRequest, createSellerClient } from './buyer/seller-client.mjs';

// Choose an actual saved request entry and your original operation authorization.
const request = buildRequest(entry.operationId, entry.inputs, authorization);
const client = createSellerClient({ buyer: configuredBuyer });
const outcome = await client.call(entry.operationId, entry.inputs, authorization);
```

The authorization retains the original intent, explicitly selected option and
atomic ceiling. The existing buyer retains approval, signing, response saving,
settlement and recovery. The generated client records CHALLENGE_ONLY for this
offline package; its saved mode is not a live observation. Export again from the
running seller's original developer endpoint for the actual deployed snapshot.

## Application API

`onboarding/schema.mjs` exports `compileSchemaSource(input)`,
`readSchemaSource(file)`, `inspectSchema(compiled)`,
`validateApprovedQueries(compiled, queries, {examples})`,
`captureSchemaSource(endpoint, {env, allowLoopback, signal})` and
`captureSchema({endpointFile, directory, ...options})`.

`onboarding/prepare.mjs` exports
`compileSubQueryMerchantPlan({schemaSource, queries, plan})` and
`prepareSubQuerySeller({schemaFile, queriesFile, planFile, directory})`.
The first is offline and returns the original `service`, normalized `queries`,
`review`, `requests`, `openapi` and generated `client`. The second writes the
complete private package and returns its service/queries/client/review/manifest
paths plus the existing launcher path. A browser workspace can call these same
functions on its own managed private draft files.

Reference behavior: [GraphQL introspection](https://www.graphql.org/learn/introspection/),
[GraphQL.js schema utilities](https://www.graphql-js.org/api-v16/utilities/),
and the [original SF105 runtime guide](../README.md).
