# Prepare a merchant PostgreSQL seller

Turn an approved `postgres-source.v1` and explicit merchant route/payment plan
into a private launch bundle containing the original SF30 seller's
`service.json`, route `bindings.json` and an adapted private `source.json`. The compiler
checks the entire route set before creating a new private directory. The result
uses the existing PostgreSQL launcher and original native payment lifecycle.

This removes the need to hand-align the source query, public request schema,
HTTP example, route ID, handler/admission exports and payment offer. Preparation
is offline: it does not read the database connection environment variable,
connect to PostgreSQL, contact a facilitator or submit a payment.

## Supply a merchant plan

Keep your approved source file in place. For the catalog source shown in
[README.md](README.md), create a private merchant plan with this structure:

```json
{
  "schema": "stellar-forge.postgres-merchant-plan.v1",
  "publicOrigin": "https://api.merchant.example",
  "payment": {
    "scheme": "exact",
    "network": "stellar:testnet",
    "asset": "REPLACE_WITH_MERCHANT_ASSET",
    "payTo": "REPLACE_WITH_MERCHANT_RECIPIENT",
    "amount": "10000",
    "maxTimeoutSeconds": 60
  },
  "routes": [
    {
      "id": "catalog",
      "path": "/catalog",
      "method": "GET",
      "query": "catalog",
      "serviceName": "Merchant Catalog API",
      "description": "Selected catalog products after the supplied record ID",
      "tags": ["catalog"],
      "example": { "region": "north", "after_id": "0" },
      "parameterDescriptions": {
        "region": "Catalog region",
        "after_id": "Last returned record ID; zero requests the first page"
      }
    }
  ]
}
```

Replace the example HTTPS origin, asset, recipient and price with the merchant's
actual public terms. Amounts are positive atomic-unit strings. Each route may
provide its own complete `payment` or `paymentOptions` declaration; otherwise
it inherits the complete top-level declaration. A route override replaces all
inherited options, without mixing fields from different quotes. The original
seller validates supported Stellar networks, exact scheme, limits, duplicate
option identities and payment metadata. It does not prove ownership of the
advertised address.

The plan supports 1–64 routes and any selected subset of the configured named
queries. Several routes can reference the same query. Route IDs are unique;
method/path conflicts, case/slash ambiguity, reserved seller paths and private
public-origin hosts are rejected by the compiler and original seller rules.
Use fixed paths with the original seller's supported methods. Query bindings
are generated for GET/HEAD/DELETE; JSON body bindings for POST/PUT/PATCH. The
compiler imports the original `http-methods.mjs` contract directly, keeping
method support and body placement aligned with the native seller.

Every source parameter needs a public description. Each route also needs an
explicit public `example` object, including `{}` for a parameterless query.
Examples can omit fields with a configured source default. The existing source
binder checks unknown/missing fields, nullability, enums, exact numeric bounds
and original types before anything is written. Query examples are then encoded
as real HTTP strings and checked again. A query example cannot contain null;
choose a JSON body method to transmit null, or omit a field with a suitable default.

Only put public descriptions, tags, examples and payment metadata in this plan.
The plan fields are allowlisted. The compiler copies no source SQL, connection
environment variable name, database identity, TLS settings or source default
value into the public offer. Configured parameter enums and numeric bounds form
part of the public input contract and are included deliberately.

## Generate and run

Run from a complete repository checkout with Node 22 or newer:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/prepare.mjs \
  --source /private/merchant/source.json \
  --plan /private/merchant/plan.json \
  --directory /private/merchant/launch-20261011

node stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/start.mjs \
  --source /private/merchant/launch-20261011/source.json \
  --config /private/merchant/launch-20261011/service.json \
  --port 8423 --operations-port 8424
```

The destination's parent must already exist. The destination itself must be
new: an existing file, directory or symlink is refused. The compiler creates a
0700 directory and three 0600 files, validates the generated service and source
with their original loaders, then prints paths, route URLs and the launcher path. It
does not overwrite an existing workspace. Files it created are removed if
validation or writing fails; existing destinations are untouched. On Windows,
use the operator's filesystem ACLs.

The original source is untouched. A new private `source.json` preserves its
query declarations and connection settings, replaces `bindings` with the exact
generated mapping, and resolves an existing relative `caFile` against the
original source directory. Credential environment values are never read. The
original `start.mjs` reads bindings directly from this source file; the separate
`bindings.json` contains the same mapping for embedding/inspection. SQL remains
in the private source and never enters the public service offer. Regenerate
after changing a source parameter contract. Preparation does not connect to
the database; the existing launcher runs startup preflight against the actual
configured database before exposing the service.

Without `--facilitator`, the original service advertises challenges and developer
documentation. Add the operator's `--facilitator https://HOST/facilitator` to
the same launcher to enable its existing native x402 integration. The seller
listener remains on loopback behind the configured public HTTPS origin; its
existing separate operations console remains private. Runtime package,
database TLS and shutdown setup are documented in [README.md](README.md).

## Request contracts without numeric loss

The generated service imports exact original SF30 offers and enables the
existing `validateInput` admission together with PostgreSQL source admission.
Unknown fields and required input shape are checked before native payment.
The source binder retains authority over canonical integer/decimal spelling,
exact signed-64-bit bounds, decimal comparisons, defaults and UTF-16 string
lengths. PostgreSQL output remains text as documented by the source adapter.

The existing SF25 schema subset does not implement regular-expression patterns
or decimal-string numeric comparisons. The compiler uses only its supported
keywords and describes those additional constraints precisely. It does not
round exact bounds into JSON numbers or advertise unsupported schema keywords.
Decimal enum values are described as exact numeric equivalence classes, since
the source accepts equivalent spellings such as `1.0` and `1.00`. String schemas
use a safe maximum code-point bound; the source applies its exact code-unit
minimum and maximum. Public defaults indicate optionality without revealing
the private configured default value. The combined admissions implement the
complete source contract.

The canonical source represents `parameters` as an object and
`parameterOrder` as the explicit positional order; the compiler reads that
order directly. Existing `number` parameters retain ordinary finite JavaScript
floating-point semantics and accepted decimal/exponent strings. The source's
`decimal` type preserves exact decimal strings with exact bounds.

For example, an approved source query can declare an exact monetary input:

```json
{
  "sql": "SELECT $1::numeric AS amount",
  "parameterOrder": ["amount"],
  "parameters": {
    "amount": {
      "type": "decimal",
      "minimum": "0.01",
      "maximum": "99999999999999999999.99"
    }
  },
  "columns": ["amount"]
}
```

Its merchant route can use JSON POST with
`"example": { "amount": "12345678901234567890.12345678" }` and
`"parameterDescriptions": { "amount": "Exact monetary amount" }`.
The amount remains text through source binding; JSON number input and values
outside the exact bounds are rejected in admission before native verification.
PostgreSQL text containing NUL is likewise rejected before payment.

JSON body integer values may be exact strings or safe JSON integer numbers. Body
booleans may be booleans or `"true"`/`"false"` strings. Query values are always
strings. Nullable fields still require a value unless the source declares a
default. For a query parameter whose only allowed enum value is null, omission
is the only transport representation and requires a default; the generated
schema rejects supplied query text for that field.

## Programmatic use

```js
import {
  compilePostgresMerchantPlan,
  preparePostgresSeller,
} from './postgres/prepare.mjs';

// Pure compilation: original trusted SQL definitions remain local.
const { service, bindings } = compilePostgresMerchantPlan(source.queries, plan);

// File workflow also validates the private source and actual seller file.
const generated = await preparePostgresSeller({
  sourceFile: '/private/merchant/source.json',
  planFile: '/private/merchant/plan.json',
  directory: '/private/merchant/launch-next',
});
```

All source and original offer/header validators run before output creation.
The CLI writes a constant `POSTGRES_PREPARE_FAILED` error on failure so private
SQL, customer example values and parser details do not appear in shared logs.
The embedding API throws the original error for a private operator interface.
No new scheduler, CI workflow, database deployment or payment implementation
is introduced.

The focused compatibility exercise prepared GET, HEAD and POST routes, loaded
the generated files with the original source/seller loaders, and ran the
original native x402 2.28 server through unsigned challenges and combined
schema/source admission. It covered exact decimal bounds, int64 overflow,
PostgreSQL NUL input, Unicode, private defaults, payment-option inheritance and
route override, original OpenAPI, private file modes and create-only output.
It used Node 24.19.0 with zero database connections, verification calls,
settlement calls or hosted Actions. The original source's separate database
exercise remains the database evidence; this check covers the new onboarding
and native request integration only.

The subsequent shared seller method expansion was integrated through source
review of `http-methods.mjs`, extending query/body selection to DELETE/PUT/PATCH.
The recorded execution above exercised GET/HEAD/POST; it was not rerun as a
broader method suite.
